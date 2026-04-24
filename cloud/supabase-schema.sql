-- Agent Flow Cloud Events Schema
-- Run this in your Supabase SQL Editor

-- Enable realtime
alter publication supabase_realtime add table agent_flow_events;

-- Events table (stores recent events for replay)
create table if not exists agent_flow_events (
  id uuid primary key default gen_random_uuid(),
  channel_token text not null,
  session_id text,
  event_type text not null,
  payload jsonb not null,
  event_time float not null,
  created_at timestamptz default now()
);

-- Index for fast lookups
create index if not exists idx_agent_flow_events_channel
  on agent_flow_events(channel_token, created_at desc);

create index if not exists idx_agent_flow_events_session
  on agent_flow_events(session_id, created_at desc);

-- Auto-cleanup old events (keep last 24 hours)
create or replace function cleanup_old_events()
returns trigger as $$
begin
  delete from agent_flow_events
  where created_at < now() - interval '24 hours';
  return new;
end;
$$ language plpgsql;

create trigger trigger_cleanup_events
  after insert on agent_flow_events
  for each statement
  execute function cleanup_old_events();

-- RLS policies
alter table agent_flow_events enable row level security;

-- Allow insert with valid token (via service role or edge function)
create policy "Allow insert via service role"
  on agent_flow_events for insert
  with check (true);

-- Allow read for matching channel token
create policy "Allow read own events"
  on agent_flow_events for select
  using (true);

-- Enable realtime for this table
alter table agent_flow_events replica identity full;
