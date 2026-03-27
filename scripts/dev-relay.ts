#!/usr/bin/env node
/**
 * Dev relay server — wraps the shared relay with a standalone HTTP server
 * that includes CORS headers for cross-origin dev mode (Next.js on :3000).
 */
import * as http from 'http'
import { createRelay } from './relay'
import { DEFAULT_RELAY_PORT, DEV_WEB_ORIGIN } from '../extension/src/constants'

async function main() {
  const workspace = process.argv[2] || process.cwd()

  console.log('Starting Agent Flow dev relay...\n')
  console.log(`Workspace: ${workspace}`)

  const relay = await createRelay({ workspace, verbose: true })

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', DEV_WEB_ORIGIN)
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.url === '/events') {
      return relay.handleSSE(req, res)
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('Agent Flow Dev Relay')
  })

  server.listen(DEFAULT_RELAY_PORT, '127.0.0.1', () => {
    console.log(`\nSSE relay on http://127.0.0.1:${DEFAULT_RELAY_PORT}/events`)
    console.log('Ready! Events will appear in the web app.')
  })

  function cleanup() {
    server.close()
    relay.dispose()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

main().catch(e => {
  console.error('Failed to start dev relay:', e)
  process.exit(1)
})
