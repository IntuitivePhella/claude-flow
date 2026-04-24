#!/usr/bin/env node
/**
 * Configure local Claude Code hooks to send events to cloud relay.
 *
 * Usage:
 *   node setup-cloud-hooks.js --url https://your-app.netlify.app --token your-secret-token
 */
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const DISCOVERY_DIR = path.join(os.homedir(), '.claude', 'agent-flow')
const CLOUD_HOOK_PATH = path.join(DISCOVERY_DIR, 'cloud-hook.js')
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

const HOOK_COMMAND_MARKER = 'agent-flow/cloud-hook.js'

function parseArgs() {
  const args = process.argv.slice(2)
  const result = { url: '', token: '' }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      result.url = args[i + 1]
      i++
    } else if (args[i] === '--token' && args[i + 1]) {
      result.token = args[i + 1]
      i++
    }
  }

  return result
}

function getCloudHookScript(cloudUrl, token) {
  return `#!/usr/bin/env node
// Agent Flow Cloud Hook — sends events to cloud relay
'use strict';
const https = require('https');
const http = require('http');

const CLOUD_URL = '${cloudUrl}/api/events';
const TOKEN = '${token}';
const TIMEOUT_MS = 1500;

setTimeout(() => process.exit(0), TIMEOUT_MS);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  if (!input.trim()) process.exit(0);

  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const payload = JSON.stringify({
    token: TOKEN,
    event: event
  });

  const url = new URL(CLOUD_URL);
  const isHttps = url.protocol === 'https:';
  const client = isHttps ? https : http;

  const req = client.request({
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': 'Bearer ' + TOKEN
    },
    timeout: TIMEOUT_MS - 100,
  }, (res) => {
    res.resume();
    res.on('end', () => process.exit(0));
  });

  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.write(payload);
  req.end();
});
`
}

function resolveNodePath() {
  try {
    const { execFileSync } = require('child_process')
    const cmd = process.platform === 'win32' ? 'where' : 'command'
    const args = process.platform === 'win32' ? ['node'] : ['-v', 'node']
    const result = execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000 }).trim()
    return result.split(/\r?\n/)[0].trim() || 'node'
  } catch {
    return 'node'
  }
}

function isCloudHook(entry) {
  return entry.hooks?.some(h => h.command?.includes(HOOK_COMMAND_MARKER))
}

function configureHooks() {
  const nodePath = resolveNodePath()
  const hookCommand = `"${nodePath}" "${CLOUD_HOOK_PATH}"`
  const hookEntry = { hooks: [{ type: 'command', command: hookCommand, timeout: 2 }] }

  const events = [
    'SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'SubagentStart', 'SubagentStop', 'Notification', 'Stop', 'SessionEnd',
  ]

  let settings = {}
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    }
  } catch {
    console.log('Could not read existing settings, starting fresh')
  }

  const existingHooks = settings.hooks || {}
  for (const event of events) {
    const existing = existingHooks[event] || []
    const filtered = existing.filter(entry => !isCloudHook(entry))
    existingHooks[event] = [...filtered, hookEntry]
  }
  settings.hooks = existingHooks

  const dir = path.dirname(SETTINGS_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\\n')
  console.log('Configured Claude Code hooks in:', SETTINGS_PATH)
}

// Main
const { url, token } = parseArgs()

if (!url || !token) {
  console.error('Usage: node setup-cloud-hooks.js --url <cloud-url> --token <secret-token>')
  console.error('')
  console.error('Example:')
  console.error('  node setup-cloud-hooks.js --url https://my-agent-flow.netlify.app --token my-secret-123')
  process.exit(1)
}

console.log('Setting up Agent Flow Cloud Hooks...')
console.log('')
console.log('Cloud URL:', url)
console.log('Token:', token.slice(0, 4) + '****')
console.log('')

// Create discovery directory
if (!fs.existsSync(DISCOVERY_DIR)) {
  fs.mkdirSync(DISCOVERY_DIR, { recursive: true })
}

// Write cloud hook script
const script = getCloudHookScript(url, token)
fs.writeFileSync(CLOUD_HOOK_PATH, script, { mode: 0o755 })
console.log('Installed cloud hook:', CLOUD_HOOK_PATH)

// Configure hooks
configureHooks()

console.log('')
console.log('Done! Claude Code events will now be sent to your cloud relay.')
console.log('')
console.log('Next steps:')
console.log('1. Deploy the web app to Netlify/Vercel')
console.log('2. Set AGENT_FLOW_CHANNEL_TOKEN=' + token + ' in your deployment')
console.log('3. Open your deployed app and start a Claude Code session')
