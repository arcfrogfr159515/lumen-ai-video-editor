# The interface, before and after the review

Screenshots of the desktop app in the states it can be in, taken by a script from the running program at 1600×1000 (and at the smallest window, 1120×700, and at 125% and 150% display scaling).

| Folder | What |
|---|---|
| `before/` | As it was before the review (tag `pre-round2`), dark, English — 48 screens |
| `after/` | The same screens after it, dark, English — 45 screens, same file names |
| `after-light/` | A selection in the light theme |
| `after-zh/` | A selection in Simplified Chinese |
| `after-zh-light/` | Chinese and light together |
| [`CONTROLS.md`](CONTROLS.md) | Every control of every screen, before against after |
| `before/2026-11-13/`, `after/2026-11-13/` | A second round, in Chinese at 1500×950: 17 screens before and after — see [`REVIEW-2026-11-13.md`](REVIEW-2026-11-13.md) and [`CONTROLS-2026-11-13.md`](CONTROLS-2026-11-13.md) |

The three screens in `before/` that have no counterpart in `after/` were taken by a second script that measured the interface (`90-…`, `91-…`, `92-…`); what they showed is in the table below.

## What the review found, and what became of it

| | Finding | Now | Where to look |
|---|---|---|---|
| U-01 | The library rail held nine tabs; below a window height of about 780 px the last were cut off and Generate was covered | At the smallest window all nine are in view (as icons, named in the tip and to a screen reader); below that they scroll and Generate keeps its place | `50-min-window-editor` |
| U-02 | An empty Copilot chat opened scrolled to the bottom, its heading out of view | Read from its top | `06-right-copilot` |
| U-03 | The media filter chips ran off the edge of a narrow panel | They wrap | `50-min-window-editor` |
| U-04 | "No AI connected" was cut short while the detail beside it kept its room | The detail gives way first; the whole text is in the tip | `06-right-copilot` |
| U-05 | The dimmest text grey read at 2.2–2.8:1 (388 uses) | 4.7:1 or better on every surface text sits on | any |
| U-06 | The next grey dropped to 3.8:1 on raised surfaces | 5.4:1 or better | any |
| U-07 | About 960 colours written as literals | The interface is drawn in tokens: ink, shade and on-media replace white and black. What is left as a literal is colour as content — palettes, clip colours, title styles, 3D materials, the scopes, the logo | — |
| U-08 | 108 font sizes off the scale, down to 8 px (and 5 px in thumbnails) | 104 are on the eight-step scale; nothing in the interface is under 10 px. Three miniature preset drawings are left as drawn | any |
| U-09 | Two thirds of the text is 10–11 px | Unchanged: the density is the design. It is readable now that it has contrast | — |
| U-10 | 178 buttons written by hand rather than with the shared component | Not replaced — they are cards, rows and chips with shapes of their own, and swapping them would change what they look like. What the inconsistency cost has been dealt with instead: every one has a type, a name, a focus outline and token colours (measured, see U-11 and U-16) | — |
| U-11 | 16 of 119 controls on the first screen under 24 px to hit | Measured over six screens: 70 of 719 were; 3 are (a badge drawn at 90%, 22 px) | — |
| U-12 | An error while one part drew left the whole window blank | Only that part says so; the rest stays | `80-after-a-render-error` |
| U-13 | Dark only | A light theme: File → Appearance. Dark stays the default | `after-light/` |
| U-14 | `color-scheme` not declared | Declared, and it follows the theme | — |
| U-15 | 39 controls switched the focus outline off | 16 had nothing in its place and have the outline back; the rest are fields that show focus by their caret and what holds them | `60-keyboard-focus` |
| U-16 | Sliders had no name for a screen reader | None of the 719 controls measured is without a name | — |

## How the dark theme was kept as it was

The colour change touched 87 files. Screenshots of all 45 screens were taken before and after it and compared pixel by pixel: the only pixels that differ are a file name with a random id in it, an animation, and a progress bar. The same comparison was made after the light theme was added.

## What is not done

- The light theme has been looked at on 45 screens, not on every state of every dialog. The viewer, clip colours and what the engine paints into frames are the same in both themes on purpose.
- The window's background while it first loads is the remembered theme's; on the very first start in light it is dark for a moment.
