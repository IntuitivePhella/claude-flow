# Agent Flow Cloud Deployment

Deploy Agent Flow to the cloud while receiving events from your local Claude Code instance.

## Two Modes of Operation

### 1. Cloud Relay (Recommended) - Full Features

The Cloud Relay watches your local JSONL transcripts and sends rich event data to the cloud.

**Features**: Chat messages, token counts, cost tracking, files, tool calls, subagents.

```bash
# Run alongside Claude Code
pnpm run cloud:relay -- --url https://your-site.netlify.app --token YOUR_TOKEN
```

### 2. Hooks Only - Lightweight

Claude Code hooks send events directly to the cloud. No local process needed.

**Features**: Tool calls, subagents, files. **No** chat messages or token counts.

## Architecture

### With Cloud Relay (Full Features)
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

### With Hooks Only (Limited)
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

## Quick Start

### Step 1: Create Supabase Project

1. Go to https://supabase.com and create a free project
2. Go to **SQL Editor** and run the schema from `supabase-schema.sql`
3. Go to **Settings > API** and copy:
   - Project URL (e.g., `https://abc123.supabase.co`)
   - `anon` public key
   - `service_role` secret key

### Step 2: Generate a Channel Token

Generate a random token that will authenticate your events:

```bash
# On Linux/Mac:
openssl rand -hex 16

# Or use any password generator
# Example: af7b2c9d1e3f4a5b6c7d8e9f0a1b2c3d
```

### Step 3: Deploy to Netlify

#### Option A: One-Click Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/IntuitivePhella/claude-flow)

#### Option B: Deploy via Netlify CLI

```bash
cd web
pnpm install
netlify login
netlify init
netlify env:set NEXT_PUBLIC_SUPABASE_URL "https://your-project.supabase.co"
netlify env:set NEXT_PUBLIC_SUPABASE_ANON_KEY "your-anon-key"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "your-service-role-key"
netlify env:set AGENT_FLOW_CHANNEL_TOKEN "your-secret-token"
netlify env:set NEXT_PUBLIC_AGENT_FLOW_CHANNEL_TOKEN "your-secret-token"
netlify deploy --prod
```

#### Option C: Deploy via GitHub

1. Fork/push this repo to GitHub
2. Go to https://app.netlify.com/start
3. Connect your GitHub repo
4. Set build settings:
   - Base directory: `web`
   - Build command: `pnpm run build`
   - Publish directory: `web/.next`
5. Add environment variables in **Site settings > Environment variables**

### Step 4: Configure Local Hooks

Run the setup script on your local machine:

```bash
node cloud/setup-cloud-hooks.js \
  --url https://your-site.netlify.app \
  --token your-secret-token
```

This modifies your `~/.claude/settings.json` to send Claude Code events to your cloud deployment.

### Step 5: Run Cloud Relay (For Full Features)

For chat messages, token counts, and cost tracking:

```bash
# From the project root
pnpm run cloud:relay -- --url https://your-site.netlify.app --token your-secret-token

# With verbose logging
pnpm run cloud:relay -- --url https://your-site.netlify.app --token your-secret-token --verbose

# Specify a different workspace
pnpm run cloud:relay -- --url https://your-site.netlify.app --token your-secret-token --workspace /path/to/project
```

### Step 6: Test It!

1. Open your deployed app URL in a browser
2. Start the cloud relay (if using full features)
3. Start a new Claude Code session in your terminal
4. You should see events appear in the cloud dashboard!

## Feature Comparison

| Feature | Cloud + Relay | Cloud + Hooks Only |
|---------|---------------|-------------------|
| Tool calls visualization | ✅ | ✅ |
| Subagent tracking | ✅ | ✅ |
| Files panel | ✅ | ✅ |
| Chat/Transcript | ✅ | ❌ |
| Token counts | ✅ | ❌ |
| Cost tracking | ✅ | ❌ |
| Context breakdown | ✅ | ❌ |
| Requires local process | Cloud Relay | None |

## Troubleshooting

### Events not appearing?

1. Check browser console for connection errors
2. Verify environment variables are set correctly in Netlify
3. Check that the token in your local hook matches the cloud token
4. Look at Netlify function logs for errors
5. Try the debug endpoint: `https://your-site.netlify.app/api/debug`

### Chat/Tokens not showing?

You need to run the Cloud Relay for full features:

```bash
pnpm run cloud:relay -- --url https://your-site.netlify.app --token YOUR_TOKEN
```

Claude Code hooks only provide tool events, not message content or token counts.

### "Unauthorized" errors?

The token in your local hook (`~/.claude/agent-flow/cloud-hook.js`) must match `AGENT_FLOW_CHANNEL_TOKEN` in Netlify.

### Supabase Realtime not working?

1. Make sure you ran the SQL schema to create the table
2. Check that Realtime is enabled for the `agent_flow_events` table
3. Verify your Supabase keys are correct

### Session cleanup

Events are automatically deleted from Supabase when you run `/exit` in Claude Code.

## Files

| File | Description |
|------|-------------|
| `supabase-schema.sql` | SQL schema for the events table |
| `setup-cloud-hooks.js` | Script to configure local Claude Code hooks |
| `cloud-relay.ts` | Cloud relay that watches JSONL and sends rich events |
| `../web/app/api/events/route.ts` | Next.js API route that receives events |
| `../web/hooks/use-cloud-bridge.ts` | React hook for cloud mode |

## Security Notes

- The `AGENT_FLOW_CHANNEL_TOKEN` authenticates event submissions
- Keep your `SUPABASE_SERVICE_ROLE_KEY` secret (server-side only)
- Events are deleted when session ends (`/exit` command)
- No sensitive data (file contents, credentials) is transmitted
