import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { getEnvironmentRuntimeContextKey } from '@/lib/provider-runtime-context'
import { runtimeTargetEnvironmentId } from '@/runtime/runtime-client-target'
import { translate } from '@/i18n/i18n'
import { classifyTransitionRequirements } from '../../../shared/jira-transition-fields'
import type {
  JiraIssue,
  JiraIssueUpdate,
  JiraProjectStatusOrder,
  JiraTransition
} from '../../../shared/jira-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { TaskPageJiraBoard, jiraBoardIssueRefKey } from './task-page-jira-board'
import type { TaskPageJiraBoardSection } from './task-page-jira-board-sections'
import { JiraBoardMoveDialog, type JiraBoardMovePrompt } from './task-page-jira-board-move-dialog'
import { applyJiraBoardMove, getJiraBoardMoveTransitions } from './task-page-jira-board-move'
import { formatRelativeTime } from './task-page-source-context'

type Props = {
  issues: JiraIssue[]
  statusOrder: JiraProjectStatusOrder | null
  selectedIssue: JiraIssue | null
  sourceContext: TaskSourceContext | null
  target: RuntimeClientTarget | null
  scopeKey: string
  showSiteContext: boolean
  loading?: boolean
  onOpenIssue: (issue: JiraIssue) => void
  onStartWorkspace: (issue: JiraIssue) => void
  onRefresh: () => void
}

export function TaskPageJiraBoardView({
  issues,
  statusOrder,
  selectedIssue,
  sourceContext,
  target,
  scopeKey,
  showSiteContext,
  loading = false,
  onOpenIssue,
  onStartWorkspace,
  onRefresh
}: Props): React.JSX.Element {
  const patchJiraIssue = useAppStore((state) => state.patchJiraIssue)
  const [prompt, setPrompt] = useState<JiraBoardMovePrompt | null>(null)
  const [pending, setPending] = useState(false)
  const lockedIssueRef = useRef<string | null>(null)
  const lastDestinationRef = useRef<TaskPageJiraBoardSection | null>(null)
  const requestRef = useRef(0)
  useEffect(
    () => () => {
      requestRef.current += 1
    },
    []
  )

  function close(): void {
    if (pending) {
      return
    }
    requestRef.current += 1
    lockedIssueRef.current = null
    setPrompt(null)
  }

  async function apply(
    issue: JiraIssue,
    transition: JiraTransition,
    updates: JiraIssueUpdate
  ): Promise<void> {
    if (!target) {
      return
    }
    const request = requestRef.current
    const patchOptions = {
      sourceContext,
      siteId: issue.siteId,
      ...(!sourceContext
        ? { contextKey: getEnvironmentRuntimeContextKey(runtimeTargetEnvironmentId(target)) }
        : {})
    }
    setPending(true)
    patchJiraIssue(issue.key, { status: transition.to }, patchOptions)
    try {
      const { result, latest } = await applyJiraBoardMove(target, issue, updates)
      if (!result.ok) {
        throw new Error(result.error)
      }
      if (latest) {
        patchJiraIssue(issue.key, latest, patchOptions)
      }
      if (requestRef.current !== request) {
        return
      }
      lockedIssueRef.current = null
      setPrompt(null)
      onRefresh()
    } catch (error) {
      patchJiraIssue(issue.key, { status: issue.status }, patchOptions)
      if (requestRef.current !== request) {
        return
      }
      setPrompt((current) =>
        current
          ? {
              ...current,
              selected: transition,
              error: error instanceof Error ? error.message : 'Failed to change status.'
            }
          : null
      )
    } finally {
      if (requestRef.current === request) {
        setPending(false)
      }
    }
  }

  async function choose(issue: JiraIssue, transition: JiraTransition): Promise<void> {
    setPrompt((current) => (current ? { ...current, selected: transition, error: null } : null))
    if (classifyTransitionRequirements(transition).kind === 'none') {
      await apply(issue, transition, { transitionId: transition.id })
    }
  }

  async function move(
    issue: JiraIssue,
    destination: TaskPageJiraBoardSection,
    force = false
  ): Promise<void> {
    if (loading || !target || lockedIssueRef.current) {
      return
    }
    const request = ++requestRef.current
    lockedIssueRef.current = jiraBoardIssueRefKey(issue)
    lastDestinationRef.current = destination
    setPrompt({
      issue,
      destination: destination.label,
      selected: null,
      transitions: [],
      error: null,
      loading: true
    })
    try {
      const transitions = await getJiraBoardMoveTransitions(
        target,
        scopeKey,
        issue,
        destination,
        force
      )
      if (requestRef.current !== request) {
        return
      }
      if (!transitions.length) {
        throw new Error(
          translate(
            'jira.board.noTransition',
            'No status change to {{column}} is available for {{key}}.',
            { column: destination.label, key: issue.key }
          )
        )
      }
      setPrompt({
        issue,
        destination: destination.label,
        selected: null,
        transitions,
        error: null,
        loading: false
      })
      if (transitions.length === 1) {
        await choose(issue, transitions[0])
      }
    } catch (error) {
      if (requestRef.current !== request) {
        return
      }
      setPrompt({
        issue,
        destination: destination.label,
        selected: null,
        transitions: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load status changes.'
      })
    }
  }

  return (
    <>
      <TaskPageJiraBoard
        issues={issues}
        statusOrder={statusOrder}
        selectedIssue={selectedIssue}
        showSiteContext={showSiteContext}
        onOpenIssue={onOpenIssue}
        onStartWorkspace={onStartWorkspace}
        formatUpdatedAt={formatRelativeTime}
        updatingIssueKeys={
          new Set(
            loading || !target
              ? issues.map(jiraBoardIssueRefKey)
              : prompt
                ? [jiraBoardIssueRefKey(prompt.issue)]
                : []
          )
        }
        onMoveIssue={move}
      />
      <JiraBoardMoveDialog
        prompt={prompt}
        pending={pending}
        onClose={close}
        onChoose={(transition) => {
          if (prompt) {
            void choose(prompt.issue, transition)
          }
        }}
        onSubmit={async (updates) => {
          if (prompt?.selected) {
            await apply(prompt.issue, prompt.selected, updates)
          }
        }}
        onRetry={() => {
          if (!prompt || !lastDestinationRef.current) {
            return
          }
          const issue = prompt.issue
          const destination = lastDestinationRef.current
          lockedIssueRef.current = null
          void move(issue, destination, true)
        }}
      />
    </>
  )
}
