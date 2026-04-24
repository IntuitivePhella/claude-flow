# Agent Flow Cloud Deployment

Deploy Agent Flow to the cloud while receiving events from your local Claude Code instance.

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

#### Option A: Deploy via Netlify CLI

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

#### Option B: Deploy via GitHub

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

### Step 5: Test It!

1. Open your deployed app URL in a browser
2. Start a new Claude Code session in your terminal
3. You should see events appear in the cloud dashboard!

## Troubleshooting

### Events not appearing?

1. Check browser console for connection errors
2. Verify environment variables are set correctly in Netlify
3. Check that the token in your local hook matches the cloud token
4. Look at Netlify function logs for errors

### "Unauthorized" errors?

The token in your local hook (`~/.claude/agent-flow/cloud-hook.js`) must match `AGENT_FLOW_CHANNEL_TOKEN` in Netlify.

### Supabase Realtime not working?

1. Make sure you ran the SQL schema to create the table
2. Check that Realtime is enabled for the `agent_flow_events` table
3. Verify your Supabase keys are correct

## Files

| File | Description |
|------|-------------|
| `supabase-schema.sql` | SQL schema for the events table |
| `setup-cloud-hooks.js` | Script to configure local Claude Code hooks |
| `../web/app/api/events/route.ts` | Next.js API route that receives events |
| `../web/hooks/use-cloud-bridge.ts` | React hook for cloud mode |

## Security Notes

- The `AGENT_FLOW_CHANNEL_TOKEN` authenticates event submissions
- Keep your `SUPABASE_SERVICE_ROLE_KEY` secret (server-side only)
- Events are stored for 24 hours then auto-deleted
- No sensitive data (file contents, credentials) is transmitted
