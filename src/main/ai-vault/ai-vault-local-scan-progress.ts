import type { AiVaultScanProgress, AiVaultScanWork } from '../../shared/ai-vault-scan-progress'
import {
  AiVaultServiceDeadlineError,
  type AiVaultServiceScanListener
} from './session-scanner-service-request-deadline'

type Listener = (progress: AiVaultScanProgress | null) => void

/** One local scan from coordinator creation through its service reply. */
export type LocalAiVaultScanProgressHandle = AiVaultServiceScanListener & {
  finish: (work: AiVaultScanWork | null) => void
  fail: (error: unknown) => void
}

let latest: AiVaultScanProgress | null = null
let currentHandle: LocalAiVaultScanProgressHandle | null = null
const listeners = new Set<Listener>()

export function localAiVaultScanProgress(): AiVaultScanProgress | null {
  return latest
}

export function onLocalAiVaultScanProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: AiVaultScanProgress | null): void {
  latest = next
  for (const listener of listeners) {
    listener(next)
  }
}

/** A replacement owns the strip before asynchronous root preparation can yield. */
export function startLocalAiVaultScanProgress(
  now: () => number = Date.now
): LocalAiVaultScanProgressHandle {
  let serviceRequestId: number | null = null
  let current: AiVaultScanProgress = {
    stage: 'finding',
    agents: [],
    read: { done: 0, total: 0 },
    startedAt: now(),
    settledAt: null
  }
  const handle: LocalAiVaultScanProgressHandle = {
    sent: (requestId) => {
      serviceRequestId = requestId
    },
    work: (work) => {
      if (currentHandle === handle) {
        current = { ...current, ...work }
        publish(current)
      }
    },
    finish: (work) => {
      if (currentHandle === handle) {
        currentHandle = null
        publish({ ...current, ...work, stage: 'finished', settledAt: now() })
      }
    },
    fail: (error) => {
      if (currentHandle === handle) {
        currentHandle = null
        if (
          error instanceof AiVaultServiceDeadlineError &&
          error.operation === 'scan' &&
          error.requestId === serviceRequestId
        ) {
          publish({ ...current, stage: 'stopped', settledAt: now() })
        } else {
          publish(null)
        }
      }
    }
  }
  currentHandle = handle
  publish(current)
  return handle
}

/** Runs the scanner service request using the coordinator's progress ownership. */
export async function requestLocalAiVaultScan<T extends { work: AiVaultScanWork | null }>(
  request: (listener: AiVaultServiceScanListener) => Promise<T>,
  options: { now?: () => number; progress?: LocalAiVaultScanProgressHandle } = {}
): Promise<T> {
  const progress = options.progress ?? startLocalAiVaultScanProgress(options.now)
  try {
    const value = await request(progress)
    progress.finish(value.work)
    return value
  } catch (error) {
    progress.fail(error)
    throw error
  }
}

export function resetLocalAiVaultScanProgressForTests(): void {
  latest = null
  currentHandle = null
  listeners.clear()
}
