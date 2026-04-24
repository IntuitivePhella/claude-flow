'use client'

import { useVSCodeBridge } from './use-vscode-bridge'
import { useCloudBridge } from './use-cloud-bridge'

/**
 * Unified bridge hook that automatically selects between:
 * - Cloud mode: when NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_AGENT_FLOW_CHANNEL_TOKEN are set
 * - Local mode: VS Code extension or local relay server
 */
export function useBridge() {
  const vscode = useVSCodeBridge()
  const cloud = useCloudBridge()

  // Use cloud bridge if cloud mode is enabled and we're not in VS Code
  if (cloud.isCloudMode && !vscode.isVSCode) {
    return {
      ...cloud,
      useMockData: false,
      disable1MContext: false,
      isVSCode: false,
    }
  }

  return vscode
}
