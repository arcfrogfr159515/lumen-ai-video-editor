import { Aperture, Blend, Clapperboard, ListChecks, Music, ScrollText, Sparkles, Type, WandSparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { AiSparkle } from '@/components/brand'
import { Tip } from '@/components/ui/tooltip'
import { useUI, type LeftTab } from '@/editor/ui-store'
import { cn } from '@/lib/cn'
import { AudioPanel } from './AudioPanel'
import { EffectsPanel } from './EffectsPanel'
import { GeneratePanel } from './GeneratePanel'
import { LooksPanel } from './LooksPanel'
import { MediaPanel } from './MediaPanel'
import { NotesPanel } from '@/features/notes/NotesPanel'
import { ScriptPanel } from '@/features/script/ScriptPanel'
import { TextPanel } from './TextPanel'
import { TransitionsPanel } from './TransitionsPanel'
import { tt } from '@/lib/i18n'

const TABS: { id: LeftTab; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'media', label: tt('Media'), icon: <Clapperboard />, hint: tt('Your footage, photos & audio') },
  { id: 'audio', label: tt('Audio'), icon: <Music />, hint: tt('Music & sound effects') },
  { id: 'text', label: tt('Text'), icon: <Type />, hint: tt('Titles & captions') },
  { id: 'effects', label: tt('Effects'), icon: <Sparkles />, hint: tt('Blur, glow, grain & more') },
  { id: 'transitions', label: tt('Transitions'), icon: <Blend />, hint: tt('Between shots') },
  { id: 'looks', label: tt('Looks'), icon: <Aperture />, hint: tt('One-click color grades') },
  { id: 'script', label: tt('Script'), icon: <ScrollText />, hint: tt('What is said — delete words to cut the film') },
  { id: 'notes', label: tt('Notes'), icon: <ListChecks />, hint: tt('Markers, to-dos & clip notes') },
]

export function AssetsPanel() {
  const tab = useUI((s) => s.leftTab)
  const setTab = useUI((s) => s.setLeftTab)
  const tabs = useRef<HTMLDivElement>(null)

  // A tab opened from somewhere else (the command palette, a shortcut) is brought into what the rail shows.
  useEffect(() => {
    tabs.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [tab])

  return (
    <div className="panel flex h-full overflow-hidden">
      {/* The rail is as tall as the panel, and the panel as short as the window makes it: where the tabs don't fit
          with their names, they are drawn without (the name is in the tip and read out), and where they still don't
          fit, they scroll. Generate keeps its place at the foot either way. */}
      <nav aria-label={tt('Library')} className="flex w-rail shrink-0 flex-col items-center gap-0.5 border-r border-line py-2 [container-type:size]">
        <div ref={tabs} className="scrollbar-none flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto">
          {TABS.map((t) => (
            <RailButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} label={t.label} hint={t.hint}>
              {t.icon}
            </RailButton>
          ))}
        </div>
        <RailButton active={tab === 'generate'} onClick={() => setTab('generate')} label={tt('Generate')} hint={tt('AI images, video, voice & music')} ai>
          {tab === 'generate' ? <WandSparkles /> : <AiSparkle className="!size-[18px]" />}
        </RailButton>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {tab === 'media' && <MediaPanel />}
        {tab === 'audio' && <AudioPanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'effects' && <EffectsPanel />}
        {tab === 'transitions' && <TransitionsPanel />}
        {tab === 'looks' && <LooksPanel />}
        {tab === 'script' && <ScriptPanel />}
        {tab === 'notes' && <NotesPanel />}
        {tab === 'generate' && <GeneratePanel />}
      </div>
    </div>
  )
}

function RailButton({ active, onClick, label, hint, ai, children }: { active: boolean; onClick: () => void; label: string; hint: string; ai?: boolean; children: ReactNode }) {
  return (
    <Tip
      side="right"
      content={
        <>
          {/* The name too: on a short rail it is drawn nowhere else. */}
          <span>{label}</span>
          <span className="font-normal text-fg-3">{hint}</span>
        </>
      }
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={active}
        aria-label={label}
        className={cn(
          'group relative flex w-rail-item shrink-0 flex-col items-center gap-1 rounded-card pt-2 pb-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 rail-short:py-2',
          active ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
        )}
      >
        {active && (
          <motion.span
            layoutId="rail-active"
            className={cn(
              'absolute inset-0 rounded-card',
              ai
                ? 'bg-[linear-gradient(120deg,rgb(from_var(--color-accent)_r_g_b/0.18),rgb(from_var(--color-ai-2)_r_g_b/0.14),rgb(from_var(--color-ai-3)_r_g_b/0.12))] shadow-[inset_0_0_0_1px_rgb(from_var(--color-ai-2)_r_g_b/0.25)]'
                : 'bg-ink/[0.07] shadow-[inset_0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.05)]',
            )}
            transition={{ type: 'spring', stiffness: 500, damping: 38 }}
          />
        )}
        <span className={cn('relative [&_svg]:size-[18px] transition-transform duration-200 group-hover:-translate-y-px', active && !ai && '[&_svg]:text-accent-2')}>{children}</span>
        <span className="relative text-2xs leading-none font-medium rail-short:hidden">{label}</span>
      </button>
    </Tip>
  )
}
