// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { AiVaultScanProgress } from '../../../../shared/ai-vault-scan-progress'
import type { AiVaultListResult } from '../../../../shared/ai-vault-types'
import { aiVaultLocalScanKey } from '../../../../shared/ai-vault-local-scan-key'
import { AiVaultScanProgressStrip } from './AiVaultScanProgressStrip'
import { AiVaultScanIssueBanners } from './AiVaultScanIssueBanners'
import { reuseAiVaultListResult } from './ai-vault-session-identity'
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
  scanId: 'scan-a',
  scanKey: 'scope-a',
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

it('keeps a narrower cached panel off the broader key while a late matching panel loads it', async () => {
  const lowerDepth = { scopePaths: ['/project'], includeAntigravityIdeSessions: true, limit: 100 }
  const broader = aiVaultLocalScanKey({ ...lowerDepth, limit: 1000 })
  const narrower = aiVaultLocalScanKey(lowerDepth)
  expect(broader).not.toBe(narrower)
  const cachedProgress: AiVaultScanProgress = { ...STOPPED, stage: 'finished', scanKey: broader }
  let push: (update: { scanKey: string; progress: AiVaultScanProgress | null }) => void = () =>
    undefined
  vi.stubGlobal('api', {
    aiVault: {
      getScanProgress: (scanKey: string) =>
        Promise.resolve(scanKey === broader ? cachedProgress : null),
      onScanProgress: (callback: typeof push) => {
        push = callback
        return () => undefined
      }
    }
  })
  const local = renderHook(() => useAiVaultScanProgress('local', broader))
  const narrowerPanel = renderHook(() => useAiVaultScanProgress('local', narrower))
  const remote = renderHook(() => useAiVaultScanProgress('runtime:server-1', broader))
  await waitFor(() => expect(local.result.current).toBe(cachedProgress))
  act(() => push({ scanKey: broader, progress: cachedProgress }))

  expect(local.result.current).toBe(cachedProgress)
  expect(narrowerPanel.result.current).toBeNull()
  act(() =>
    push({ scanKey: broader, progress: { ...cachedProgress, scanId: 'later', stage: 'finding' } })
  )
  expect(narrowerPanel.result.current).toBeNull()
  // A remote host has no progress stream yet; its panel keeps today's spinner and error line.
  expect(remote.result.current).toBeNull()
})

it('hides an old issue only while this panel is refreshing', () => {
  const oldIssue: AiVaultListResult = {
    sessions: [],
    issues: [],
    scannedAt: new Date(1_000).toISOString()
  }
  expect(currentAiVaultScanIssueResult(oldIssue, true)).toBeNull()
  expect(currentAiVaultScanIssueResult(oldIssue)).toBe(oldIssue)
})

it('keeps a panel failure visible through another key’s scan and replaces only its own stopped timeout', () => {
  let push: (update: { scanKey: string; progress: AiVaultScanProgress | null }) => void = () =>
    undefined
  vi.stubGlobal('api', {
    aiVault: {
      getScanProgress: () => Promise.resolve(null),
      onScanProgress: (callback: typeof push) => {
        push = callback
        return () => undefined
      }
    }
  })
  const issue = {
    agent: 'codex' as const,
    kind: 'host' as const,
    executionHostId: 'local' as const,
    path: 'this computer',
    message: 'Local scan failed.'
  }
  const failed: AiVaultListResult = {
    sessions: [],
    issues: [issue],
    scannedAt: new Date(1_000).toISOString(),
    scanId: 'scan-a-old',
    scanKey: 'scope-a'
  }
  function Panel({ scanKey, result }: { scanKey: string; result: AiVaultListResult | null }) {
    const progress = useAiVaultScanProgress('local', scanKey)
    return (
      <>
        {progress ? (
          <AiVaultScanProgressStrip progress={progress} onRefresh={() => undefined} />
        ) : null}
        <AiVaultScanIssueBanners
          scanResult={currentAiVaultScanIssueResult(result)}
          localScanStopShown={progress?.stage === 'stopped' && result?.scanId === progress.scanId}
        />
      </>
    )
  }
  const a = render(<Panel scanKey="scope-a" result={failed} />)
  const b = render(<Panel scanKey="scope-b" result={null} />)
  const other = { ...STOPPED, scanId: 'scan-b', scanKey: 'scope-b' }
  act(() => push({ scanKey: 'scope-b', progress: { ...other, stage: 'finding' } }))
  expect(a.getByText('Local scan failed.')).toBeTruthy()
  expect(b.getByText('Scanning', { exact: false })).toBeTruthy()
  act(() => push({ scanKey: 'scope-b', progress: other }))
  expect(a.getByText('Local scan failed.')).toBeTruthy()
  act(() => push({ scanKey: 'scope-a', progress: STOPPED }))
  expect(a.getByText('Local scan failed.')).toBeTruthy()
  const timedOut = reuseAiVaultListResult(failed, {
    ...failed,
    scanId: 'scan-a',
    issues: [{ ...issue, message: 'Local scan timed out.' }]
  })
  a.rerender(<Panel scanKey="scope-a" result={timedOut} />)
  expect(a.queryByText('Local scan timed out.')).toBeNull()
  expect(a.queryByText('Local scan failed.')).toBeNull()
  const nextFailure = reuseAiVaultListResult(timedOut, { ...failed, scanId: 'scan-a-next' })
  a.rerender(<Panel scanKey="scope-a" result={nextFailure} />)
  expect(a.getByText('Local scan failed.')).toBeTruthy()
})
