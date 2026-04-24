# Agent Flow Cloud

Real-time visualization of Claude Code and Codex agent orchestration — **with cloud deployment support**.

This is a fork of [Agent Flow](https://github.com/patoles/agent-flow) by [Simon Patole](https://github.com/patoles), extended with cloud capabilities using Supabase Realtime. Monitor your local AI coding sessions from anywhere.

![Agent Flow visualization](https://res.cloudinary.com/dxlvclh9c/image/upload/v1773924941/screenshot_e7yox3.png)

## What's New in This Fork

- **Cloud Mode**: Deploy to Netlify/Vercel and receive events from your local Claude Code via HTTPS
- **Supabase Realtime**: Live event streaming using Supabase's real-time infrastructure
- **Remote Monitoring**: Watch your AI agents work from any device, anywhere

## Architecture

```
┌─────────────────┐     HTTPS POST      ┌──────────────────┐
│  Claude Code    │ ──────────────────► │  Netlify/Vercel  │
│  (your machine) │                     │  API Route       │
└─────────────────┘                     └────────┬─────────┘
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │    Supabase      │
                                        │    Realtime      │
                                        └────────┬─────────┘
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │   Web Browser    │
                                        │   (anywhere)     │
                                        └──────────────────┘
```

## Quick Start

### Option 1: Local Mode (Original Behavior)

```bash
git clone https://github.com/YOUR_USERNAME/agent-flow-cloud.git
cd agent-flow-cloud
pnpm install
pnpm run setup      # configure Claude Code hooks
pnpm run dev        # start web app + event relay
```

Open http://localhost:3000 and start a Claude Code session.

### Option 2: Cloud Mode (New!)

See the [Cloud Deployment Guide](cloud/README.md) for full instructions.

**TL;DR:**

1. Create a [Supabase](https://supabase.com) project and run the schema:
   ```sql
   -- See cloud/supabase-schema.sql for full schema
   create table agent_flow_events (
     id uuid primary key default gen_random_uuid(),
     channel_token text not null,
     session_id text,
     event_type text not null,
     payload jsonb not null,
     event_time float not null,
     created_at timestamptz default now()
   );
   ```

2. Deploy to Netlify with environment variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   AGENT_FLOW_CHANNEL_TOKEN=your-secret-token
   NEXT_PUBLIC_AGENT_FLOW_CHANNEL_TOKEN=your-secret-token
   ```

3. Configure local hooks to send to your cloud deployment:
   ```bash
   node cloud/setup-cloud-hooks.js --url https://your-site.netlify.app --token your-secret-token
   ```

4. Open your deployed URL and start coding with Claude!

## Features

All original Agent Flow features plus cloud capabilities:

- **Live agent visualization**: Interactive node graph with real-time tool calls
- **Claude Code + Codex support**: Auto-detects sessions from both runtimes
- **Multi-session support**: Track multiple concurrent agent sessions
- **Interactive canvas**: Pan, zoom, click to inspect details
- **Timeline & transcript panels**: Full execution timeline and message history
- **Cloud streaming**: Monitor from any device via Supabase Realtime

## Development

```bash
pnpm install              # install dependencies
pnpm run setup            # configure Claude Code hooks (local mode)
pnpm run dev              # start dev server + relay
pnpm run dev:demo         # start with mock data
pnpm run build:all        # production build
```

## Project Structure

```
├── cloud/                 # Cloud deployment scripts (NEW)
│   ├── README.md          # Cloud setup guide
│   ├── setup-cloud-hooks.js
│   └── supabase-schema.sql
├── web/                   # Next.js web application
│   ├── app/api/events/    # Cloud event receiver (NEW)
│   ├── hooks/use-cloud-bridge.ts  # Cloud mode hook (NEW)
│   └── ...
├── extension/             # VS Code extension
├── scripts/               # Build and relay scripts
└── app/                   # Standalone CLI app
```

## Credits

This project is a fork of [Agent Flow](https://github.com/patoles/agent-flow) created by [Simon Patole](https://github.com/patoles) for [CraftMyGame](https://craftmygame.com).

Cloud integration added by [IntuitivePhella](https://github.com/IntuitivePhella).

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

Original project and the name "Agent Flow" are trademarks of Simon Patole. See [TRADEMARK.md](TRADEMARK.md) for usage guidelines.
