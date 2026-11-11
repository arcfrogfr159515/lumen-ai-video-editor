/**
 * Alternate takes of a clip: the candidates for its place, which one is
 * showing, and adding or removing them.
 */
import { Layers2, Plus, TriangleAlert, X } from 'lucide-react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Section } from '@/components/ui/section'
import { trackAccepts } from '@/editor/ops'
import { dispatch, getProject, useEditor } from '@/editor/store'
import { canHaveTakes, describeTake, takeFills, type SwitchResult } from '@/editor/takes'
import type { Clip } from '@/editor/types'
import { useMediaSelection } from '@/features/assets/media-selection'
import { timelineActions } from '@/features/timeline/timeline-actions'
import { cn } from '@/lib/cn'
import { formatDuration, formatSeconds } from '@/lib/time'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

export function TakesSection({ clip }: { clip: Clip }) {
  const fps = useEditor((s) => s.project.settings.fps)
  // The media picked in the Media panel that could play in this clip's place.
  const candidates = useMediaSelection(
    useShallow((s) => {
      const p = getProject()
      const track = p.tracks.find((t) => t.id === clip.trackId)
      return s.ids.filter((id) => p.assets[id] && id !== clip.assetId && !p.assets[id].matteOf && (!track || trackAccepts(track, p.assets[id].kind)) && !clip.takes?.some((t) => t.assetId === id))
    }),
  )
  const assets = useEditor((s) => s.project.assets)
  const sequences = useEditor((s) => s.project.sequences)
  const rows = useMemo(() => {
    const p = { ...getProject(), assets, sequences }
    return (clip.takes ?? []).map((t) => ({ take: t, ...describeTake(p, t), fills: takeFills(p, clip, t) }))
  }, [clip, assets, sequences])
  if (!canHaveTakes(clip)) return null

  const show = (takeId: string) => {
    const res = dispatch('take.switch', { clipId: clip.id, takeId })
    if (!res.ok) return void toast(res.error)
    const r = res.result as SwitchResult
    if (r.shortenedBy) toast(tt('This take is {0} shorter than the place', formatDuration(r.shortenedBy, fps)), { description: tt('The clip got shorter. It gets its length back with a longer take.') })
  }

  return (
    <Section title={rows.length ? tt('Takes · {0} of {1}', rows.findIndex((r) => r.take.id === clip.takeId) + 1, rows.length) : tt('Takes')} icon={<Layers2 />} defaultOpen={rows.length > 0}>
      {rows.length === 0 ? (
        <p className="text-xs leading-relaxed text-fg-4">
          {tt('Other footage that could play here — another take of the line, another piece of B-roll. Switching between them keeps the clip’s place, length, grade and effects.')}
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map(({ take, source, seconds, missing, fills }, i) => {
            const showing = take.id === clip.takeId
            return (
              <li key={take.id} className="group/take flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={showing}
                  disabled={missing}
                  onClick={() => show(take.id)}
                  className={cn(
                    'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50',
                    showing ? 'bg-accent/12 shadow-[inset_0_0_0_1px_rgb(from_var(--color-accent)_r_g_b/0.4)]' : 'bg-ink/[0.035] hover:bg-ink/[0.07]',
                  )}
                >
                  <span className={cn('grid size-5 shrink-0 place-items-center rounded-md text-2xs font-bold tabular', showing ? 'bg-accent text-accent-fg' : 'bg-ink/[0.08] text-fg-3')}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', showing ? 'font-medium text-fg' : 'text-fg-2')}>{take.name}</span>
                    <span className="block truncate text-2xs text-fg-4">
                      {ttx('{0}from {1}', source !== take.name && `${source} · `, formatSeconds(take.inPoint / fps))}
                      {seconds !== null && (' ' + tt('· {0} to spare', formatSeconds(seconds)))}
                      {take.speed !== 1 && ` · ${take.speed}×`}
                    </span>
                  </span>
                  {missing ? (
                    <TriangleAlert className="size-3.5 shrink-0 text-warn" aria-label={tt('Its media is missing')} />
                  ) : (
                    !fills && !showing && <span className="shrink-0 rounded bg-warn/20 px-1 py-px text-2xs/[inherit] font-semibold text-warn" title={tt('Shorter than this place: the clip gets shorter while it shows')}>{tt('SHORT')}</span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={tt('Remove take {0}', i + 1)}
                  onClick={() => dispatch('take.remove', { clipId: clip.id, takeId: take.id })}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-fg-4 opacity-0 outline-none hover:bg-ink/[0.08] hover:text-fg-2 group-hover/take:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="secondary" disabled={candidates.length === 0} onClick={() => timelineActions.addTakes(clip.id, candidates)} title={tt('Select the other takes in the Media panel, then add them here')}>
          <Plus />{' '}{ttx('Add {0}', candidates.length > 0 ? tt('{0} selected', candidates.length) : tt('selected media'))}
        </Button>
        {rows.length > 1 && (
          <>
            <Button size="xs" variant="ghost" onClick={() => dispatch('take.remove', { clipId: clip.id, all: true })} title={tt('Forget the other candidates')}>
              {tt('Keep only this one')}
            </Button>
            <span className="ml-auto flex items-center gap-1 text-2xs text-fg-4">
              {tt('Next')}{' '}<Kbd combo="alt+t" />
            </span>
          </>
        )}
      </div>
      {rows.length === 0 && candidates.length === 0 && <p className="mt-2 text-2xs text-fg-4">{tt('Select media in the Media panel to add it — or drop it on the clip while holding Alt.')}</p>}
    </Section>
  )
}
