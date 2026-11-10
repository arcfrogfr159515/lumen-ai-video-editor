/**
 * Tools for the craft of the cut: what is wrong with a timeline (gaps, flash
 * frames, footage used twice, uneven frame rates), what differs between two
 * versions of it, cutting by what is said, cutting between cameras, and the
 * editor's own notes, chapters, storyboard and macros. The edits themselves
 * are editor commands (timeline_closeGaps, timeline_mergeFrom,
 * timeline_moveRange, take_add, clip_batch…); these find what to give them.
 */
import { diffTimelines } from '@/editor/diff'
import { describeTiming, constantRateFor, isUneven, rateLabel } from '@/editor/frame-rate'
import { findGaps } from '@/editor/gaps'
import { runMacro, useMacros } from '@/editor/macro-store'
import { exportMarkers, type MarkerExportFormat, type MarkerFilter } from '@/editor/markers'
import { clipNotes, taskCounts } from '@/editor/notes'
import { findReuse, reusedFrames } from '@/editor/reuse'
import { allSequences, compareTarget, getSequence, openSequence, openSequenceId } from '@/editor/sequences'
import { cutSpokenWords } from '@/editor/smart'
import { getProject } from '@/editor/store'
import { reorderable, storyboard, storyTrack } from '@/editor/storyboard'
import { fillerWords, findPhrase, repeatedWords, scriptWords, timelineScript } from '@/editor/text-edit'
import { useUI } from '@/editor/ui-store'
import { angleMotion, applyAutoDirect, multicamTargets, planAutoDirect } from '@/project/auto-director'
import { canConform, checkFrameTiming, conformAsset } from '@/project/conform'
import { assetById, bool, clampNum, fps, int, list, num, number, obj, oneOf, rangeArg, seconds, str, strings, text, timecode, trackName, type AgentTool } from './kit'

const span = (start: number, end: number) => ({ start, end, from_seconds: seconds(start), to_seconds: seconds(end) })

const MARKER_FORMATS: MarkerExportFormat[] = ['youtube', 'markdown', 'csv', 'json']
const MARKER_KINDS: MarkerFilter[] = ['chapter', 'todo', 'comment', 'plain']

/** The longest script a call hands back, in lines: more than a model reads well in one go. */
const MAX_LINES = 400

export const CRAFT_TOOLS: AgentTool[] = [
  {
    name: 'find_gaps',
    description:
      'What is empty and what flashes on the open timeline: holes (stretches where no track has anything — black and silent in the film), gaps between clips track by track (flash: true for slivers a few frames long that flicker by), and flash clips (clips only a few frames long, usually leftovers of a split). Frames and seconds. Fix them with timeline_closeGaps: by default it closes the holes, fills the slivers and removes the flash clips; wide gaps on a track are left unless you name the track in trackIds.',
    inputSchema: obj({ flash_frames: int('How short counts as a flash, in frames (default 3)', { minimum: 1, maximum: 12 }) }),
    run: async (a) => {
      const p = getProject()
      const r = findGaps(p, number(a, 'flash_frames') === undefined ? undefined : clampNum(Math.round(number(a, 'flash_frames')!), 1, 12))
      return {
        holes: r.holes.map((h) => ({ ...span(h.start, h.end), frames: h.frames })),
        gaps: r.gaps.map((g) => ({ track_id: g.trackId, track: trackName(g.trackId), ...span(g.start, g.end), frames: g.frames, ...(g.flash ? { flash: true } : {}), ...(g.leading ? { before_first_clip: true } : {}) })),
        flash_clips: r.flashClips.map((c) => ({ clip_id: c.clipId, name: c.name, track: trackName(c.trackId), start: c.start, at_seconds: seconds(c.start), frames: c.frames })),
        clean: !r.holes.length && !r.flashClips.length && !r.gaps.some((g) => g.flash),
      }
    },
  },
  {
    name: 'find_reused_footage',
    description:
      'Footage the open timeline uses more than once: every stretch of a media item that plays in two or more clips, with each clip that plays it and where on the timeline. Picture and sound are looked at separately, so a video and its own detached sound count once. Use it before delivering a cut (a shot seen twice is usually a mistake) or to find B-roll that needs replacing.',
    inputSchema: obj({ min_seconds: num('Leave out repeats shorter than this (default 0.1)', { minimum: 0, maximum: 60 }) }),
    run: async (a) => {
      const p = getProject()
      const spans = findReuse(p, Math.max(2, Math.round((number(a, 'min_seconds') ?? 0.1) * fps())))
      return {
        repeated_seconds: seconds(reusedFrames(spans)),
        reused: spans.map((s) => ({
          asset_id: s.assetId,
          media: p.assets[s.assetId]?.name ?? s.assetId,
          what: s.stream,
          source_from_seconds: seconds(s.from),
          source_to_seconds: seconds(s.to),
          uses: s.uses.map((u) => {
            const clip = p.clips[u.clipId]
            return { clip_id: u.clipId, name: clip?.name, track: clip ? trackName(clip.trackId) : undefined, ...(clip ? span(clip.start + u.start, clip.start + u.end) : {}) }
          }),
        })),
      }
    },
  },
  {
    name: 'compare_timelines',
    description:
      'What differs between the open timeline and another version of it (a branch made with sequence_branch, the timeline a branch came from, or any other timeline at the same frame rate): the stretches where they play something different, each as a (frames of the open timeline) and b (frames of the other), and whether it was changed, added (only the other has it) or removed (only the open one has it). Everything between the stretches plays the same in both. To take a stretch into the open timeline, give its a and b to timeline_mergeFrom exactly as listed — last stretch first, so the earlier ones stay where they were found.',
    inputSchema: obj({ timeline_id: str('The other timeline (default: the one this was branched from, else its newest branch). list_timelines gives ids.') }),
    run: async (a) => {
      const p = getProject()
      const openId = openSequenceId(p)
      const otherId = text(a, 'timeline_id') ?? compareTarget(p)
      if (!otherId) throw new Error('There is no other timeline to compare with. Branch this one with sequence_branch first.')
      if (otherId === openId) throw new Error('That is the open timeline. Pass the id of the other version (list_timelines).')
      const other = getSequence(p, otherId)
      if (!other) throw new Error(`No timeline with id “${otherId}”. Known: ${allSequences(p).map((s) => `${s.id} (${s.name})`).join(', ')}.`)
      if (other.settings.fps !== p.settings.fps) throw new Error(`“${other.name}” runs at ${other.settings.fps} fps and the open timeline at ${p.settings.fps}: their frames don’t line up, so they can’t be compared.`)
      const diff = diffTimelines(openSequence(p), other)
      return {
        open_timeline: { id: openId, name: openSequence(p).name, frames: diff.lengthA, seconds: seconds(diff.lengthA) },
        other_timeline: { id: other.id, name: other.name, frames: diff.lengthB, seconds: seconds(diff.lengthB), ...(other.branchOf?.sequenceId === openId ? { branch_of_open: true } : {}) },
        same: diff.hunks.length === 0,
        differing_seconds: { open: seconds(diff.framesA), other: seconds(diff.framesB) },
        differences: diff.hunks.map((h) => ({ kind: h.kind, a: { start: h.a[0], end: h.a[1] }, b: { start: h.b[0], end: h.b[1] }, open_at: timecode(h.a[0]), other_at: timecode(h.b[0]), open_seconds: seconds(h.a[1] - h.a[0]), other_seconds: seconds(h.b[1] - h.b[0]) })),
      }
    },
  },
  {
    name: 'export_markers',
    description:
      'The open timeline’s markers as text. Markers come in kinds: chapter (starts a section of the film), todo (something to fix — done or not), comment, and plain. Formats: youtube — a chapter list ready for a video description (0:00 first; warnings say when a video site would refuse it); markdown — chapters, a to-do checklist and comments; csv and json — one row per marker. Make markers with marker_add (kind, note) and tick to-dos off with marker_update (done).',
    inputSchema: obj({
      format: oneOf('Default markdown', MARKER_FORMATS),
      kinds: list('Only these kinds (default: all)', { type: 'string', enum: MARKER_KINDS }),
      open_only: bool('Leave out to-dos that are done'),
    }),
    run: async (a) => {
      const format = MARKER_FORMATS.find((f) => f === a.format) ?? 'markdown'
      const kinds = strings(a, 'kinds').filter((k): k is MarkerFilter => MARKER_KINDS.includes(k as MarkerFilter))
      const out = exportMarkers(getProject(), format, { kinds, hideDone: a.open_only === true })
      return { format, markers: out.count, text: out.text, ...(out.warnings.length ? { warnings: out.warnings } : {}) }
    },
  },
  {
    name: 'get_script',
    description:
      'The words spoken on the open timeline, as the film plays them: one line per phrase, with who says it, when, and the index of its first word — every word has an index, counted from 0 across the whole script. Also lists the indexes of filler words (um, uh, 嗯…) and of words said twice in a row. Needs transcripts (transcribe_media). Cut words out of the film with cut_spoken_text. Indexes change after every cut: read the script again before cutting more.',
    inputSchema: obj({ from_seconds: num('Only lines from here', { minimum: 0 }), to_seconds: num('Only lines up to here', { minimum: 0 }) }),
    run: async (a) => {
      const p = getProject()
      const lines = timelineScript(p)
      if (!lines.length) return { lines: [], words: 0, note: 'No transcribed speech on the timeline. Run transcribe_media on the media that has speech.' }
      const words = scriptWords(lines)
      const [from, to] = rangeArg(a)
      const inRange = lines.filter((l) => l.end > from && l.start < to)
      const shown = inRange.slice(0, MAX_LINES)
      return {
        words: words.length,
        lines: shown.map((l) => ({
          clip_id: l.clipId,
          ...(l.speaker ? { speaker: l.speaker } : {}),
          from_seconds: seconds(l.start),
          to_seconds: seconds(l.end),
          first_word: l.words[0]?.index,
          text: l.words.map((w) => w.text).join(' '),
          ...(l.partial ? { cut_through: true } : {}),
        })),
        ...(inRange.length > shown.length ? { more: `${inRange.length - shown.length} more lines: read on with from_seconds ${seconds(shown[shown.length - 1].end)}.` } : {}),
        filler_words: fillerWords(words),
        repeated_words: repeatedWords(words, p.settings.fps),
      }
    },
  },
  {
    name: 'cut_spoken_text',
    description:
      'Cut words out of the film by what is said: the frames they are spoken in come out of the whole timeline (picture, captions, B-roll and markers close up together; music beds play on whole), each cut placed in the quietest moment around the words. Give phrases (each exactly as spoken; a phrase said more than once needs all_occurrences, or word_indexes for the one meant), word_indexes from get_script, fillers: true for every um and uh, repeats: true for words said twice in a row — any mix, one undo step. Returns how much time came out.',
    inputSchema: obj({
      phrases: list('Words to cut, as spoken', { type: 'string' }),
      all_occurrences: bool('Cut every time a phrase is said, not just when it is said once'),
      word_indexes: list('Indexes of words to cut (get_script)', { type: 'integer', minimum: 0 }),
      fillers: bool('Cut every filler word'),
      repeats: bool('Cut the first of every word or phrase said twice in a row'),
    }),
    run: async (a) => {
      const p = getProject()
      const words = scriptWords(timelineScript(p))
      if (!words.length) throw new Error('No transcribed speech on the timeline. Run transcribe_media on the media that has speech first.')
      const cut = new Set<number>()
      for (const phrase of strings(a, 'phrases')) {
        const found = findPhrase(words, phrase)
        if (!found.length) throw new Error(`Nobody says “${phrase}” on the timeline. get_script shows the words as they were heard.`)
        if (found.length > 1 && a.all_occurrences !== true)
          throw new Error(`“${phrase}” is said ${found.length} times: at ${found.map((f) => `${timecode(words[f[0]].start)} (words ${f[0]}–${f[f.length - 1]})`).join(', ')}. Pass all_occurrences: true, or word_indexes for the one you mean.`)
        for (const hit of found) for (const i of hit) cut.add(i)
      }
      const asked = Array.isArray(a.word_indexes) ? a.word_indexes.filter((i): i is number => Number.isInteger(i)) : []
      const bad = asked.filter((i) => i < 0 || i >= words.length)
      if (bad.length) throw new Error(`The script has ${words.length} words (0–${words.length - 1}); there is no word ${bad.join(', ')}. Indexes change after every cut: call get_script again.`)
      for (const i of asked) cut.add(i)
      if (a.fillers === true) for (const i of fillerWords(words)) cut.add(i)
      if (a.repeats === true) for (const i of repeatedWords(words, p.settings.fps)) cut.add(i)
      if (!cut.size) return { words_cut: 0, seconds_saved: 0, note: 'Nothing to cut: give phrases, word_indexes, fillers or repeats.' }
      const indexes = [...cut].sort((x, y) => x - y)
      const r = cutSpokenWords(indexes, { label: `Cut ${indexes.length} spoken word${indexes.length === 1 ? '' : 's'}`, source: 'ai' })
      if (!r.cuts && r.error) throw new Error(r.error)
      return { words_cut: indexes.length, cuts: r.cuts, seconds_saved: seconds(r.frames), text_cut: indexes.slice(0, 60).map((i) => words[i].text).join(' '), ...(r.error ? { warning: r.error } : {}) }
    },
  },
  {
    name: 'auto_direct_multicam',
    description:
      'Cut a multicam clip between its cameras the way a director would: to whoever is speaking (each camera is judged by its own microphone), to the wide shot when several speak or nobody does, with cutaways to a listener when one shot runs long. No shot is shorter than min_shot_seconds (a cutaway, and the last shot, may be a little shorter). watch_picture also looks at how much each picture moves, for cameras with no sound of their own (slower). dry_run plans without cutting. Needs a multicam clip on the open timeline (create_multicam, or multicam_create). One undo step; change single cuts afterwards with multicam_switch.',
    inputSchema: obj({
      clip_ids: list('The multicam clips to cut (default: every multicam clip on the open timeline that plays the same multicam timeline as the first)', { type: 'string' }),
      min_shot_seconds: num('Shortest shot (default 2.5)', { minimum: 0.5, maximum: 30 }),
      max_shot_seconds: num('A shot longer than this gets a cutaway (default 14)', { minimum: 2, maximum: 120 }),
      wide_angle: int('The camera that shows everyone, 1 = first (default: none)', { minimum: 1, maximum: 32 }),
      reactions: bool('Cut away to listeners in long shots (default true)'),
      watch_picture: bool('Also judge cameras by how much their picture moves (default false)'),
      dry_run: bool('Plan and report without cutting'),
    }),
    run: async (a, ctx) => {
      const p = getProject()
      const given = strings(a, 'clip_ids')
      const ids = given.length
        ? given
        : Object.values(p.clips)
            .filter((c) => c.sequenceId && p.sequences?.[c.sequenceId]?.multicam)
            .sort((x, y) => x.start - y.start)
            .map((c) => c.id)
      const targets = multicamTargets(p, ids)
      if (!targets) throw new Error(given.length ? 'None of those clips plays a multicam timeline.' : 'There is no multicam clip on the open timeline. Make one with create_multicam.')
      const wide = number(a, 'wide_angle')
      const cameras = targets.seq.tracks.filter((t) => t.kind === 'video').length
      if (wide !== undefined && wide > cameras) throw new Error(`“${targets.seq.name}” has ${cameras} cameras; there is no camera ${wide}.`)
      let motion: (number[] | undefined)[] | undefined
      if (a.watch_picture === true) {
        ctx?.progress?.('Watching the cameras…')
        motion = await angleMotion(p, targets.seq, (done) => ctx?.progress?.(`Watching the cameras… ${Math.round(done * 100)}%`), ctx?.signal)
      }
      const plan = planAutoDirect(
        getProject(),
        targets.clips.map((c) => c.id),
        { minShot: number(a, 'min_shot_seconds'), maxShot: number(a, 'max_shot_seconds'), wide: wide === undefined ? null : wide - 1, reactions: a.reactions === undefined ? undefined : a.reactions === true },
        motion,
      )
      const report = {
        multicam_timeline: targets.seq.name,
        cameras: plan.angles.map((name, i) => ({ angle: i + 1, name, share: Math.round(plan.summary.share[i] * 100) / 100, ...(plan.silent.includes(i) ? { no_sound_to_go_by: true } : {}) })),
        planned_cuts: plan.summary.cuts,
        average_shot_seconds: Math.round(plan.summary.averageShot * 10) / 10,
        watched_picture: plan.watched,
      }
      if (a.dry_run === true) return { ...report, cuts: plan.cuts.slice(0, 200).map((c) => ({ at_seconds: Math.round(c.at * 100) / 100, angle: c.angle + 1, why: c.why })) }
      const done = applyAutoDirect(plan, 'ai')
      useUI.getState().markAiTouched(done.clipIds)
      return { ...report, cuts_made: done.cuts, clip_ids: done.clipIds.slice(0, 200) }
    },
  },
  {
    name: 'list_macros',
    description:
      'The editor’s macros: runs of edits the user recorded on one clip to do again on others (a grade, a trim measured from the clip’s own start or end, effects, a cut…). Each with its steps in words. Run one with run_macro. Macros are recorded by the user (Alt+R in the editor) and kept in their profile, not in the project.',
    inputSchema: obj({}),
    run: async () => {
      const { macros, lastId } = useMacros.getState()
      return { macros: macros.map((m) => ({ id: m.id, name: m.name, steps: m.steps.map((s) => s.title), ...(m.id === lastId ? { last_used: true } : {}) })) }
    },
  },
  {
    name: 'run_macro',
    description:
      'Run one of the user’s macros (list_macros) on clips: each clip gets the macro’s steps in turn, measured from its own start, end and track. One undo step. A clip a step can’t be done to (it adjusts an effect the clip hasn’t got, say) is left exactly as it was and reported in skipped with the reason; the others still get the macro.',
    inputSchema: obj({ macro: str('The macro’s id or name'), clip_ids: list('The clips to run it on', { type: 'string' }) }, ['macro', 'clip_ids']),
    run: async (a) => {
      const { macros } = useMacros.getState()
      const want = text(a, 'macro') ?? ''
      const macro = macros.find((m) => m.id === want) ?? macros.find((m) => m.name.toLowerCase() === want.toLowerCase())
      if (!macro) throw new Error(macros.length ? `No macro “${want}”. Known: ${macros.map((m) => `${m.id} (${m.name})`).join(', ')}.` : 'The user has recorded no macros yet (Alt+R in the editor records one).')
      const p = getProject()
      const ids = strings(a, 'clip_ids')
      const missing = ids.filter((id) => !p.clips[id])
      if (missing.length) throw new Error(`No clip with id ${missing.join(', ')}. Call get_project for the clips on the timeline.`)
      if (!ids.length) throw new Error('Give the clips to run it on in clip_ids.')
      if (useMacros.getState().recording) throw new Error('The user is recording a macro right now. Try again when they have stopped.')
      const r = runMacro(macro, ids, 'ai')
      useUI.getState().markAiTouched(ids.filter((id) => getProject().clips[id]))
      return { macro: macro.name, clips_done: r.done, skipped: r.failed.map((f) => ({ clip_id: f.clipId, name: f.name, why: f.why })) }
    },
  },
  {
    name: 'check_frame_rates',
    description:
      'Check the videos in the project for uneven frame timing: variable frame rate (phones, screen recordings, game capture) and dropped frames. Such footage drifts out of sync with its sound and stutters when cut. Lists every video with what its timing is and, for uneven ones, the constant rate that suits it; conform_frame_rate makes the constant-rate copy.',
    inputSchema: obj({ asset_ids: list('Only these media items (default: every video)', { type: 'string' }), recheck: bool('Read the files again even if they were checked before') }),
    run: async (a) => {
      const ids = strings(a, 'asset_ids')
      for (const id of ids) assetById(id)
      await checkFrameTiming(ids.length ? ids : undefined, a.recheck === true)
      const p = getProject()
      const videos = Object.values(p.assets).filter((v) => v.kind === 'video' && (!ids.length || ids.includes(v.id)))
      return {
        project_fps: p.settings.fps,
        videos: videos.map((v) => ({
          asset_id: v.id,
          name: v.name,
          timing: describeTiming(v.frameTiming),
          ...(isUneven(v.frameTiming) ? { uneven: true, ...(canConform(v) ? { suggested_fps: constantRateFor(v.frameTiming!, p.settings.fps) } : {}) } : {}),
          ...(v.conformedFrom ? { constant_rate_copy: true } : {}),
        })),
        uneven: videos.filter((v) => isUneven(v.frameTiming) && canConform(v)).map((v) => v.id),
      }
    },
  },
  {
    name: 'conform_frame_rate',
    description:
      'Make a constant-frame-rate copy of a video and have the project play the copy instead (check_frame_rates finds the videos that need it). Every clip of that media keeps its place and timing; the original file is untouched and can be restored from the Media panel. Re-encodes the whole file, so it takes a while for long footage. One undo step.',
    inputSchema: obj({ asset_id: str('The video'), fps: num('The constant rate (default: the one that suits the footage and the timeline)', { minimum: 1, maximum: 240 }) }, ['asset_id']),
    run: async (a) => {
      const asset = assetById(text(a, 'asset_id') ?? '')
      if (asset.kind !== 'video') throw new Error(`“${asset.name}” is not a video.`)
      if (asset.conformedFrom) throw new Error(`“${asset.name}” already plays a constant-rate copy.`)
      if (!canConform(asset)) throw new Error(`“${asset.name}” can’t be copied: its file is offline or it isn’t a file on disk.`)
      const rate = number(a, 'fps')
      const ok = await conformAsset(asset.id, rate)
      if (!ok) throw new Error(`“${asset.name}” is already being copied, or the copy was cancelled.`)
      const now = getProject().assets[asset.id]
      return { asset_id: asset.id, name: asset.name, fps: now?.fps !== undefined ? Number(rateLabel(now.fps)) : rate, timing: describeTiming(now?.frameTiming) }
    },
  },
  {
    name: 'list_clip_notes',
    description:
      'The notes and task lists written on clips of the open timeline (who needs to fix what, where): each clip with its note, its tasks and which are done, in timeline order. Write them with clip_update → patch.note and patch.tasks ([{ id, text, done }]); timeline-wide remarks are markers of kind todo or comment (export_markers).',
    inputSchema: obj({ open_only: bool('Only clips with tasks still to do'), text: str('Only notes and tasks containing this') }),
    run: async (a) => {
      const p = getProject()
      const rows = clipNotes(p, { openOnly: a.open_only === true, text: text(a, 'text') })
      const counts = taskCounts(p)
      return {
        tasks: counts.tasks,
        open_tasks: counts.open,
        clips: rows.map((r) => ({ clip_id: r.clipId, name: r.name, track: r.trackName, at_seconds: seconds(r.start), at: timecode(r.start), ...(r.note ? { note: r.note } : {}), tasks: r.tasks.map((t) => ({ id: t.id, text: t.text, done: t.done })) })),
      }
    },
  },
  {
    name: 'get_storyboard',
    description:
      'The film as a storyboard: the clips of the story track (the main track) in order, grouped into sections by chapter markers, with the frames each card and each section covers. To reorder the film, give a card’s or a section’s start and end to timeline_moveRange with `to` set to the start of the card it should come before (or the end of the film): everything that goes with it — titles, B-roll, captions, sound, markers — moves along.',
    inputSchema: obj({}),
    run: async () => {
      const p = getProject()
      const track = storyTrack(p)
      const sections = storyboard(p)
      return {
        story_track: track ? { id: track.id, name: track.name, reorderable: reorderable(track) } : null,
        sections: sections.map((s) => ({
          id: s.id,
          title: s.title,
          ...span(s.start, s.end),
          cards: s.cards.map((c) => ({ number: c.number, clip_id: c.clipId, name: p.clips[c.clipId]?.name, ...span(c.start, c.end) })),
        })),
      }
    },
  },
]
