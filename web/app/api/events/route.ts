import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const channelToken = process.env.AGENT_FLOW_CHANNEL_TOKEN

function getSupabase() {
  if (!supabaseUrl || !supabaseServiceKey) {
    return null
  }
  return createClient(supabaseUrl, supabaseServiceKey)
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token || token !== channelToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { event } = body

    if (!event) {
      return NextResponse.json({ error: 'Missing event' }, { status: 400 })
    }

    const supabase = getSupabase()

    if (supabase) {
      // Insert event into Supabase (triggers realtime broadcast)
      const { error } = await supabase.from('agent_flow_events').insert({
        channel_token: token,
        session_id: event.session_id || event.sessionId,
        event_type: event.hook_event_name || event.hook_event_type || event.type || 'unknown',
        payload: event,
        event_time: Date.now() / 1000,
      })

      if (error) {
        console.error('Supabase insert error:', error)
      }
    }

    // Also broadcast via Supabase Realtime channel
    if (supabase) {
      const channel = supabase.channel(`agent-flow:${token}`)
      await channel.send({
        type: 'broadcast',
        event: 'agent-event',
        payload: event,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error processing event:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token || token !== channelToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()

  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  // Return recent events for replay
  const { data, error } = await supabase
    .from('agent_flow_events')
    .select('*')
    .eq('channel_token', token)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ events: data })
}
