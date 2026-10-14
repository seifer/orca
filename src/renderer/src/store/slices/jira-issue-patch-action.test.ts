import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { JiraIssue } from '../../../../shared/jira-types'
import {
  getTaskSourceCacheScope,
  type TaskSourceContext
} from '../../../../shared/task-source-context'
import {
  bumpProviderRuntimeSessionGeneration,
  getProviderRuntimeContextKey
} from '@/lib/provider-runtime-context'
import { getJiraReadIdentity } from './jira-read-coordination'
import { createTestStore } from './store-test-helpers'
import { createTabsSliceMockApi } from './tabs-slice-test-harness'

createTabsSliceMockApi()

const issue: JiraIssue = {
  id: '1',
  key: 'ENG-1',
  title: 'Default title',
  siteId: 'site-1',
  url: 'https://example.atlassian.net/browse/ENG-1',
  project: { id: '1', key: 'ENG', name: 'Engineering' },
  issueType: { id: '1', name: 'Task' },
  status: { id: '1', name: 'To Do', categoryKey: 'new', categoryName: 'To Do' },
  labels: [],
  createdAt: '2026-09-01',
  updatedAt: '2026-09-01'
}

const source: TaskSourceContext = {
  kind: 'task-source',
  provider: 'jira',
  projectId: 'project-1',
  hostId: 'local'
}

describe('Jira default-source issue patches', () => {
  it('keeps default-source edits out of explicit source caches on every host', () => {
    const store = createTestStore()
    const cacheKeys = [
      'site-1::ENG-1',
      `${getTaskSourceCacheScope(source)}::site-1::ENG-1`,
      `${getTaskSourceCacheScope({ ...source, hostId: 'runtime:remote-1' })}::site-1::ENG-1`
    ]
    store.setState({
      jiraIssueCache: Object.fromEntries(
        cacheKeys.map((key) => [key, { data: issue, fetchedAt: Date.now() }])
      ),
      jiraSearchCache: Object.fromEntries(
        cacheKeys.map((key) => [key, { data: [issue], fetchedAt: Date.now() }])
      )
    })

    store
      .getState()
      .patchJiraIssue('ENG-1', { title: 'Edited default title' }, { siteId: 'site-1' })

    expect(cacheKeys.map((key) => store.getState().jiraIssueCache[key]?.data?.title)).toEqual([
      'Edited default title',
      'Default title',
      'Default title'
    ])
    expect(cacheKeys.map((key) => store.getState().jiraSearchCache[key]?.data?.[0]?.title)).toEqual(
      ['Edited default title', 'Default title', 'Default title']
    )
  })

  it('ignores a default-source settlement after the active execution host changes', () => {
    const store = createTestStore()
    const contextKey = getProviderRuntimeContextKey(store.getState().settings)
    store.setState({
      settings: { ...getDefaultSettings(''), activeRuntimeEnvironmentId: 'remote-1' },
      jiraIssueCache: {
        'site-1::ENG-1': { data: { ...issue, title: 'Remote title' }, fetchedAt: 1 }
      },
      jiraSearchCache: {
        'site-1::list::assigned::30': { data: [{ ...issue, title: 'Remote title' }], fetchedAt: 1 }
      }
    })
    const before = store.getState()

    store
      .getState()
      .patchJiraIssue('ENG-1', { title: 'Late local title' }, { siteId: 'site-1', contextKey })

    expect(store.getState()).toBe(before)
  })

  it('ignores default-source settlements from an earlier paired session on the same host', () => {
    const store = createTestStore()
    store.setState({
      settings: { ...getDefaultSettings(''), activeRuntimeEnvironmentId: 'remote-1' }
    })
    const contextKey = getProviderRuntimeContextKey(store.getState().settings)
    store.setState({
      jiraIssueCache: { 'site-1::ENG-1': { data: issue, fetchedAt: 1 } }
    })
    const before = store.getState()
    bumpProviderRuntimeSessionGeneration()

    store
      .getState()
      .patchJiraIssue('ENG-1', { title: 'Late title' }, { contextKey, siteId: 'site-1' })

    expect(store.getState()).toBe(before)
  })

  it('still settles explicit-source saves after the default execution host changes', () => {
    const store = createTestStore()
    const contextKey = getJiraReadIdentity(store.getState().settings, source).contextKey
    const cacheKey = `${getTaskSourceCacheScope(source)}::site-1::ENG-1`
    store.setState({
      settings: { ...getDefaultSettings(''), activeRuntimeEnvironmentId: 'remote-1' },
      jiraIssueCache: { [cacheKey]: { data: issue, fetchedAt: 1 } }
    })

    store
      .getState()
      .patchJiraIssue(
        'ENG-1',
        { title: 'Saved explicit title' },
        { sourceContext: source, contextKey, siteId: 'site-1' }
      )

    expect(store.getState().jiraIssueCache[cacheKey]?.data?.title).toBe('Saved explicit title')
  })
})
