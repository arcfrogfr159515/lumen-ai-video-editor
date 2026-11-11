/**
 * A clip's context menu.
 *
 * It is laid out the way editors of this kind lay theirs out — the clipboard first, then what is done to the
 * clip, what it is grouped into, where its media is, and the timeline around it — so a thing is where the hand
 * already goes for it. Rows keep their place for every kind of clip: what a clip can't do is greyed, not gone.
 * What Lumen does that has no row of its own in that layout is under “More”.
 */
import type { ReactNode } from 'react'
import { ContextContent, ContextItem, ContextSeparator, ContextSub, MenuBadge } from '@/components/ui/menu'
import { useAttributeSource } from '@/editor/clipboard'
import { LABEL_COLORS } from '@/editor/clip-colors'
import { SPEED_RAMPS } from '@/editor/presets'
import { angleTracks } from '@/editor/sequences'
import { dispatch, getProject, useEditor } from '@/editor/store'
import { canHaveTakes, takeIndex } from '@/editor/takes'
import { openTimeline } from '@/editor/timeline-nav'
import { useTimelineView } from '@/editor/timeline-view'
import { isRamped } from '@/editor/timing'
import type { Clip } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { askCopilotAbout } from '@/features/copilot/store'
import { actions } from '@/features/shell/actions'
import { relinkAsset } from '@/project/media-import'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'
import { wrapDegrees } from '@/lib/math'
import { desktop } from '@/lib/platform'
import { timelineActions } from './timeline-actions'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4]

/** What a sound could be taken apart into — once Lumen can take one apart. */
const STEMS = [tt('Vocals'), tt('Overall background'), tt('Drums'), tt('Guitar'), tt('Bass'), tt('Strings'), tt('Other')]

/** Marks what is worked out by analysis or a model, rather than done as told. */
const ai = <MenuBadge>AI</MenuBadge>

/**
 * A row for something Lumen can't do yet. It keeps its place, greyed, so the menu reads the same on the day it
 * can; until then nothing here pretends to work.
 */
function Unbuilt({ badge, children }: { badge?: ReactNode; children: ReactNode }) {
  return (
    <ContextItem disabled badge={badge}>
      {children}
    </ContextItem>
  )
}

export function ClipMenu({ clip }: { clip: Clip }) {
  const asset = useEditor((s) => (clip.assetId ? s.project.assets[clip.assetId] : undefined))
  const nested = useEditor((s) => (clip.sequenceId ? s.project.sequences?.[clip.sequenceId] : undefined))
  const hasRange = useEditor((s) => Boolean(s.project.range))
  const selection = useUI((s) => s.selection)
  const grouped = useEditor((s) => selection.some((id) => s.project.clips[id]?.groupId))
  const canPasteAttributes = Boolean(useAttributeSource())

  const media = clip.kind === 'video' || clip.kind === 'audio'
  const picture = clip.kind !== 'audio' && clip.kind !== 'adjustment'
  /** Video with media behind it: what scene detection and stabilization read. */
  const footage = clip.kind === 'video' && Boolean(clip.assetId) && !clip.freeze
  const canSubject = (clip.kind === 'video' || clip.kind === 'image') && Boolean(clip.assetId) && !clip.sequenceId
  const canBeat = media && Boolean(clip.assetId)
  const hasCues = Boolean(asset?.cues?.length)
  const mirrored = !clip.keyframes.rotateY?.length && Math.abs(wrapDegrees(clip.transform.rotateY ?? 0)) === 180
  const offline = Boolean(asset && asset.source.type !== 'sequence' && asset.source.missing)
  const path = asset ? (asset.source.type === 'file' ? asset.source.path : asset.source.dir) : undefined
  const angles = nested?.multicam ? angleTracks(nested) : []

  /** The media of the selected video clips: the cameras a multicam clip starts from. */
  const newMulticam = () => {
    const p = getProject()
    const ids = selection.map((id) => p.clips[id]).filter((c) => c?.kind === 'video' && c.assetId && p.assets[c.assetId]?.kind === 'video')
    useUI.getState().setMulticam({ assetIds: [...new Set(ids.map((c) => c.assetId!))] })
  }

  return (
    <ContextContent dense>
      <ContextItem onSelect={() => askCopilotAbout(clip.id)}>{tt('Copilot')}</ContextItem>
      <ContextSeparator />

      <ContextItem shortcut="mod+c" onSelect={actions.copy}>
        {tt('Copy')}
      </ContextItem>
      <ContextItem shortcut="mod+x" onSelect={actions.cut}>
        {tt('Cut')}
      </ContextItem>
      <ContextItem shortcut="mod+shift+c" onSelect={() => actions.copyAttributes(clip.id)}>
        {tt('Copy attributes')}
      </ContextItem>
      <ContextItem shortcut="mod+alt+v" disabled={!canPasteAttributes} onSelect={actions.pasteAttributes}>
        {tt('Paste attributes…')}
      </ContextItem>
      <ContextItem shortcut="backspace" onSelect={() => actions.deleteSelection(false)}>
        {tt('Delete')}
      </ContextItem>
      <ContextSeparator />

      <ContextSub label={tt('Basic editing')}>
        <ContextItem shortcut="shift+f" disabled={clip.kind !== 'video' || clip.freeze} onSelect={actions.freezeFrame}>
          {tt('Freeze frame')}
        </ContextItem>
        <ContextItem checked={clip.reverse} disabled={!media || clip.freeze} onSelect={() => dispatch('clip.update', { ids: selection, patch: { reverse: !clip.reverse } })}>
          {tt('Reverse')}
        </ContextItem>
        <ContextItem checked={mirrored} disabled={!picture} onSelect={actions.mirror}>
          {tt('Mirror')}
        </ContextItem>
        <ContextItem disabled={!picture} onSelect={actions.rotate}>
          {tt('Rotate')}
        </ContextItem>
        <ContextItem disabled={clip.kind !== 'video' && clip.kind !== 'image'} onSelect={() => actions.cropOnCanvas(clip.id)}>
          {tt('Crop')}
        </ContextItem>
      </ContextSub>
      <ContextItem onSelect={() => useUI.getState().setLeftTab('generate')}>{tt('AI generate')}</ContextItem>
      <ContextSub label={tt('Smart editing')} badge={ai} disabled={!footage && !picture && !canBeat && !hasCues}>
        {footage &&
          (clip.stabilize ? (
            <ContextItem onSelect={() => dispatch('clip.update', { ids: [clip.id], patch: { stabilize: null } })}>{tt('Remove stabilization')}</ContextItem>
          ) : (
            <ContextItem onSelect={() => void actions.stabilize(clip.id)}>{tt('Stabilize')}</ContextItem>
          ))}
        {picture && <ContextItem onSelect={() => actions.trackMotion(clip.id)}>{clip.follow ? tt('Track motion again…') : tt('Track motion…')}</ContextItem>}
        {clip.follow && <ContextItem onSelect={() => dispatch('clip.update', { ids: [clip.id], patch: { follow: null } })}>{tt('Stop following')}</ContextItem>}
        {canSubject && (
          <ContextSub label={tt('Subject')}>
            <ContextItem onSelect={() => void actions.textBehindSubject(clip.id)}>{tt('Put text behind the person')}</ContextItem>
            <ContextItem onSelect={() => void actions.textBehindSubject(clip.id, 'any')}>{tt('Put text behind the main subject (GPU)')}</ContextItem>
            <ContextSeparator />
            <ContextItem onSelect={() => void actions.cutOutSubject(clip.id)}>{tt('Cut out the person')}</ContextItem>
            <ContextItem onSelect={() => void actions.cutOutSubject(clip.id, 'any')}>{tt('Cut out the main subject (GPU)')}</ContextItem>
            <ContextItem onSelect={() => void actions.cutOutSubject(clip.id, 'person', true)}>{tt('Remove the person, keep the background')}</ContextItem>
            {clip.matte && (
              <>
                <ContextSeparator />
                <ContextItem onSelect={() => dispatch('clip.update', { ids: [clip.id], patch: { matte: { ...clip.matte!, invert: !clip.matte!.invert } } })}>
                  {clip.matte.invert ? tt('Show the subject instead') : tt('Show everything but the subject')}
                </ContextItem>
                <ContextItem onSelect={() => dispatch('clip.update', { ids: [clip.id], patch: { matte: null } })}>{tt('Show the whole picture again')}</ContextItem>
              </>
            )}
          </ContextSub>
        )}
        {footage && (
          <>
            <ContextItem onSelect={() => void actions.detectScenes('markers')}>{tt('Add markers at scene cuts')}</ContextItem>
            <ContextItem onSelect={() => void actions.detectScenes('guides')}>{tt('Show scene cuts as guides')}</ContextItem>
          </>
        )}
        {canBeat && (
          <ContextSub label={tt('Beat')}>
            <ContextItem onSelect={() => void actions.detectBeats(clip.id)}>{asset?.beats ? tt('Show the beat again') : tt('Find the beat')}</ContextItem>
            <ContextItem onSelect={() => void actions.beatMarkers(clip.id)}>{tt('Add markers on the downbeats')}</ContextItem>
            {clip.kind !== 'audio' && <ContextItem onSelect={() => void actions.cutToBeats(2)}>{tt('Cut the selected clips to the beat (2 beats each)')}</ContextItem>}
          </ContextSub>
        )}
        {hasCues && <ContextItem onSelect={() => actions.cueMarkers(clip.id)}>{tt('Add markers at the cues')}</ContextItem>}
      </ContextSub>
      <Unbuilt badge={ai}>{tt('Smart extend')}</Unbuilt>
      <ContextItem badge={ai} disabled={!footage} onSelect={() => void actions.detectScenes('split')}>
        {tt('Smart scene split')}
      </ContextItem>
      <ContextItem badge={ai} disabled={!canBeat || clip.freeze} onSelect={() => void actions.removePauses()}>
        {tt('Smart talking-head cut')}
      </ContextItem>
      <ContextSub label={tt('Sound separation')} badge={ai}>
        {STEMS.map((stem) => (
          <Unbuilt key={stem}>{stem}</Unbuilt>
        ))}
      </ContextSub>
      {clip.kind === 'video' && clip.audio.detached ? (
        <ContextItem shortcut="mod+l" onSelect={actions.reattachAudio}>
          {tt('Reattach audio')}
        </ContextItem>
      ) : (
        <ContextItem shortcut="mod+l" disabled={clip.kind !== 'video'} onSelect={actions.detachAudio}>
          {tt('Detach audio')}
        </ContextItem>
      )}
      <Unbuilt>{tt('Align video and audio')}</Unbuilt>
      <ContextSeparator />

      {clip.sequenceId ? (
        <>
          <ContextItem shortcut="mod+alt+enter" onSelect={() => openTimeline(clip.sequenceId!, true)}>
            {ttx('Open {0} timeline', nested?.multicam ? tt('multicam') : tt('nested'))}
          </ContextItem>
          <ContextItem onSelect={actions.unnestSelection}>{tt('Break apart')}</ContextItem>
        </>
      ) : (
        <ContextItem shortcut="mod+alt+n" onSelect={actions.nestSelection}>
          {tt('Nest into a timeline')}
        </ContextItem>
      )}
      <ContextItem disabled={clip.kind !== 'video' || asset?.kind !== 'video' || offline} onSelect={newMulticam}>
        {tt('New multicam clip')}
      </ContextItem>
      <Unbuilt>{tt('Save as my preset')}</Unbuilt>
      <ContextItem shortcut="mod+g" disabled={selection.length < 2} onSelect={actions.group}>
        {tt('Group')}
      </ContextItem>
      <ContextItem shortcut="mod+shift+g" disabled={!grouped} onSelect={actions.ungroup}>
        {clip.groupId && (clip.audio.detached || clip.kind === 'audio') ? tt('Unlink') : tt('Ungroup')}
      </ContextItem>
      <ContextSeparator />

      <ContextItem onSelect={actions.exportSelection}>{tt('Export selected clips')}</ContextItem>
      <Unbuilt>{tt('Disable clip')}</Unbuilt>
      <ContextItem disabled={!media || clip.freeze || !(clip.assetId || clip.sequenceId)} onSelect={timelineActions.reselectFootage}>
        {tt('Reselect the source range')}
      </ContextItem>
      <ContextItem disabled={!canHaveTakes(clip)} onSelect={() => void timelineActions.replaceClip(clip.id)}>
        {tt('Replace clip')}
      </ContextItem>
      <ContextItem disabled={!desktop || !offline} onSelect={() => asset && void relinkAsset(asset.id)}>
        {tt('Link media')}
      </ContextItem>
      <ContextItem disabled={!desktop || !path || offline} onSelect={() => path && void desktop?.files.reveal(path)}>
        {tt('Open file location')}
      </ContextItem>
      <ContextSeparator />

      <ContextItem disabled={!clip.effects.length} onSelect={() => actions.showInInspector(clip.id, 'video')}>
        {tt('Edit effects')}
      </ContextItem>
      <ContextItem disabled={!isRamped(clip)} onSelect={() => actions.showInInspector(clip.id, 'speed')}>
        {tt('Show the keyframe speed curve')}
      </ContextItem>
      <ContextSub label={tt('Time range')}>
        <ContextItem shortcut="x" onSelect={actions.markSelection}>
          {tt('Select the range from the clip')}
        </ContextItem>
        <ContextItem shortcut="alt+x" disabled={!hasRange} onSelect={actions.clearInOut}>
          {tt('Clear the selected range')}
        </ContextItem>
      </ContextSub>
      <ContextSub label={tt('Render')}>
        <ContextItem shortcut={hasRange ? undefined : 'enter'} disabled={!desktop} onSelect={actions.renderTimeline}>
          {tt('Entire timeline')}
        </ContextItem>
        <ContextItem shortcut={hasRange ? 'enter' : undefined} disabled={!desktop || !hasRange} onSelect={actions.renderPreviews}>
          {tt('In to out range')}
        </ContextItem>
        <ContextItem disabled={!desktop} onSelect={actions.renderSelection}>
          {tt('Clip’s range')}
        </ContextItem>
        <ContextSeparator />
        <ContextItem disabled={!desktop} onSelect={() => void actions.deleteRenders(false)}>
          {tt('Delete the project’s render files')}
        </ContextItem>
      </ContextSub>
      <ContextSeparator />

      <ContextSub label={tt('More')}>
        <ContextItem shortcut="s" onSelect={actions.split}>
          {tt('Split at playhead')}
        </ContextItem>
        <ContextItem shortcut="mod+d" onSelect={actions.duplicateSelection}>
          {tt('Duplicate')}
        </ContextItem>
        <ContextItem shortcut="shift+delete" onSelect={() => actions.deleteSelection(true)}>
          {tt('Ripple delete')}
        </ContextItem>
        <ContextSeparator />
        <ContextSub label={tt('Speed')} disabled={!media || clip.freeze}>
          {SPEEDS.map((s) => (
            <ContextItem key={s} checked={s === clip.speed && !isRamped(clip)} onSelect={() => dispatch('clip.update', { ids: selection, patch: { speed: s } })}>
              <span className="tabular">{s}×</span>
            </ContextItem>
          ))}
          <ContextSeparator />
          {SPEED_RAMPS.map((r) => (
            <ContextItem key={r.id} onSelect={() => dispatch('clip.setSpeedRamp', { id: clip.id, points: r.points })}>
              {ttx('Ramp: {0}', r.name)}
            </ContextItem>
          ))}
          {isRamped(clip) && <ContextItem onSelect={() => dispatch('clip.setSpeedRamp', { id: clip.id, points: null })}>{tt('Remove ramp')}</ContextItem>}
        </ContextSub>
        <ContextSub label={clip.takes && clip.takes.length > 1 ? tt('Takes ({0} of {1})', takeIndex(clip) + 1, clip.takes.length) : tt('Takes')} disabled={!canHaveTakes(clip)}>
          {(clip.takes ?? []).map((t, i) => (
            <ContextItem key={t.id} checked={t.id === clip.takeId} onSelect={() => dispatch('take.switch', { clipId: clip.id, takeId: t.id })}>
              {i + 1} · {t.name}
            </ContextItem>
          ))}
          {clip.takes && clip.takes.length > 1 && (
            <>
              <ContextSeparator />
              <ContextItem shortcut="alt+t" onSelect={() => timelineActions.switchTake(1)}>
                {tt('Next take')}
              </ContextItem>
              <ContextItem shortcut="alt+shift+t" onSelect={() => timelineActions.switchTake(-1)}>
                {tt('Previous take')}
              </ContextItem>
              <ContextItem onSelect={() => dispatch('take.remove', { clipId: clip.id, all: true })}>{tt('Keep only this one')}</ContextItem>
              <ContextSeparator />
            </>
          )}
          <ContextItem onSelect={() => timelineActions.addTakes(clip.id)}>{tt('Add the selected media as takes')}</ContextItem>
        </ContextSub>
        <ContextSub label={tt('Label')}>
          {LABEL_COLORS.map((c) => (
            <ContextItem key={c.id} checked={clip.label === c.id} icon={<span className="size-3 rounded-full" style={{ background: c.css }} />} onSelect={() => dispatch('clip.update', { ids: selection, patch: { label: c.id } }, { label: tt('Label clip') })}>
              {c.name}
            </ContextItem>
          ))}
          <ContextSeparator />
          <ContextItem disabled={!clip.label} onSelect={() => dispatch('clip.update', { ids: selection, patch: { label: null } }, { label: tt('Remove label') })}>
            {tt('No label')}
          </ContextItem>
          <ContextItem onSelect={() => useTimelineView.getState().set({ colorsOpen: true })}>{tt('Colour rules…')}</ContextItem>
        </ContextSub>
        {nested?.multicam && (
          <>
            <ContextSeparator />
            <ContextSub label={tt('Camera angle')}>
              {angles.map((t, i) => (
                <ContextItem key={t.id} shortcut={i < 9 ? String(i + 1) : undefined} checked={(clip.angle ?? angles[0]?.id) === t.id} onSelect={() => dispatch('clip.update', { ids: [clip.id], patch: { angle: t.id } })}>
                  {t.name}
                </ContextItem>
              ))}
            </ContextSub>
            <ContextItem onSelect={() => useTimelineView.getState().set({ directorOpen: true })}>{tt('Auto-direct: cut between the cameras…')}</ContextItem>
          </>
        )}
      </ContextSub>
    </ContextContent>
  )
}
