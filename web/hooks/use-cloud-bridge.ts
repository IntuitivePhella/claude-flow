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

const ORCHESTRATOR_NAME = 'Claude'

export function useCloudBridge(): CloudBridgeResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const selectedSessionIdRef = useRef<string | null>(null)
  const [sessionsWithActivity, setSessionsWithActivity] = useState<Set<string>>(new Set())

  const pendingEventsRef = useRef<SimulationEvent[]>([])
  const sessionEventsRef = useRef<Map<string, SimulationEvent[]>>(new Map())
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

    setConnectionStatus('connecting')

    // Subscribe to realtime channel
    const channel = supabase.channel(`agent-flow:${token}`)

    channel
      .on('broadcast', { event: 'agent-event' }, ({ payload }) => {
        processEvent(payload)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected')
          // Load recent events
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
    } catch (e) {
      console.error('Failed to load recent events:', e)
    }
  }

  const processEvent = (hookEvent: any) => {
    const sessionId = hookEvent.session_id || hookEvent.sessionId || 'unknown'
    const eventType = hookEvent.hook_event_type || hookEvent.type

    // Create or update session
    setSessions((prev) => {
      const existing = prev.find((s) => s.id === sessionId)
      if (!existing) {
        const newSession: SessionInfo = {
          id: sessionId,
          label: hookEvent.cwd?.split(/[\\/]/).pop() || `Session ${sessionId.slice(0, 8)}`,
          status: 'active',
          startTime: Date.now(),
          lastActivityTime: Date.now(),
        }

        // Auto-select first session
        if (prev.length === 0) {
          selectedSessionIdRef.current = sessionId
          setSelectedSessionId(sessionId)
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
    const eventType = hookEvent.hook_event_type || hookEvent.type
    const time = (Date.now() - (sessions.find((s) => s.id === sessionId)?.startTime || Date.now())) / 1000

    switch (eventType) {
      case 'SessionStart':
        return {
          time,
          type: 'agent_spawn',
          payload: { name: ORCHESTRATOR_NAME, isMain: true, task: hookEvent.cwd },
          sessionId,
        }
      case 'PreToolUse':
        return {
          time,
          type: 'tool_call_start',
          payload: {
            agent: ORCHESTRATOR_NAME,
            tool: hookEvent.tool_name,
            id: hookEvent.tool_use_id,
            input: hookEvent.tool_input,
          },
          sessionId,
        }
      case 'PostToolUse':
        return {
          time,
          type: 'tool_call_complete',
          payload: {
            agent: ORCHESTRATOR_NAME,
            tool: hookEvent.tool_name,
            id: hookEvent.tool_use_id,
            result: hookEvent.tool_result,
          },
          sessionId,
        }
      case 'SubagentStart':
        return {
          time,
          type: 'subagent_spawn',
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
          type: 'subagent_complete',
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
    pendingEventsRef.current.push(...buffered.slice(fromIndex))
    setEventVersion((v) => v + 1)
  }, [])

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
