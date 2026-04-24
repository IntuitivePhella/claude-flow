# Agent Flow Cloud

Real-time visualization of Claude Code and Codex agent orchestration — **with cloud deployment support**.

This is a fork of [Agent Flow](https://github.com/patoles/agent-flow) by [Simon Patole](https://github.com/patoles), extended with cloud capabilities using Supabase Realtime. Monitor your local AI coding sessions from anywhere.

![Agent Flow visualization](https://res.cloudinary.com/dxlvclh9c/image/upload/v1773924941/screenshot_e7yox3.png)

## What's New in This Fork

- **Cloud Mode**: Deploy to Netlify/Vercel and receive events from your local Claude Code via HTTPS
- **Cloud Relay**: Full-featured monitoring with chat messages, token counts, and cost tracking
- **Supabase Realtime**: Live event streaming using Supabase's real-time infrastructure
- **Remote Monitoring**: Watch your AI agents work from any device, anywhere

## Quick Start

### Option 1: Local Mode (Full Features)

Best for local development with complete visualization.

```bash
git clone https://github.com/IntuitivePhella/claude-flow.git
cd claude-flow
pnpm install
pnpm run setup      # configure Claude Code hooks
pnpm run dev        # start web app + event relay
```

Open http://localhost:3000 and start a Claude Code session.

**Features**: All panels work (Chat, Files, Cost, Timeline, Token tracking).

### Option 2: Cloud Mode with Cloud Relay (Recommended for Remote)

Full-featured remote monitoring using the Cloud Relay.

```bash
# 1. Deploy to Netlify (see Cloud Setup below)

# 2. Configure hooks to point to your deployment
node cloud/setup-cloud-hooks.js --url https://your-site.netlify.app --token YOUR_SECRET

# 3. Run the cloud relay alongside Claude Code
pnpm run cloud:relay -- --url https://your-site.netlify.app --token YOUR_SECRET
```

**Features**: All panels work (Chat, Files, Cost, Timeline, Token tracking).

### Option 3: Cloud Mode with Hooks Only (Lightweight)

Minimal setup, but limited features.

```bash
# 1. Deploy to Netlify (see Cloud Setup below)

# 2. Configure hooks only (no relay needed)
node cloud/setup-cloud-hooks.js --url https://your-site.netlify.app --token YOUR_SECRET
```

**Features**: Tool calls, subagents, files tracking. **No** chat messages or token counts.

## Architecture

### Local Mode
```
┌─────────────────┐                      ┌──────────────────┐
│  Claude Code    │  ◄── JSONL files ──► │  Local Relay     │
│  (your machine) │                      │  (watches files) │
└─────────────────┘                      └────────┬─────────┘
                                                  │ SSE
                                                  ▼
                                         ┌──────────────────┐
                                         │   localhost:3000 │
                                         └──────────────────┘
```

### Cloud Mode with Relay (Full Features)
```
┌─────────────────┐                      ┌──────────────────┐
│  Claude Code    │  ◄── JSONL files ──► │  Cloud Relay     │
│  (your machine) │                      │  (watches files) │
└─────────────────┘                      └────────┬─────────┘
                                                  │ HTTPS
                                                  ▼
                                         ┌──────────────────┐
                                         │  Netlify/Vercel  │
                                         │  + Supabase      │
                                         └────────┬─────────┘
                                                  │ Realtime
                                                  ▼
                                         ┌──────────────────┐
                                         │   Web Browser    │
                                         │   (anywhere)     │
                                         └──────────────────┘
```

### Cloud Mode with Hooks Only (Limited)
```
┌─────────────────┐     Claude Hooks     ┌──────────────────┐
│  Claude Code    │ ──────────────────►  │  Netlify/Vercel  │
│  (your machine) │   (tool events only) │  + Supabase      │
└─────────────────┘                      └────────┬─────────┘
                                                  │ Realtime
                                                  ▼
                                         ┌──────────────────┐
                                         │   Web Browser    │
                                         └──────────────────┘
```

## Feature Comparison

| Feature | Local Mode | Cloud + Relay | Cloud + Hooks Only |
|---------|------------|---------------|-------------------|
| Tool calls visualization | ✅ | ✅ | ✅ |
| Subagent tracking | ✅ | ✅ | ✅ |
| Files panel | ✅ | ✅ | ✅ |
| Chat/Transcript | ✅ | ✅ | ❌ |
| Token counts | ✅ | ✅ | ❌ |
| Cost tracking | ✅ | ✅ | ❌ |
| Context breakdown | ✅ | ✅ | ❌ |
| Remote access | ❌ | ✅ | ✅ |
| Requires local process | Relay | Cloud Relay | None |

## Cloud Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Run the schema in the SQL Editor:

```sql
-- Create events table
create table agent_flow_events (
  id uuid primary key default gen_random_uuid(),
  channel_token text not null,
  session_id text,
  event_type text not null,
  payload jsonb not null,
  event_time float not null,
  created_at timestamptz default now()
);

-- Enable realtime
alter publication supabase_realtime add table agent_flow_events;

-- Create index for faster queries
create index idx_agent_flow_events_session on agent_flow_events(session_id);
create index idx_agent_flow_events_token on agent_flow_events(channel_token);
```

### 2. Deploy to Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/IntuitivePhella/claude-flow)

Set these environment variables in Netlify:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `AGENT_FLOW_CHANNEL_TOKEN` | Secret token (generate one) |
| `NEXT_PUBLIC_AGENT_FLOW_CHANNEL_TOKEN` | Same token (for frontend) |

### 3. Configure Local Machine

```bash
# Generate a secure token
TOKEN=$(openssl rand -hex 16)
echo "Your token: $TOKEN"

# Configure Claude Code hooks
node cloud/setup-cloud-hooks.js --url https://your-site.netlify.app --token $TOKEN
```

### 4. Run Cloud Relay (Recommended)

For full features (chat, tokens, cost), run the cloud relay:

```bash
pnpm run cloud:relay -- --url https://your-site.netlify.app --token YOUR_TOKEN

# Or with verbose logging
pnpm run cloud:relay -- --url https://your-site.netlify.app --token YOUR_TOKEN --verbose
```

The relay watches your local JSONL transcripts and sends rich event data to the cloud.

## Monitoring Any Project

To monitor Claude Code usage in any codebase:

### Key Points

| Aspect | Detail |
|--------|--------|
| **Workspace** | Use `--workspace` to specify which project to monitor (defaults to current directory) |
| **Same machine** | The relay must run on the same machine where Claude Code is running |
| **Token match** | The token in local hooks must match the cloud deployment's `AGENT_FLOW_CHANNEL_TOKEN` |
| **Auto-detection** | The relay automatically detects active sessions in the specified workspace |
| **Full features** | Without the relay, only tool calls appear (no chat, tokens, or cost tracking) |

### Typical Workflow

```bash
# Terminal 1: Start the cloud relay for your project
pnpm run cloud:relay -- --url https://your-site.netlify.app --token YOUR_TOKEN --workspace /path/to/your/project

# Terminal 2: Use Claude Code normally in that project
cd /path/to/your/project
claude
```

The web UI will automatically show the session when Claude Code starts.

### Monitoring Multiple Projects

Run separate relay instances for each project:

```bash
# Project A
pnpm run cloud:relay -- --url https://your-site.netlify.app --token YOUR_TOKEN --workspace /path/to/project-a

# Project B (different terminal)
pnpm run cloud:relay -- --url https://your-site.netlify.app --token YOUR_TOKEN --workspace /path/to/project-b
```

## Development

```bash
pnpm install              # install dependencies
pnpm run setup            # configure Claude Code hooks (local mode)
pnpm run dev              # start dev server + relay
pnpm run dev:demo         # start with mock data
pnpm run build:all        # production build
pnpm run cloud:relay      # run cloud relay (requires --url and --token)
```

## Project Structure

```
├── cloud/                 # Cloud deployment tools
│   ├── README.md          # Detailed cloud setup guide
│   ├── cloud-relay.ts     # Cloud relay script (watches JSONL, sends to cloud)
│   ├── setup-cloud-hooks.js  # Configure Claude hooks for cloud
│   └── supabase-schema.sql   # Database schema
├── web/                   # Next.js web application
│   ├── app/api/events/    # Cloud event receiver API
│   ├── hooks/
│   │   ├── use-cloud-bridge.ts  # Cloud mode event handling
│   │   ├── use-bridge.ts        # Local mode (SSE)
│   │   └── use-agent-simulation.ts  # Core simulation logic
│   └── components/        # React components
├── extension/             # VS Code extension
│   └── src/
│       ├── transcript-parser.ts  # JSONL parsing logic
│       └── protocol.ts           # Event type definitions
├── scripts/               # Build and relay scripts
│   └── relay.ts           # Local relay server
└── app/                   # Standalone CLI app
```

## Troubleshooting

### Events not appearing in cloud UI

1. Check that hooks are configured: `cat ~/.claude/settings.json | grep cloud-hook`
2. Verify the token matches between hooks and Netlify environment
3. Check Netlify function logs for errors
4. Try the debug endpoint: `https://your-site.netlify.app/api/debug`

### Chat/Tokens not showing in cloud mode

You need to run the Cloud Relay for full features:

```bash
pnpm run cloud:relay -- --url https://your-site.netlify.app --token YOUR_TOKEN
```

Without the relay, only tool events are captured (Claude hooks don't expose message content or token counts).

### Session cleanup

Events are automatically deleted from Supabase when you run `/exit` in Claude Code.

## Credits

This project is a fork of [Agent Flow](https://github.com/patoles/agent-flow) created by [Simon Patole](https://github.com/patoles) for [CraftMyGame](https://craftmygame.com).

Cloud integration added by [IntuitivePhella](https://github.com/IntuitivePhella).

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

Original project and the name "Agent Flow" are trademarks of Simon Patole. See [TRADEMARK.md](TRADEMARK.md) for usage guidelines.
