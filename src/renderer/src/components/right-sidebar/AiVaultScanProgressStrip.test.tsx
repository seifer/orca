// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { AiVaultScanProgress } from '../../../../shared/ai-vault-scan-progress'
import type { AiVaultListResult } from '../../../../shared/ai-vault-types'
import { AiVaultScanProgressStrip } from './AiVaultScanProgressStrip'
import { currentAiVaultScanIssueResult } from './ai-vault-scan-issue-state'
import {
  resetAiVaultScanProgressStoreForTests,
  useAiVaultScanProgress
} from './ai-vault-scan-progress-store'

afterEach(() => {
  cleanup()
  resetAiVaultScanProgressStoreForTests()
  vi.unstubAllGlobals()
})

const STOPPED: AiVaultScanProgress = {
  stage: 'stopped',
  agents: [
    { agent: 'claude', files: 24_968, databases: 0, walking: false },
    { agent: 'codex', files: 77_483, databases: 0, walking: true },
    { agent: 'opencode', files: 0, databases: 1, walking: false }
  ],
  read: { done: 0, total: 0 },
  startedAt: 0,
  settledAt: 130_000
}

it('says a stopped scan in the strip, offers Refresh, and opens to the agent it stopped on', async () => {
  const onRefresh = vi.fn()
  render(<AiVaultScanProgressStrip progress={STOPPED} onRefresh={onRefresh} />)
  expect(screen.getByText('102,452 files').parentElement?.textContent).toBe(
    'Stopped after 102,452 files'
  )
  expect(screen.queryByText('Codex')).toBeNull()

  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(onRefresh).toHaveBeenCalledOnce()
  await user.click(screen.getByText('Stopped after', { exact: false }))
  expect(screen.getByText('stopped at 77,483')).toBeTruthy()
  expect(screen.getByText('1 database')).toBeTruthy()
})

it('shows this computer’s scan only to a panel listing this computer', () => {
  let push: (progress: AiVaultScanProgress | null) => void = () => undefined
  vi.stubGlobal('api', {
    aiVault: {
      getScanProgress: () => Promise.resolve(null),
      onScanProgress: (callback: typeof push) => {
        push = callback
        return () => undefined
      }
    }
  })
  const local = renderHook(() => useAiVaultScanProgress('local'))
  const remote = renderHook(() => useAiVaultScanProgress('runtime:server-1'))
  act(() => push(STOPPED))

  expect(local.result.current).toBe(STOPPED)
  // A remote host has no progress stream yet; its panel keeps today's spinner and error line.
  expect(remote.result.current).toBeNull()
})

it('hides the old timeout while refreshing, then shows a newer ordinary failure', () => {
  const oldIssue: AiVaultListResult = {
    sessions: [],
    issues: [],
    scannedAt: new Date(1_000).toISOString()
  }
  const replacement: AiVaultScanProgress = {
    ...STOPPED,
    stage: 'finding',
    startedAt: 2_000,
    settledAt: null
  }
  expect(currentAiVaultScanIssueResult(oldIssue, replacement)).toBeNull()
  expect(currentAiVaultScanIssueResult(oldIssue, { ...replacement, stage: 'finished' })).toBeNull()
  expect(currentAiVaultScanIssueResult(oldIssue, null, true)).toBeNull()
  expect(currentAiVaultScanIssueResult(oldIssue, null)).toBe(oldIssue)
})
