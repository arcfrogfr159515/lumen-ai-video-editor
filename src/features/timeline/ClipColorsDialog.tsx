/**
 * Clip colours: colour the timeline by where footage came from, who is
 * speaking or which camera it is — automatically, or by rules of your own.
 */
import { ArrowDown, ArrowUp, Plus, Trash } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { AUTO_MODES, COLOR_FIELDS, LABEL_COLORS, colorLegend, labelCss } from '@/editor/clip-colors'
import { dispatch, useEditor } from '@/editor/store'
import type { ClipColoring, ColorRule, ColorRuleField, LabelColor } from '@/editor/types'
import { uid } from '@/lib/id'
import { cn } from '@/lib/cn'
import { useTimelineView } from '@/editor/timeline-view'
import { tt } from '@/lib/i18n'

type Auto = NonNullable<ClipColoring['auto']> | 'kind'

export function ClipColorsDialog() {
  const open = useTimelineView((s) => s.colorsOpen)
  const set = useTimelineView((s) => s.set)
  return (
    <Dialog open={open} onOpenChange={(o) => set({ colorsOpen: o })} title={tt('Clip colours')} description={tt('What a clip’s colour on the timeline tells you.')} className="w-[min(620px,calc(100vw-32px))]">
      {open && <Body />}
    </Dialog>
  )
}

function Body() {
  const project = useEditor((s) => s.project)
  const coloring = project.clipColors
  const legend = useMemo(() => colorLegend(project), [project])
  const rules = coloring?.rules ?? []
  const auto: Auto = coloring?.auto ?? 'kind'

  const apply = (patch: { auto?: ClipColoring['auto'] | null; rules?: ColorRule[] }) => {
    const res = dispatch('project.setClipColors', patch, { coalesce: 'clip-colors' })
    if (!res.ok) toast(res.error)
  }
  const setRule = (id: string, patch: Partial<ColorRule>) => apply({ rules: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  const move = (index: number, by: number) => {
    const next = [...rules]
    const [rule] = next.splice(index, 1)
    next.splice(index + by, 0, rule)
    apply({ rules: next })
  }
  const add = () => {
    const used = new Set(rules.map((r) => r.color))
    const color = LABEL_COLORS.find((c) => !used.has(c.id))?.id ?? 'blue'
    apply({ rules: [...rules, { id: uid('rule'), field: 'source', value: '*', color }] })
  }

  return (
    <div className="max-h-[calc(100vh-150px)] space-y-5 overflow-y-auto px-5 pb-5">
      <section>
        <h3 className="mb-2 text-2xs font-semibold tracking-wider text-fg-4 uppercase">{tt('Colour every clip by its')}</h3>
        <Segmented
          stretch
          size="md"
          value={auto}
          onChange={(v) => apply({ auto: v === 'kind' ? null : v })}
          options={[{ value: 'kind' as Auto, label: tt('Kind'), title: tt('Video, image, audio, title — as Lumen does by default') }, ...AUTO_MODES.map((m) => ({ value: m.id as Auto, label: m.label, title: m.hint }))]}
        />
        <p className="mt-2 text-xs text-fg-4">{auto === 'kind' ? tt('Video, images, sound, titles and adjustment layers each have their colour.') : tt('{0}, in the order they first play.', AUTO_MODES.find((m) => m.id === auto)?.hint)}</p>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-2xs font-semibold tracking-wider text-fg-4 uppercase">{tt('Rules')}</h3>
          <Button size="xs" variant="secondary" onClick={add}>
            <Plus />{' '}{tt('Add a rule')}
          </Button>
        </div>
        {rules.length === 0 ? (
          <p className="rounded-lg bg-ink/[0.03] px-3 py-3 text-xs leading-relaxed text-fg-4">
            {tt('No rules. A rule says “clips whose source, speaker, camera, track, name, tag or kind matches this are that colour” — the first rule that matches wins, before the automatic colours above.')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rules.map((rule, i) => (
              <li key={rule.id} className="flex items-center gap-1.5 rounded-lg bg-ink/[0.03] p-1.5 shadow-[inset_0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.04)]">
                <ColorPick value={rule.color} onChange={(color) => setRule(rule.id, { color })} />
                <Select
                  aria-label={tt('What the rule looks at')}
                  className="w-[118px] shrink-0"
                  value={rule.field}
                  onChange={(field) => setRule(rule.id, { field: field as ColorRuleField })}
                  options={COLOR_FIELDS.map((f) => ({ value: f.id, label: f.label, hint: f.hint }))}
                />
                <span className="shrink-0 text-xs text-fg-4">{tt('matches')}</span>
                <RuleValue rule={rule} onChange={(value) => setRule(rule.id, { value })} />
                <IconButton size="xs" label={tt('Check this rule earlier')} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </IconButton>
                <IconButton size="xs" label={tt('Check this rule later')} disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </IconButton>
                <IconButton size="xs" label={tt('Remove rule')} onClick={() => apply({ rules: rules.filter((r) => r.id !== rule.id) })}>
                  <Trash />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-fg-4">{tt('Part of a name is enough, capitals don’t matter, and * matches every clip that has the thing at all. A label you put on a clip yourself wins over every rule.')}</p>
      </section>

      {legend.length > 0 && (
        <section>
          <h3 className="mb-2 text-2xs font-semibold tracking-wider text-fg-4 uppercase">{tt('On the timeline now')}</h3>
          <ul className="flex flex-wrap gap-1.5">
            {legend.map((row) => (
              <li key={`${row.color}|${row.label}`} className="flex h-6 max-w-full items-center gap-1.5 rounded-full bg-ink/[0.04] pr-2 pl-1.5 text-2xs text-fg-2">
                <span className="size-3 shrink-0 rounded-full" style={{ background: labelCss(row.color) }} />
                <span className="truncate">{row.label}</span>
                <span className="shrink-0 text-fg-4 tabular">{row.clips}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}


/** The rule's value: typed while it is being edited, saved when the field is left. */
function RuleValue({ rule, onChange }: { rule: ColorRule; onChange: (value: string) => void }) {
  const field = COLOR_FIELDS.find((f) => f.id === rule.field)
  return (
    <input
      key={`${rule.id}:${rule.value}`}
      defaultValue={rule.value}
      placeholder={field?.placeholder}
      aria-label={tt('What it matches')}
      onBlur={(e) => {
        const value = e.target.value.trim()
        if (value && value !== rule.value) onChange(value)
        else e.target.value = rule.value
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className="h-7 min-w-0 flex-1 rounded-md bg-ink/[0.05] px-2 text-sm text-fg outline-none placeholder:text-fg-4 focus:ring-1 focus:ring-accent/60"
    />
  )
}

function ColorPick({ value, onChange }: { value: LabelColor; onChange: (color: LabelColor) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={tt('Colour: {0}', value)} className="size-6 shrink-0 rounded-md ring-1 ring-ink/15 outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent/60" style={{ background: labelCss(value) }} />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto p-2">
        <div className="grid grid-cols-5 gap-1.5">
          {LABEL_COLORS.map((c) => (
            <PopoverClose asChild key={c.id}>
              <button
                type="button"
                aria-label={c.name}
                title={c.name}
                onClick={() => onChange(c.id)}
                className={cn('size-6 rounded-md ring-1 ring-ink/15 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent/60', value === c.id && 'ring-2 ring-accent')}
                style={{ background: c.css }}
              />
            </PopoverClose>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
