import { LoaderCircle } from 'lucide-react'
import { useEffect } from 'react'
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels'
import { Toaster } from 'sonner'
import { startTimelineNav } from '@/editor/timeline-nav'
import { startMediaEngine } from '@/engine/wiring'
import { HomeScreen } from '@/features/home/HomeScreen'
import { startSession, useSession } from '@/project/session'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AssetsPanel } from '@/features/assets/AssetsPanel'
import { CommandPalette } from '@/features/command/CommandPalette'
import { ExportDialog } from '@/features/export/ExportDialog'
import { RenderQueueDialog } from '@/features/export/RenderQueue'
import { DirectorDialog } from '@/features/multicam/DirectorDialog'
import { MulticamDialog } from '@/features/multicam/MulticamDialog'
import { AboutDialog } from '@/features/shell/AboutDialog'
import { GraphicsDialog } from '@/features/shell/GraphicsDialog'
import { AgentApprovals } from '@/features/integrations/AgentApprovals'
import { IntegrationsHub } from '@/features/integrations/IntegrationsHub'
import { PreviewPanel } from '@/features/preview/PreviewPanel'
import { ResizeHandle } from '@/features/shell/ResizeHandle'
import { ShortcutsDialog } from '@/features/shell/ShortcutsDialog'
import { VersionHistoryDialog } from '@/features/shell/VersionHistoryDialog'
import { SidePanel } from '@/features/shell/SidePanel'
import { TitleBar } from '@/features/shell/TitleBar'
import { useGlobalShortcuts } from '@/features/shell/useGlobalShortcuts'
import { CleanupDialog } from '@/features/timeline/CleanupDialog'
import { ClipColorsDialog } from '@/features/timeline/ClipColorsDialog'
import { CompareDialog } from '@/features/timeline/CompareDialog'
import { MacrosDialog } from '@/features/timeline/MacrosDialog'
import { PasteAttributesDialog } from '@/features/timeline/PasteAttributesDialog'
import { SourceMonitor } from '@/features/timeline/SourceMonitor'
import { RenameTimelineDialog } from '@/features/timeline/TimelineSwitcher'
import { Timeline } from '@/features/timeline/Timeline'
import { startAi } from '@/integrations/ai'
import { startBridgeClient } from '@/integrations/bridge'
import { startIntegrations } from '@/integrations/store'
import { startIngestClient } from '@/project/ingest'
import { offerRecovery } from '@/capture/recorder'
import { RecordDialog } from '@/features/record/RecordDialog'
import { startUpdates } from '@/lib/updates'

export function App() {
  useGlobalShortcuts()
  useEffect(() => {
    void startSession()
    startMediaEngine()
    startTimelineNav()
    // Blender, HyperFrames and MCP live in the desktop app's main process.
    startIntegrations()
    startBridgeClient()
    startIngestClient()
    // A recording cut short by a crash can still be finished.
    void offerRecovery()
    startAi()
    startUpdates()
  }, [])
  const home = useSession((s) => s.home)

  return (
    <TooltipProvider delayDuration={450} skipDelayDuration={250}>
      <div className="relative flex h-screen flex-col overflow-hidden bg-canvas text-fg">
        {/* Ambient light behind the floating panels */}
        <div className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[70vw] -translate-x-1/2 rounded-full bg-accent/[0.05] blur-[90px]" />

        <TitleBar />

        {home ? (
          <ErrorBoundary name="The start screen">
            <HomeScreen />
          </ErrorBoundary>
        ) : (
          <Editor />
        )}

        {/* Each on its own: one that fails to draw closes and says so, and the editor behind it carries on. */}
        {DIALOGS.map(([name, Dialog]) => (
          <ErrorBoundary key={name} name={name} as="dialog">
            <Dialog />
          </ErrorBoundary>
        ))}
        <Toaster
          position="bottom-center"
          offset={20}
          gap={8}
          icons={{ loading: <LoaderCircle className="size-4 animate-spin" /> }}
          toastOptions={{
            unstyled: true,
            classNames: {
              toast: 'popover flex w-[360px] items-center gap-3 rounded-xl px-3.5 py-3 text-sm text-fg',
              title: 'font-medium text-fg',
              description: 'text-xs text-fg-3 whitespace-pre-line',
              actionButton: 'ml-auto shrink-0 rounded-md bg-white/[0.08] px-2 py-1 text-xs font-medium text-fg hover:bg-white/[0.14]',
              icon: 'relative grid size-5 shrink-0 place-items-center text-accent-2',
            },
          }}
        />
      </div>
    </TooltipProvider>
  )
}

const DIALOGS: [name: string, component: () => React.ReactNode][] = [
  ['The command palette', CommandPalette],
  ['The export dialog', ExportDialog],
  ['The record dialog', RecordDialog],
  ['The shortcuts list', ShortcutsDialog],
  ['The About dialog', AboutDialog],
  ['The graphics dialog', GraphicsDialog],
  ['Paste attributes', PasteAttributesDialog],
  ['Clip colours', ClipColorsDialog],
  ['The clean-up dialog', CleanupDialog],
  ['The compare view', CompareDialog],
  ['The macros dialog', MacrosDialog],
  ['The source monitor', SourceMonitor],
  ['The version history', VersionHistoryDialog],
  ['The rename dialog', RenameTimelineDialog],
  ['The render queue', RenderQueueDialog],
  ['The multicam dialog', MulticamDialog],
  ['The auto-director', DirectorDialog],
  ['Integrations', IntegrationsHub],
  ['The approval prompt', AgentApprovals],
]

function Editor() {
  const vertical = useDefaultLayout({ id: 'lumen-layout-v', storage: localStorage })
  const horizontal = useDefaultLayout({ id: 'lumen-layout-h', storage: localStorage })
  return (
    <main className="relative flex min-h-0 flex-1 px-2 pb-2">
      <Group orientation="vertical" id="lumen-layout-v" defaultLayout={vertical.defaultLayout} onLayoutChanged={vertical.onLayoutChanged}>
        <Panel id="stage" defaultSize="58%" minSize="260px">
          <Group orientation="horizontal" id="lumen-layout-h" defaultLayout={horizontal.defaultLayout} onLayoutChanged={horizontal.onLayoutChanged}>
            <Panel id="assets" defaultSize="24%" minSize="300px" maxSize="40%">
              <ErrorBoundary name="The media panel">
                <AssetsPanel />
              </ErrorBoundary>
            </Panel>
            <ResizeHandle />
            <Panel id="viewer" minSize="380px">
              <ErrorBoundary name="The preview">
                <PreviewPanel />
              </ErrorBoundary>
            </Panel>
            <ResizeHandle />
            <Panel id="side" defaultSize="25%" minSize="300px" maxSize="38%">
              <ErrorBoundary name="The side panel">
                <SidePanel />
              </ErrorBoundary>
            </Panel>
          </Group>
        </Panel>
        <ResizeHandle vertical />
        <Panel id="timeline" defaultSize="42%" minSize="200px">
          <ErrorBoundary name="The timeline">
            <Timeline />
          </ErrorBoundary>
        </Panel>
      </Group>
    </main>
  )
}

