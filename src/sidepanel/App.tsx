import { useCallback, useEffect, useState } from 'react'
import type { FeatureId, ResultDoc, ReviewContext, Settings as SettingsType } from '@/lib/types'
import type { PageInfo, Reply } from '@/lib/messaging/types'
import { sendMessage } from '@/lib/messaging/types'
import { DEFAULT_SETTINGS, getSettings, setSettings } from '@/lib/storage/settings'
import { getAllowanceExhausted, setAllowanceExhausted } from '@/lib/storage/client'
import { getOnboardingDismissed, isOnboarded } from '@/lib/storage/profile'
import { config } from '@/lib/config'
import { SourceBadge } from './components/SourceBadge'
import { ModeSelector } from './components/ModeSelector'
import { DepthSelector } from './components/DepthSelector'
import { FeatureButtons } from './components/FeatureButtons'
import { ResultView } from './components/ResultView'
import { Loading } from './components/Loading'
import { ApiKeyGate } from './components/ApiKeyGate'
import { Settings } from './components/Settings'
import { HistoryView } from './components/HistoryView'
import { Onboarding } from './components/Onboarding'
import { ReviewContextModal } from './components/ReviewContextModal'

const hasChrome = typeof chrome !== 'undefined' && !!chrome.runtime

type View = 'main' | 'settings' | 'history'

export default function App() {
  const [settings, setSettingsState] = useState<SettingsType | null>(null)
  const [view, setView] = useState<View>('main')
  const [tabId, setTabId] = useState<number | null>(null)
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [running, setRunning] = useState<FeatureId | null>(null)
  const [result, setResult] = useState<ResultDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exhausted, setExhausted] = useState(false)
  const [onboarded, setOnboarded] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const [pendingReview, setPendingReview] = useState(false)
  const [deepRunning, setDeepRunning] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      const [s, exh, ob, dis] = await Promise.all([
        getSettings(),
        getAllowanceExhausted(),
        isOnboarded(),
        getOnboardingDismissed(),
      ])
      setSettingsState(s)
      setExhausted(exh)
      setOnboarded(ob)
      setDismissed(dis)
    } catch {
      setSettingsState(DEFAULT_SETTINGS)
    }
  }, [])

  const refreshPage = useCallback(async () => {
    if (!hasChrome || !chrome.tabs) {
      setPageLoading(false)
      return
    }
    setPageLoading(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (!tab?.id) {
        setPageInfo(null)
        setTabId(null)
        return
      }
      setTabId(tab.id)
      const res = await sendMessage({ type: 'GET_PAGE_INFO', tabId: tab.id })
      setPageInfo(res.ok ? res.data : null)
    } catch {
      setPageInfo(null)
    } finally {
      setPageLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
    refreshPage()
    if (!hasChrome || !chrome.tabs) return
    const onActivated = () => refreshPage()
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.status === 'complete') refreshPage()
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
  }, [loadSettings, refreshPage])

  const runFeature = async (id: FeatureId) => {
    if (!tabId) {
      setError('Open PM Co-Pilot on a web page first.')
      return
    }
    // PM Review collects per-review context first; other features run directly.
    if (id === 'pm_review') {
      setPendingReview(true)
      return
    }
    await execFeature(id)
  }

  const handleResult = async (res: Reply<ResultDoc>) => {
    if (res.ok) setResult(res.data)
    else if (res.code === 'demo_allowance_exhausted') {
      setExhausted(true)
      try {
        await setAllowanceExhausted(true)
      } catch {
        /* storage unavailable */
      }
    } else setError(res.error)
  }

  const execFeature = async (id: FeatureId, reviewContext?: ReviewContext) => {
    if (!tabId) {
      setError('Open PM Co-Pilot on a web page first.')
      return
    }
    setRunning(id)
    setError(null)
    setResult(null)
    try {
      const res = await sendMessage({ type: 'RUN_FEATURE', tabId, featureId: id, reviewContext })
      await handleResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setRunning(null)
    }
  }

  const execDeepReview = async (reviewContext: ReviewContext) => {
    if (!tabId) {
      setError('Open PM Co-Pilot on a web page first.')
      return
    }
    setRunning('pm_review')
    setDeepRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await sendMessage({ type: 'RUN_DEEP_REVIEW', tabId, reviewContext })
      await handleResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setRunning(null)
      setDeepRunning(false)
    }
  }

  const persist = async (patch: Partial<SettingsType>) => {
    setSettingsState(await setSettings(patch))
  }

  if (!settings) {
    return <div className="p-4 text-sm text-slate-500">Loading…</div>
  }

  const demo = settings.demoMode || config.demoMode
  const enableDemo = async () => setSettingsState(await setSettings({ demoMode: true }))
  const needsOnboarding = !onboarded && !dismissed

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-base">🧭</span>
          <span className="text-sm font-bold text-slate-900">PM Co-Pilot</span>
          {demo && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">
              Demo
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView(view === 'history' ? 'main' : 'history')}
            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            History
          </button>
          <button
            onClick={() => setView(view === 'settings' ? 'main' : 'settings')}
            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Settings
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-3 p-3">
        {needsOnboarding ? (
          <Onboarding onDone={loadSettings} />
        ) : !config.hasBackend && !settings.apiKey && !demo ? (
          <ApiKeyGate onSaved={loadSettings} onTryDemo={enableDemo} />
        ) : view === 'settings' ? (
          <Settings settings={settings} onChange={setSettingsState} onBack={() => setView('main')} />
        ) : view === 'history' ? (
          <HistoryView
            onOpen={(r) => {
              setResult(r)
              setView('main')
            }}
            onBack={() => setView('main')}
          />
        ) : (
          <>
            {demo && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                Demo mode — features return <strong>sample data</strong> (no API call). Turn it off in
                Settings once your key/proxy is live.
              </div>
            )}
            {exhausted && (
              <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-[13px] text-brand-800">
                🎉 You've used your free PM Reviews. The <strong>full version is coming soon</strong> —
                thanks for trying PM Co-Pilot!
              </div>
            )}
            <SourceBadge info={pageInfo} loading={pageLoading} />
            <div className="grid grid-cols-1 gap-2.5">
              <ModeSelector mode={settings.mode} onChange={(m) => persist({ mode: m })} disabled={!!running} />
              <DepthSelector
                depth={settings.researchDepth}
                onChange={(d) => persist({ researchDepth: d })}
                disabled={!!running}
              />
            </div>
            <FeatureButtons onRun={runFeature} running={running} disabled={!!running} />

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">
                {error}
              </div>
            )}
            {running && (
              <Loading
                label={
                  deepRunning
                    ? 'Running multi-agent analysis…'
                    : running === 'pm_review'
                      ? 'Researching the web…'
                      : 'Generating…'
                }
              />
            )}
            {!running && result && <ResultView result={result} />}
          </>
        )}
      </main>

      {pendingReview && (
        <ReviewContextModal
          onCancel={() => setPendingReview(false)}
          onRun={(rc, deep) => {
            setPendingReview(false)
            if (deep) execDeepReview(rc)
            else execFeature('pm_review', rc)
          }}
        />
      )}
    </div>
  )
}
