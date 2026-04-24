'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { SimulationEvent } from '@/lib/agent-types'
import type { SessionInfo, ConnectionStatus } from '@/lib/vscode-bridge'

interface CloudBridgeResult {
  connectionStatus: ConnectionStatus
  pendingEvents: readonly SimulationEvent[]
  consumeEvents: () => void
  sessions: SessionInfo[]
  selectedSessionId: string | null
  selectSession: (sessionId: string | null) => void
  flushSessionEvents: (sessionId: string, fromIndex?: number) => void
  getSessionEventCount: (sessionId: string) => number
  selectedSessionIdRef: React.RefObject<string | null>
  sessionsWithActivity: Set<string>
  removeSession: (sessionId: string) => void
  bridgeOpenFile: (filePath: string, line?: number) => void
  isCloudMode: boolean
}

const ORCHESTRATOR_NAME = 'orchestrator'

export function useCloudBridge(): CloudBridgeResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const selectedSessionIdRef = useRef<string | null>(null)
  const [sessionsWithActivity, setSessionsWithActivity] = useState<Set<string>>(new Set())

  const pendingEventsRef = useRef<SimulationEvent[]>([])
  const sessionEventsRef = useRef<Map<string, SimulationEvent[]>>(new Map())
  const sessionStartTimesRef = useRef<Map<string, number>>(new Map())
  const [, setEventVersion] = useState(0)

  const channelRef = useRef<RealtimeChannel | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseRef = useRef<SupabaseClient<any, 'public', any> | null>(null)

  const isCloudMode = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.NEXT_PUBLIC_AGENT_FLOW_CHANNEL_TOKEN
  )

  useEffect(() => {
    if (!isCloudMode) return

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const token = process.env.NEXT_PUBLIC_AGENT_FLOW_CHANNEL_TOKEN!

    const supabase = createClient(supabaseUrl, supabaseKey)
    supabaseRef.current = supabase

    // Subscribe to realtime channel
    const channel = supabase.channel(`agent-flow:${token}`)

    channel
      .on('broadcast', { event: 'agent-event' }, ({ payload }) => {
        processEvent(payload)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected')
          loadRecentEvents(token)
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setConnectionStatus('disconnected')
        }
      })

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [isCloudMode])

  const loadRecentEvents = async (token: string) => {
    try {
      const res = await fetch(`/api/events?token=${token}`)
      if (!res.ok) return

      const { events } = await res.json()
      for (const event of events || []) {
        processEvent(event.payload)
      }
    } catch {
      // Silently ignore errors
    }
  }

  const processEvent = (hookEvent: any) => {
    const sessionId = hookEvent.session_id || hookEvent.sessionId || 'unknown'

    // Track session start time
    if (!sessionStartTimesRef.current.has(sessionId)) {
      sessionStartTimesRef.current.set(sessionId, Date.now())
    }

    // Create or update session
    setSessions((prev) => {
      const existing = prev.find((s) => s.id === sessionId)
      if (!existing) {
        const newSession: SessionInfo = {
          id: sessionId,
          label: hookEvent.cwd?.split(/[\\/]/).pop() || `Session ${sessionId.slice(0, 8)}`,
          status: 'active',
          startTime: sessionStartTimesRef.current.get(sessionId) || Date.now(),
          lastActivityTime: Date.now(),
        }

        // Always create agent_spawn for new sessions
        const spawnEvent: SimulationEvent = {
          time: 0,
          type: 'agent_spawn',
          payload: { name: ORCHESTRATOR_NAME, isMain: true, task: hookEvent.cwd || 'Cloud Session' },
          sessionId,
        }
        const buf = sessionEventsRef.current.get(sessionId) || []
        buf.push(spawnEvent)
        sessionEventsRef.current.set(sessionId, buf)

        // Auto-select first session and push spawn to pending
        if (prev.length === 0) {
          selectedSessionIdRef.current = sessionId
          setSelectedSessionId(sessionId)
          pendingEventsRef.current.push(spawnEvent)
        }

        return [...prev, newSession]
      }
      return prev.map((s) =>
        s.id === sessionId ? { ...s, lastActivityTime: Date.now(), status: 'active' as const } : s
      )
    })

    // Convert hook event to simulation event
    const simEvent = convertToSimulationEvent(hookEvent, sessionId)
    if (!simEvent) return

    // Buffer by session
    const buf = sessionEventsRef.current.get(sessionId) || []
    buf.push(simEvent)
    sessionEventsRef.current.set(sessionId, buf)

    // Deliver to pending if selected
    if (selectedSessionIdRef.current === sessionId) {
      pendingEventsRef.current.push(simEvent)
      setEventVersion((v) => v + 1)
    } else {
      setSessionsWithActivity((prev) => {
        if (prev.has(sessionId)) return prev
        return new Set([...prev, sessionId])
      })
    }
  }

  const convertToSimulationEvent = (hookEvent: any, sessionId: string): SimulationEvent | null => {
    const eventType = hookEvent.hook_event_name || hookEvent.hook_event_type || hookEvent.type
    const relayEventType = hookEvent._relay_event_type
    const startTime = sessionStartTimesRef.current.get(sessionId) || Date.now()
    const eventTime = hookEvent.time ?? (Date.now() - startTime) / 1000

    // If event came from cloud relay with _relay_event_type, pass through directly
    if (relayEventType) {
      const agentName = hookEvent.agent || ORCHESTRATOR_NAME
      switch (relayEventType) {
        case 'message':
          return {
            time: eventTime,
            type: 'message',
            payload: {
              agent: agentName,
              role: hookEvent.role,
              content: hookEvent.content,
            },
            sessionId,
          }
        case 'context_update':
          return {
            time: eventTime,
            type: 'context_update',
            payload: {
              agent: agentName,
              tokens: hookEvent.tokens,
              breakdown: hookEvent.breakdown,
            },
            sessionId,
          }
        case 'model_detected':
          return {
            time: eventTime,
            type: 'model_detected',
            payload: {
              agent: agentName,
              model: hookEvent.model,
            },
            sessionId,
          }
        case 'tool_call_start':
          return {
            time: eventTime,
            type: 'tool_call_start',
            payload: {
              agent: agentName,
              tool: hookEvent.tool,
              args: hookEvent.args,
              preview: hookEvent.preview,
              inputData: hookEvent.inputData,
            },
            sessionId,
          }
        case 'tool_call_end':
          return {
            time: eventTime,
            type: 'tool_call_end',
            payload: {
              agent: agentName,
              tool: hookEvent.tool,
              result: hookEvent.result,
              tokenCost: hookEvent.tokenCost,
              discovery: hookEvent.discovery,
              isError: hookEvent.isError,
              errorMessage: hookEvent.errorMessage,
            },
            sessionId,
          }
        case 'subagent_dispatch':
          return {
            time: eventTime,
            type: 'subagent_dispatch',
            payload: {
              parent: hookEvent.parent || ORCHESTRATOR_NAME,
              name: hookEvent.name,
              task: hookEvent.task,
            },
            sessionId,
          }
        case 'subagent_return':
          return {
            time: eventTime,
            type: 'subagent_return',
            payload: {
              child: hookEvent.child,
              parent: hookEvent.parent,
              summary: hookEvent.summary,
            },
            sessionId,
          }
        case 'agent_spawn':
          return {
            time: eventTime,
            type: 'agent_spawn',
            payload: {
              name: hookEvent.name || agentName,
              isMain: hookEvent.isMain,
              task: hookEvent.task,
              model: hookEvent.model,
            },
            sessionId,
          }
        case 'agent_complete':
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, status: 'completed' as const } : s))
          )
          return {
            time: eventTime,
            type: 'agent_complete',
            payload: { name: hookEvent.name || agentName },
            sessionId,
          }
        case 'permission_requested':
          return {
            time: eventTime,
            type: 'permission_requested',
            payload: {
              agent: agentName,
              tool: hookEvent.tool,
              args: hookEvent.args,
            },
            sessionId,
          }
      }
    }

    // Fallback: handle simple hook events (from setup-cloud-hooks.js)
    const time = eventTime

    switch (eventType) {
      case 'SessionStart':
        return {
          time,
          type: 'agent_spawn',
          payload: { name: ORCHESTRATOR_NAME, isMain: true, task: hookEvent.cwd },
          sessionId,
        }
      case 'PreToolUse': {
        const toolInput = hookEvent.tool_input || {}
        const args = typeof toolInput === 'object'
          ? (toolInput.file_path || toolInput.pattern || toolInput.command || toolInput.query || JSON.stringify(toolInput).slice(0, 100))
          : String(toolInput)
        return {
          time,
          type: 'tool_call_start',
          payload: {
            agent: ORCHESTRATOR_NAME,
            tool: hookEvent.tool_name,
            id: hookEvent.tool_use_id,
            args,
            inputData: toolInput,
          },
          sessionId,
        }
      }
      case 'PostToolUse': {
        const toolResponse = hookEvent.tool_response
        let resultText = 'Done'
        if (typeof toolResponse === 'string') {
          resultText = toolResponse.slice(0, 200)
        } else if (toolResponse?.type === 'text' && toolResponse?.file?.filePath) {
          resultText = `Read ${toolResponse.file.numLines || '?'} lines`
        } else if (toolResponse?.matches) {
          resultText = `${toolResponse.matches.length} matches`
        } else if (toolResponse) {
          resultText = JSON.stringify(toolResponse).slice(0, 100)
        }
        return {
          time,
          type: 'tool_call_end',
          payload: {
            agent: ORCHESTRATOR_NAME,
            tool: hookEvent.tool_name,
            id: hookEvent.tool_use_id,
            result: resultText,
          },
          sessionId,
        }
      }
      case 'SubagentStart':
        return {
          time,
          type: 'subagent_dispatch',
          payload: {
            parent: hookEvent.parent_agent_name || ORCHESTRATOR_NAME,
            name: hookEvent.agent_name,
            task: hookEvent.task,
          },
          sessionId,
        }
      case 'SubagentStop':
        return {
          time,
          type: 'subagent_return',
          payload: {
            name: hookEvent.agent_name,
          },
          sessionId,
        }
      case 'SessionEnd':
      case 'Stop':
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, status: 'completed' as const } : s))
        )
        return {
          time,
          type: 'agent_complete',
          payload: { name: ORCHESTRATOR_NAME },
          sessionId,
        }
      default:
        return null
    }
  }

  const consumeEvents = useCallback(() => {
    pendingEventsRef.current.length = 0
  }, [])

  const selectSession = useCallback((sessionId: string | null) => {
    pendingEventsRef.current.length = 0
    selectedSessionIdRef.current = sessionId
    setSelectedSessionId(sessionId)
    if (sessionId) {
      setSessionsWithActivity((prev) => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    }
  }, [])

  const flushSessionEvents = useCallback((sessionId: string, fromIndex = 0) => {
    const buffered = sessionEventsRef.current.get(sessionId) || []
    pendingEventsRef.current.length = 0

    // Ensure agent_spawn exists at the beginning
    const hasSpawn = buffered.some(e => e.type === 'agent_spawn')
    if (!hasSpawn && fromIndex === 0) {
      const session = sessions.find(s => s.id === sessionId)
      pendingEventsRef.current.push({
        time: 0,
        type: 'agent_spawn',
        payload: { name: ORCHESTRATOR_NAME, isMain: true, task: session?.label || 'Cloud Session' },
        sessionId,
      })
    }

    pendingEventsRef.current.push(...buffered.slice(fromIndex))
    setEventVersion((v) => v + 1)
  }, [sessions])

  const getSessionEventCount = useCallback((sessionId: string): number => {
    return sessionEventsRef.current.get(sessionId)?.length ?? 0
  }, [])

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    sessionEventsRef.current.delete(sessionId)
  }, [])

  const bridgeOpenFile = useCallback((_filePath: string, _line?: number) => {
    // Cloud mode can't open local files
    console.log('Cloud mode: cannot open local files')
  }, [])

  return {
    connectionStatus,
    pendingEvents: pendingEventsRef.current,
    consumeEvents,
    sessions,
    selectedSessionId,
    selectSession,
    flushSessionEvents,
    getSessionEventCount,
    selectedSessionIdRef,
    sessionsWithActivity,
    removeSession,
    bridgeOpenFile,
    isCloudMode,
  }
}
