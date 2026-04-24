/**
 * Cloud Relay — watches local JSONL transcripts and forwards rich events to cloud.
 *
 * This bridges the gap between local mode (full data from transcripts) and cloud mode
 * (limited data from hooks). Run this locally to get chat messages, token counts,
 * and full visualization in the cloud UI.
 *
 * Usage:
 *   npx tsx cloud/cloud-relay.ts --url https://your-app.netlify.app --token your-secret
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as https from 'https'
import * as http from 'http'

import { AgentEvent, WatchedSession } from '../extension/src/protocol'
import { TranscriptParser } from '../extension/src/transcript-parser'
import { readNewFileLines } from '../extension/src/fs-utils'
import { scanSubagentsDir, readSubagentNewLines } from '../extension/src/subagent-watcher'
import { handlePermissionDetection } from '../extension/src/permission-detection'
import {
  SCAN_INTERVAL_MS, ACTIVE_SESSION_AGE_S, POLL_FALLBACK_MS,
  SESSION_ID_DISPLAY, SYSTEM_PROMPT_BASE_TOKENS, ORCHESTRATOR_NAME,
} from '../extension/src/constants'
import { setLogLevel } from '../extension/src/logger'

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects')

let cloudUrl = ''
let cloudToken = ''
let verbose = false

function log(...args: unknown[]) {
  if (verbose) console.log('[cloud-relay]', ...args)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const result = { url: '', token: '', workspace: process.cwd(), verbose: false }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      result.url = args[i + 1]
      i++
    } else if (args[i] === '--token' && args[i + 1]) {
      result.token = args[i + 1]
      i++
    } else if (args[i] === '--workspace' && args[i + 1]) {
      result.workspace = args[i + 1]
      i++
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      result.verbose = true
    }
  }

  return result
}

async function sendToCloud(event: AgentEvent): Promise<void> {
  const payload = JSON.stringify({
    event: {
      ...event.payload,
      session_id: event.sessionId,
      hook_event_name: mapEventType(event.type),
      time: event.time,
      _relay_event_type: event.type,
    },
  })

  const url = new URL(`${cloudUrl}/api/events`)
  const isHttps = url.protocol === 'https:'
  const client = isHttps ? https : http

  return new Promise((resolve) => {
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${cloudToken}`,
      },
      timeout: 5000,
    }, (res) => {
      res.resume()
      res.on('end', () => resolve())
    })

    req.on('error', (err) => {
      log('Send error:', err.message)
      resolve()
    })
    req.on('timeout', () => {
      req.destroy()
      resolve()
    })
    req.write(payload)
    req.end()
  })
}

function mapEventType(type: string): string {
  switch (type) {
    case 'agent_spawn': return 'SessionStart'
    case 'agent_complete': return 'SessionEnd'
    case 'tool_call_start': return 'PreToolUse'
    case 'tool_call_end': return 'PostToolUse'
    case 'subagent_dispatch': return 'SubagentStart'
    case 'subagent_return': return 'SubagentStop'
    case 'message': return 'Message'
    case 'context_update': return 'ContextUpdate'
    case 'model_detected': return 'ModelDetected'
    case 'permission_requested': return 'Notification'
    default: return type
  }
}

const sessions = new Map<string, WatchedSession>()
const eventQueue: AgentEvent[] = []
let sending = false

function elapsed(sessionId?: string): number {
  if (sessionId) {
    const session = sessions.get(sessionId)
    if (session) return (Date.now() - session.sessionStartTime) / 1000
  }
  return 0
}

function emitContextUpdate(agentName: string, session: WatchedSession, sessionId?: string) {
  const bd = session.contextBreakdown
  const total = bd.systemPrompt + bd.userMessages + bd.toolResults + bd.reasoning + bd.subagentResults
  queueEvent({
    time: elapsed(sessionId),
    type: 'context_update',
    payload: { agent: agentName, tokens: total, breakdown: { ...bd } },
    sessionId,
  })
}

function queueEvent(event: AgentEvent) {
  const sid = event.sessionId?.slice(0, SESSION_ID_DISPLAY) || '?'
  log(`[event] ${event.type} (session ${sid})`)
  eventQueue.push(event)
  processQueue()
}

async function processQueue() {
  if (sending || eventQueue.length === 0) return
  sending = true

  while (eventQueue.length > 0) {
    const event = eventQueue.shift()!
    await sendToCloud(event)
  }

  sending = false
}

const parser = new TranscriptParser({
  emit: (event: AgentEvent, sessionId?: string) => {
    queueEvent(sessionId ? { ...event, sessionId } : event)
  },
  elapsed,
  getSession: (sessionId: string) => sessions.get(sessionId),
  fireSessionLifecycle: () => {},
  emitContextUpdate,
})

const watcherDelegate = {
  emit: (event: AgentEvent, sessionId?: string) => {
    queueEvent(sessionId ? { ...event, sessionId } : event)
  },
  elapsed,
  getSession: (sessionId: string) => sessions.get(sessionId),
  getLastActivityTime: (sessionId: string) => sessions.get(sessionId)?.lastActivityTime,
  resetInactivityTimer: () => {},
}

function watchSession(sessionId: string, filePath: string) {
  const defaultLabel = `Session ${sessionId.slice(0, SESSION_ID_DISPLAY)}`
  const session: WatchedSession = {
    sessionId, filePath,
    fileWatcher: null, pollTimer: null, fileSize: 0,
    sessionStartTime: Date.now(),
    pendingToolCalls: new Map(),
    seenToolUseIds: new Set(),
    seenMessageHashes: new Set(),
    sessionDetected: false, sessionCompleted: false,
    lastActivityTime: Date.now(),
    inactivityTimer: null,
    subagentWatchers: new Map(),
    spawnedSubagents: new Set(),
    inlineProgressAgents: new Set(),
    subagentsDirWatcher: null, subagentsDir: null,
    label: defaultLabel, labelSet: false,
    model: null,
    permissionTimer: null, permissionEmitted: false,
    contextBreakdown: { systemPrompt: SYSTEM_PROMPT_BASE_TOKENS, userMessages: 0, toolResults: 0, reasoning: 0, subagentResults: 0 },
  }
  sessions.set(sessionId, session)

  const stat = fs.statSync(filePath)
  const catchUpEntries = parser.prescanExistingContent(filePath, stat.size, session)
  session.fileSize = stat.size
  parser.extractSessionLabel(catchUpEntries, session)

  queueEvent({
    time: 0, type: 'agent_spawn',
    payload: { name: ORCHESTRATOR_NAME, isMain: true, task: session.label, ...(session.model ? { model: session.model } : {}) },
    sessionId,
  })
  session.sessionDetected = true

  emitContextUpdate(ORCHESTRATOR_NAME, session, sessionId)
  parser.emitCatchUpEntries(catchUpEntries, session, sessionId)

  session.fileWatcher = fs.watch(filePath, (eventType) => {
    if (eventType === 'change') readNewLines(sessionId)
  })

  session.pollTimer = setInterval(() => {
    readNewLines(sessionId)
    for (const [subPath] of session.subagentWatchers) {
      readSubagentNewLines(watcherDelegate, parser, subPath, sessionId)
    }
    scanSubagentsDir(watcherDelegate, parser, sessionId)
  }, POLL_FALLBACK_MS)

  session.subagentsDir = path.join(path.dirname(filePath), sessionId, 'subagents')
  scanSubagentsDir(watcherDelegate, parser, sessionId)

  log(`Watching session ${sessionId.slice(0, SESSION_ID_DISPLAY)} — "${session.label}"`)
}

function readNewLines(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return

  const result = readNewFileLines(session.filePath, session.fileSize)
  if (!result) return
  session.fileSize = result.newSize
  for (const line of result.lines) {
    parser.processTranscriptLine(line, ORCHESTRATOR_NAME, session.pendingToolCalls, session.seenToolUseIds, sessionId, session.seenMessageHashes)
  }

  handlePermissionDetection(watcherDelegate, ORCHESTRATOR_NAME, session.pendingToolCalls, session, sessionId, session.sessionCompleted, true)
  scanSubagentsDir(watcherDelegate, parser, sessionId)
  session.lastActivityTime = Date.now()
}

function scanForActiveSessions(workspace: string) {
  if (!fs.existsSync(CLAUDE_DIR)) return

  let resolved = workspace
  try { resolved = fs.realpathSync(resolved) } catch {}
  const encoded = resolved.replace(/[^a-zA-Z0-9]/g, '-')

  const dirsToScan: string[] = []
  const projectDir = path.join(CLAUDE_DIR, encoded)
  if (fs.existsSync(projectDir)) dirsToScan.push(projectDir)

  try {
    for (const dir of fs.readdirSync(CLAUDE_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      const fullPath = path.join(CLAUDE_DIR, dir.name)
      if (fullPath === projectDir) continue
      if (dir.name.startsWith(encoded + '-')) {
        dirsToScan.push(fullPath)
      }
    }
  } catch {}

  for (const dirPath of dirsToScan) {
    try {
      for (const file of fs.readdirSync(dirPath)) {
        if (!file.endsWith('.jsonl')) continue
        const filePath = path.join(dirPath, file)
        const stat = fs.statSync(filePath)
        const sessionId = path.basename(file, '.jsonl')

        let newestMtime = stat.mtimeMs
        const subagentsDir = path.join(dirPath, sessionId, 'subagents')
        try {
          if (fs.existsSync(subagentsDir)) {
            for (const subFile of fs.readdirSync(subagentsDir)) {
              if (!subFile.endsWith('.jsonl')) continue
              const subStat = fs.statSync(path.join(subagentsDir, subFile))
              if (subStat.mtimeMs > newestMtime) newestMtime = subStat.mtimeMs
            }
          }
        } catch {}

        const ageSeconds = (Date.now() - newestMtime) / 1000
        if (ageSeconds <= ACTIVE_SESSION_AGE_S && !sessions.has(sessionId)) {
          watchSession(sessionId, filePath)
        }
      }
    } catch {}
  }
}

// Main
const config = parseArgs()

if (!config.url || !config.token) {
  console.error('Usage: npx tsx cloud/cloud-relay.ts --url <cloud-url> --token <secret-token>')
  console.error('')
  console.error('Example:')
  console.error('  npx tsx cloud/cloud-relay.ts --url https://my-agent-flow.netlify.app --token my-secret')
  console.error('')
  console.error('Options:')
  console.error('  --url <url>         Cloud deployment URL')
  console.error('  --token <token>     Authentication token')
  console.error('  --workspace <path>  Workspace to watch (default: current directory)')
  console.error('  --verbose, -v       Enable verbose logging')
  process.exit(1)
}

cloudUrl = config.url.replace(/\/$/, '')
cloudToken = config.token
verbose = config.verbose
if (!verbose) setLogLevel('error')

console.log('Starting Agent Flow Cloud Relay...')
console.log('')
console.log('Cloud URL:', cloudUrl)
console.log('Token:', cloudToken.slice(0, 4) + '****')
console.log('Workspace:', config.workspace)
console.log('')

scanForActiveSessions(config.workspace)
const scanInterval = setInterval(() => scanForActiveSessions(config.workspace), SCAN_INTERVAL_MS)

let projectDirWatcher: fs.FSWatcher | null = null
const resolved = (() => { try { return fs.realpathSync(config.workspace) } catch { return config.workspace } })()
const encoded = resolved.replace(/[^a-zA-Z0-9]/g, '-')
const projectDir = path.join(CLAUDE_DIR, encoded)
if (fs.existsSync(projectDir)) {
  try {
    projectDirWatcher = fs.watch(projectDir, (_eventType, filename) => {
      if (filename?.endsWith('.jsonl')) scanForActiveSessions(config.workspace)
    })
  } catch {}
}

console.log('Cloud relay running! Events will be sent to your cloud deployment.')
console.log('Press Ctrl+C to stop.')
console.log('')

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  clearInterval(scanInterval)
  projectDirWatcher?.close()
  for (const session of sessions.values()) {
    session.fileWatcher?.close()
    if (session.pollTimer) clearInterval(session.pollTimer)
  }
  process.exit(0)
})
