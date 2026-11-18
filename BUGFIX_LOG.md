# Bug-fix log

One bug a round: a failing test that reproduces it, the root cause fixed, the whole suite run, one commit. Newest first.
Findings and their numbers (BUG-, SEC-, PERF-, UX-) are from [`docs/audit/2026-11-18/README.md`](docs/audit/2026-11-18/README.md).

## Fixed

| # | Bug | Root cause | Test that reproduces it | Commit |
|---|---|---|---|---|
| R1 | Importing media by link failed with “URI malformed” when the file's name in the address had a `%` that isn't an escape (`100%_final.png`) — after the file had been downloaded, which was then left in the library with no asset | `importUrl` named the asset with `decodeURIComponent` on the address's last segment, unguarded, as its last step | `electron/integrations/media.test.ts` › “names a file whose address isn’t properly escaped…” | this round |

Fixed earlier in the same audit round, each with its commit (see the audit report, section 8): BUG-01, 02, 03, 04, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15; SEC-01, 02, 03, 07; PERF-02; UX-01, 05.

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
