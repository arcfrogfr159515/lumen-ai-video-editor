/**
 * Batch operations on the selected clips: changes that start from where each
 * clip stands — every one a little louder, every one twice as fast, all of
 * them named in order — and switches that apply to the lot.
 */
import { ChevronDown, ListFilter, Wand } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { ScrubInput } from '@/components/ui/scrub-input'
import { Row, Section } from '@/components/ui/section'
import { batchSkip, describeBatch, RENAME_TOKENS, SIMILAR, similarClips, type BatchField } from '@/editor/batch'
import type { CommandInput } from '@/editor/commands'
import { EFFECTS } from '@/editor/presets'
import { dispatch, getProject, useEditor } from '@/editor/store'
import type { Clip, EffectKind } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { cn } from '@/lib/cn'
import { tt, ttc } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

type Ops = Omit<CommandInput<'clip.batch'>, 'ids'>
type Result = { changed: number; skipped: { id: string; name: string; why: string }[] }

const chip = 'h-7 rounded-md bg-white/[0.04] px-2 text-xs font-medium text-fg-3 tabular transition-colors hover:bg-white/[0.08] hover:text-fg disabled:pointer-events-none disabled:opacity-40'

export function BatchSection({ clips }: { clips: Clip[] }) {
  const fps = useEditor((s) => s.project.settings.fps)
  const assets = useEditor((s) => s.project.assets)
  const ids = clips.map((c) => c.id)
  const [level, setLevel] = useState(0)
  const [fadeIn, setFadeIn] = useState(0.5)
  const [fadeOut, setFadeOut] = useState(0.5)
  const [pattern, setPattern] = useState(tt('Shot {nn}'))

  /** How many of the selected clips an operation applies to. */
  const count = (field: BatchField) => clips.filter((c) => !batchSkip({ assets }, c, field)).length
  const sound = count('volume')
  const timed = count('speed')
  const picture = count('effects')

  const run = (ops: Ops, label?: string) => {
    const res = dispatch('clip.batch', { ids, ...ops }, label ? { label } : undefined)
    if (!res.ok) return void toast.error(res.error)
    const { title, description } = describeBatch(res.result as Result)
    toast(title, { description, duration: description ? 5000 : 1800 })
  }
  const select = (next: string[]) => useUI.getState().select(next)

  return (
    <Section
      title={tt('Batch')}
      icon={<Wand />}
      actions={
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs text-fg-3 outline-none hover:bg-white/[0.06] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60" title={tt('Add the clips that belong with these to the selection')}>
              <ListFilter className="size-3.5" />{' '}{tt('Select more')}{' '}<ChevronDown className="size-3" />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuLabel>{tt('Add to the selection every clip')}</MenuLabel>
            {SIMILAR.map((s) => (
              <MenuItem key={s.id} onSelect={() => select(similarClips(getProject(), ids, s.id))}>
                {s.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      }
    >
      <div className="space-y-3">
        <Row label={tt('Speed')}>
          <div className="grid flex-1 grid-cols-4 gap-1">
            {[
              [0.5, '½×'],
              [0.8, tt('Slower')],
              [1.25, tt('Faster')],
              [2, '2×'],
            ].map(([factor, label]) => (
              <button key={label} type="button" disabled={!timed} title={tt('Each clip plays at {0} times the speed it has now', factor)} onClick={() => run({ speed: { mode: 'scale', value: factor as number } }, tt('Speed × {0} on {1} clips', factor, timed))} className={chip}>
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row label={tt('Volume')}>
          <div className="grid flex-1 grid-cols-4 gap-1">
            {[-3, -1, 1, 3].map((db) => (
              <button key={db} type="button" disabled={!sound} title={tt('Each clip {0} {1} dB from where it is', db > 0 ? tt('up') : tt('down'), Math.abs(db))} onClick={() => run({ volume: { mode: 'offset', value: db } }, tt('Volume {0}{1} dB on {2} clips', db > 0 ? '+' : '−', Math.abs(db), sound))} className={chip}>
                {db > 0 ? '+' : '−'}
                {ttx('{0} dB', Math.abs(db))}
              </button>
            ))}
          </div>
        </Row>
        <Row label={tt('Set level')}>
          <ScrubInput aria-label={tt('Level to set')} value={level} onChange={setLevel} min={-60} max={12} step={0.5} precision={1} unit={tt('dB')} className="w-[76px]" disabled={!sound} />
          <Button size="xs" variant="secondary" disabled={!sound} onClick={() => run({ volume: { mode: 'set', value: level } }, tt('Volume {0} dB on {1} clips', level, sound))}>
            {ttx('Set on {0}', sound)}
          </Button>
        </Row>
        <Row label={tt('Fades')}>
          <ScrubInput aria-label={tt('Fade in, seconds')} prefix={ttc('fade', 'In')} value={fadeIn} onChange={setFadeIn} min={0} max={10} step={0.05} precision={2} unit="s" className="w-[78px]" disabled={!sound} />
          <ScrubInput aria-label={tt('Fade out, seconds')} prefix={ttc('fade', 'Out')} value={fadeOut} onChange={setFadeOut} min={0} max={10} step={0.05} precision={2} unit="s" className="w-[84px]" disabled={!sound} />
          <Button size="xs" variant="secondary" disabled={!sound} onClick={() => run({ fadeIn: Math.round(fadeIn * fps), fadeOut: Math.round(fadeOut * fps) }, tt('Fades on {0} clips', sound))}>
            {tt('Set')}
          </Button>
        </Row>
        <Row label={tt('Effects')}>
          <Menu>
            <MenuTrigger asChild>
              <Button size="xs" variant="secondary" disabled={!picture}>
                {tt('Add…')}{' '}<ChevronDown />
              </Button>
            </MenuTrigger>
            <MenuContent align="start" className="max-h-[320px] overflow-y-auto">
              <MenuLabel>{ttx('Add to {0} clips', picture)}</MenuLabel>
              {EFFECTS.map((e) => (
                <MenuItem key={e.kind} onSelect={() => run({ effects: { add: [e.kind as EffectKind] } }, tt('Add {0} to {1} clips', e.name, picture))}>
                  {e.name}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Menu>
            <MenuTrigger asChild>
              <Button size="xs" variant="ghost" disabled={!clips.some((c) => c.effects.length)}>
                {tt('All effects')}{' '}<ChevronDown />
              </Button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem onSelect={() => run({ effects: { enabled: false } }, tt('Switch effects off'))}>{tt('Switch off')}</MenuItem>
              <MenuItem onSelect={() => run({ effects: { enabled: true } }, tt('Switch effects on'))}>{tt('Switch on')}</MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={() => run({ effects: { remove: 'all' } }, tt('Remove effects'))}>
                {tt('Remove them all')}
              </MenuItem>
            </MenuContent>
          </Menu>
        </Row>
        <Row label={tt('Rename')}>
          <input
            value={pattern}
            aria-label={tt('Rename pattern')}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && pattern.trim()) run({ rename: pattern.trim() }, tt('Rename {0} clips', clips.length))
            }}
            title={RENAME_TOKENS.map((t) => `${t.token} — ${t.means}`).join('\n')}
            className="h-7 min-w-0 flex-1 rounded-md bg-white/[0.05] px-2 text-sm text-fg outline-none placeholder:text-fg-4 focus:ring-1 focus:ring-accent/60"
          />
          <Button size="xs" variant="secondary" disabled={!pattern.trim()} onClick={() => run({ rename: pattern.trim() }, tt('Rename {0} clips', clips.length))}>
            {tt('Rename')}
          </Button>
        </Row>
        <div className="flex flex-wrap gap-1">
          {RENAME_TOKENS.map((t) => (
            <button key={t.token} type="button" title={tt('Adds {0}', t.means)} onClick={() => setPattern((p) => `${p}${p && !p.endsWith(' ') ? ' ' : ''}${t.token}`)} className={cn(chip, 'h-5 px-1.5 font-mono text-[10px]')}>
              {t.token}
            </button>
          ))}
        </div>
        <p className="text-2xs leading-relaxed text-fg-4">
          {ttx('Each change starts from where a clip stands and is one undo step. Clips a change can’t apply to are left as they are — {0} of {1} have sound, {2} a speed, {3} a picture.', sound, clips.length, timed, picture)}
        </p>
      </div>
    </Section>
  )
}
