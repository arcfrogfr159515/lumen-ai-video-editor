import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ui/error-boundary'
import { language } from './lib/i18n'
import { desktop } from './lib/platform'
import { saveProjectAs } from './project/session'
import { installDecoderRepair } from './engine/codec-repair'
import './styles/index.css'

installDecoderRepair()
// The system's own dialogs (Open, Save, "Save changes?") are shown by the main process: in this window's language.
desktop?.system.setLanguage?.(language)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The last resort: what no panel's own boundary caught still leaves a way to save. */}
    <ErrorBoundary name="Lumen" as="app" onSaveCopy={desktop ? () => void saveProjectAs() : undefined}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Handle for poking at the editor from the console / test scripts (dev, or test launches of a build).
if (import.meta.env.DEV || window.lumen?.testMode) {
  void Promise.all([
    import('@/editor/store'),
    import('@/editor/ui-store'),
    import('@/editor/playback'),
    import('@/features/copilot/store'),
    import('@/integrations/ai'),
    import('@/integrations/store'),
    import('@/project/session'),
    import('@/project/media-import'),
    import('@/engine/export'),
    import('@/editor/smart'),
    import('@/project/transcribe'),
    import('@/engine/audio-engine'),
    import('@/integrations/agent-tools'),
    import('@/engine/media'),
    import('@/project/proxies'),
    import('@/editor/sequences'),
    import('@/editor/timeline-nav'),
    import('@/project/analysis-actions'),
    import('@/engine/render-queue'),
    import('@/project/subtitle-files'),
    import('@/engine/compositor'),
    import('mediabunny'),
    import('@/features/preview/PreviewStage'),
    import('@/engine/render-cache'),
    import('@/engine/preview-res'),
    import('@/engine/stills'),
    import('@/capture/recorder'),
    import('@/editor/timeline-view'),
    import('@/editor/macro-store'),
    import('@/editor/trim-session'),
  ]).then(([store, ui, pb, copilot, ai, integrations, session, media, exporter, smart, transcribe, audio, tools, engineMedia, proxies, sequences, nav, analysis, queue, subtitles, compositor, mediabunny, previewStage, renders, previewRes, stills, recorder, timelineView, macros, trim]) => {
    Object.assign(window, {
      __lumen: {
        editor: store.useEditor,
        dispatch: store.dispatch,
        ui: ui.useUI,
        playback: pb.playback,
        usePlayback: pb.usePlayback,
        copilot,
        ai,
        integrations,
        session,
        media,
        exporter,
        smart,
        transcribe,
        audio,
        tools,
        engineMedia,
        proxies,
        sequences,
        nav,
        analysis,
        queue,
        subtitles,
        compositor,
        mediabunny,
        previewStage,
        renders,
        previewRes,
        stills,
        recorder,
        timelineView: timelineView.useTimelineView,
        macros,
        trim,
      },
    })
  })
}
