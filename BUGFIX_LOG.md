# Bug-fix log

One bug a round: a failing test that reproduces it, the root cause fixed, the whole suite run, one commit. Newest first.
Findings and their numbers (BUG-, SEC-, PERF-, UX-) are from [`docs/audit/2026-11-18/README.md`](docs/audit/2026-11-18/README.md).

## Fixed

| # | Bug | Root cause | Test that reproduces it | Commit |
|---|---|---|---|---|
| R8 | A WebVTT file written from a caption with `&`, `<` or `>` in it didn't say what the caption says: “if a<b then b>a” read back as “if aa”, and the text `&amp;` as `&`. The file should show the caption's own words | `formatVtt` wrote a caption's text as it was, and in WebVTT `&` begins an escape, `<` a tag, and `-->` on a line makes it a line of timing. The three are now written as `&amp;`, `&lt;`, `&gt;`. SRT has no escapes and is written as before | `src/editor/subtitles.test.ts` › “writes WebVTT in which a caption’s “&”, “<” and “>” are text” | this round |
| R7 | A subtitle file (SRT or WebVTT) written from a caption with an empty line in it — a title with a gap between its lines — held only the lines above the gap as a cue; the rest lay outside any cue and was lost to whatever read the file. The whole caption should be in its cue | `formatSrt` / `formatVtt` wrote a cue's text as it was, and an empty line is what ends a cue in both formats. The lines of a cue are now written without the empty ones, as the reader already reads them | `src/editor/subtitles.test.ts` › “writes a caption that has an empty line in it as one cue” | `6a9aeff` |
| R6 | A skill saved with a name or description between two quotes (`"Fast" cuts and "slow"`) came back without them (`Fast" cuts and "slow`), and a description that began with `>` or `\|` came back without that; what is saved should be what is listed | `writeSkill` wrote the value as it was, and `parseSkill` took its first character for a sign: quotes around the whole value, or the mark of a folded block. Such a value now goes between double quotes, and the reader leaves a quoted `>` alone | `shared/skills.test.ts` › “reads back the name and description it wrote…”, “reads a skill written by hand as it did” | `280bc6f` |
| R5 | An update's release notes showed `<video>` where the notes said `&lt;video&gt;`, and showed `&nbsp;`, `&#8212;`, `&#x27;` as they were written | `notesOf` read the escapes one kind after another, `&amp;` first, so what that left was read again; and it knew five escapes, none by number | `electron/updater.test.ts` › “reads each escape in the notes once…” | `71d13f4` |
| R4 | A link in a tool's result took the whole Integrations dialog down while it was drawn, when its file name had a `%` that isn't an escape (“URI malformed”) or when it wasn't an address at all (“Invalid URL”); the row should be drawn with what it can show | `LinkRow` built `new URL(link.url)` and `decodeURIComponent(...)` in its body, unguarded: an exception while a component draws unmounts everything inside its error boundary | `src/features/integrations/parts.test.ts` (draws the row) | `39c9cb5` |
| R3 | A web search failed outright (“URI malformed”) when one of its results had a link with a `%` that isn't an escape; that result should be left out and the others returned | `resultUrl` unwrapped the search engine's redirect with `decodeURIComponent`, unguarded, inside the loop over results | `electron/integrations/web.test.ts` › “search results” (also the first tests of `parseSearch` at all) | `c3d67b8` |
| R2 | A project with a damaged media address (a `%` that isn't an escape, no path) didn't open at all — “URI malformed” — and what held one couldn't be saved; it should open with that media missing, as other damage does | `mediaPath` decoded the address unguarded and threw at every caller, instead of answering “no such file” (null) as it does for any other address it can't use | `electron/project.test.ts` › “a project whose media address is damaged” | `8a50cc4` |
| R1 | Importing media by link failed with “URI malformed” when the file's name in the address had a `%` that isn't an escape (`100%_final.png`) — after the file had been downloaded, which was then left in the library with no asset | `importUrl` named the asset with `decodeURIComponent` on the address's last segment, unguarded, as its last step | `electron/integrations/media.test.ts` › “names a file whose address isn’t properly escaped…” | `1cd441f` |

Fixed earlier in the same audit round, each with its commit (see the audit report, section 8): BUG-01, 02, 03, 04, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15; SEC-01, 02, 03, 07; PERF-02; UX-01, 05.

## Next — seen while reading, not yet reproduced

| Seen | Where | What to check |
|---|---|---|
| Reading a subtitle file turns `&amp;lt;` into `<`: the escapes are read one kind after another, as in R5 | `src/editor/subtitles.ts` `clean` | That the text `&lt;` (written `&amp;lt;`) reads as `&lt;` |

Every `decodeURIComponent` in `electron/`, `src/` and `shared/` has been read: R1–R4 were the unguarded ones a person's or a tool's input reaches; `video-link.ts` was already inside a `try`; `files.ts:89` (the model cache) reads addresses only the editor itself makes.

Read and found sound: WebVTT cues timed without hours (`00:01.000 --> 00:02.500`) are parsed, and a test already says so.

## Suspected — not reproduced, code not touched

| Suspicion | Why it is only a suspicion |
|---|---|
| Playback of a timeline with video and sound hitches when the timeline turns its page to follow the playhead (PERF-07) | Seen in CPU samples of the built app; not reproduced by a test. A performance matter, outside this task |
| A covered window draws one frame a second while sound plays on | Seen once in an automated background run; not reproduced on purpose |
| A cold start that takes 18–30 s | Seen three times right after a build was written; never when idle. Probably a scanner reading the unsigned executable — not confirmed |

## To confirm — needs a decision before any code changes

| Item | The decision |
|---|---|
| SEC-06: the tokens of Lumen's MCP server and of frame ingest are kept as plain text in `lumen-mcp.json` / `lumen-ingest.json` | Moving them into the encrypted store changes two settings files and needs a migration for existing installs |
| SEC-04: a web address is looked up, checked, and then looked up again by the request | Pinning the request to the checked address changes how every web tool connects |
| SEC-05: no Electron fuses; the installer isn't signed | A packaging change; `RunAsNode` is used by the launcher for Claude Code / Codex installed through npm |
| BUG-05: a GIF export keeps the whole file in memory, with no limit on length | Warn, refuse past a length, or write in pieces — a product choice |
| UX-10: Collect project can't be cancelled and leaves half a folder when it fails | Removing a partly written folder the user chose the place of is a choice, and cancel needs a new control |
| About 30 sentences the main process says in English (BUG-16) | Several are also read by a model, and the project keeps what a model reads in English: which ones are for people is a judgement |

## Ruled out

| Item | Why |
|---|---|
| UX-04: the font stack names no Chinese face | On inspection it already resolves to the system's Chinese interface face through `system-ui` with `lang="zh-CN"` |
