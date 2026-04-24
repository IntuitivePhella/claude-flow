# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Flow Cloud is a real-time visualization tool for Claude Code and Codex agent orchestration. It displays agent sessions as an interactive node graph showing tool calls, subagent hierarchies, and context usage. This fork adds cloud deployment support via Supabase Realtime for remote monitoring.

## Common Commands

```bash
pnpm install              # Install all workspace dependencies
pnpm run setup            # Configure Claude Code hooks in ~/.claude/settings.json
pnpm run dev              # Start dev server (web + relay) at localhost:3000
pnpm run dev:demo         # Start with mock data (no live agent needed)
pnpm run build:all        # Production build (webview + extension)
pnpm run test             # Run tests: node --import tsx --test "scripts/**/*.test.ts"
```

**Extension development:**
```bash
pnpm run dev:extension    # Watch mode for VS Code extension
pnpm run build:extension  # Build extension only
```

**Cloud deployment:**
```bash
node cloud/setup-cloud-hooks.js --url <deployed-url> --token <secret>
```

## Architecture

### Monorepo Structure

- **web/**: Next.js 16 app with React 19 visualization (TailwindCSS 4, d3-force for physics)
- **extension/**: VS Code extension that provides webview panel and session watching
- **scripts/**: Relay server and setup scripts (TypeScript, runs via tsx)
- **cloud/**: Cloud deployment tooling (Supabase schema, hook configuration)
- **app/**: Standalone CLI app (bundled with esbuild)

### Event Flow

1. **Claude Code hooks** (configured in `~/.claude/settings.json`) send events to `~/.claude/agent-flow/hook.js`
2. **Hook script** forwards events via HTTP POST to the relay server
3. **Relay server** (`scripts/relay.ts`) broadcasts events to SSE clients
4. **Web app** receives SSE events and updates the canvas visualization
5. **Cloud mode**: Events go through Netlify API route → Supabase Realtime → browser

### Key Files

- `scripts/relay.ts` — Core relay logic: session watching, SSE broadcasting, event buffering
- `web/hooks/use-agent-simulation.ts` — Main simulation hook that processes events
- `web/hooks/simulation/process-event.ts` — Event type dispatch
- `web/lib/agent-types.ts` — Core type definitions (Agent, ToolCallNode, SimulationEvent)
- `extension/src/transcript-parser.ts` — Parses Claude Code JSONL transcripts
- `extension/src/codex-session-watcher.ts` — Watches Codex rollout files

### SimulationEvent Types

Events flow through the system with these types: `agent_spawn`, `agent_complete`, `agent_idle`, `message`, `context_update`, `model_detected`, `tool_call_start`, `tool_call_end`, `subagent_dispatch`, `subagent_return`, `permission_requested`

### Session Discovery

- Claude sessions: `~/.claude/projects/<encoded-workspace>/<session-id>.jsonl`
- Codex sessions: `~/.codex/sessions/<session-id>/`
- Relay writes discovery file to `~/.claude/agent-flow/<hash>-<pid>.json`

## Environment Variables

For cloud deployment:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase connection
- `SUPABASE_SERVICE_ROLE_KEY` — Server-side Supabase key
- `AGENT_FLOW_CHANNEL_TOKEN` / `NEXT_PUBLIC_AGENT_FLOW_CHANNEL_TOKEN` — Event authentication
- `AGENT_FLOW_RUNTIME` — Runtime mode: `auto`, `claude`, or `codex`

For development:
- `NEXT_PUBLIC_DEMO=1` — Enable mock data mode
- `NEXT_PUBLIC_RELAY_PORT` — Relay server port (default 3001)
