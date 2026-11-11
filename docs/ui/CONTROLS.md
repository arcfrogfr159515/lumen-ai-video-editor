# Every control, before and after

Each screen of the desktop app was opened in the build from before this round (tag `pre-round2`) and in the build after it, in English, and every control on it listed by what it is and what it is called — buttons, links, fields, tabs, menu items, switches, sliders, options. This table is those two lists compared.

- **5267** controls before, **5314** after, over 45 screens.
- **5072** are the same control with the same name.
- **194** are the same control with a name it didn't have, or a fuller one (sliders and the keyframe button had none for a screen reader).
- **48** are new.
- **1** were not found after.

| Screen | Before | After | Same | Named | New | Not found after |
|---|---:|---:|---:|---:|---:|---:|
| `01-home-empty` | 15 | 15 | 15 | 0 | 0 | 0 |
| `02-editor-empty` | 107 | 107 | 106 | 1 | 0 | 0 |
| `03-editor-clip-selected` | 138 | 138 | 124 | 14 | 0 | 0 |
| `04-left-audio` | 168 | 167 | 153 | 14 | 0 | 1 |
| `04-left-effects` | 148 | 149 | 134 | 14 | 1 | 0 |
| `04-left-generate` | 143 | 143 | 129 | 14 | 0 | 0 |
| `04-left-looks` | 141 | 141 | 127 | 14 | 0 | 0 |
| `04-left-media` | 138 | 138 | 124 | 14 | 0 | 0 |
| `04-left-notes` | 144 | 144 | 130 | 14 | 0 | 0 |
| `04-left-script` | 135 | 135 | 121 | 14 | 0 | 0 |
| `04-left-text` | 135 | 135 | 121 | 14 | 0 | 0 |
| `04-left-transitions` | 147 | 147 | 133 | 14 | 0 | 0 |
| `05-right-mixer` | 119 | 119 | 113 | 6 | 0 | 0 |
| `06-right-copilot` | 109 | 109 | 108 | 1 | 0 | 0 |
| `07-inspector-nothing-selected` | 108 | 108 | 107 | 1 | 0 | 0 |
| `10-dialog-export` | 158 | 158 | 143 | 15 | 0 | 0 |
| `11-dialog-shortcuts` | 109 | 109 | 108 | 1 | 0 | 0 |
| `12-dialog-about` | 111 | 111 | 110 | 1 | 0 | 0 |
| `13-dialog-graphics` | 115 | 115 | 114 | 1 | 0 | 0 |
| `14-dialog-versions` | 109 | 109 | 108 | 1 | 0 | 0 |
| `15-dialog-render-queue` | 110 | 110 | 109 | 1 | 0 | 0 |
| `16-dialog-integrations` | 127 | 127 | 126 | 1 | 0 | 0 |
| `17-command-palette` | 237 | 237 | 236 | 1 | 0 | 0 |
| `18-cleanup-gaps` | 114 | 114 | 113 | 1 | 0 | 0 |
| `19-cleanup-rates` | 117 | 117 | 116 | 1 | 0 | 0 |
| `20-clip-colours` | 115 | 115 | 114 | 1 | 0 | 0 |
| `21-compare` | 110 | 110 | 109 | 1 | 0 | 0 |
| `22-macros` | 112 | 112 | 111 | 1 | 0 | 0 |
| `23-auto-director` | 109 | 109 | 108 | 1 | 0 | 0 |
| `24-batch` | 108 | 108 | 107 | 1 | 0 | 0 |
| `25-storyboard` | 77 | 77 | 76 | 1 | 0 | 0 |
| `26-source-monitor` | 115 | 115 | 114 | 1 | 0 | 0 |
| `30-timeline-tools-menu` | 108 | 108 | 107 | 1 | 0 | 0 |
| `31-clip-context-menu` | 135 | 135 | 134 | 1 | 0 | 0 |
| `40-toasts-error-success` | 109 | 109 | 108 | 1 | 0 | 0 |
| `41-export-in-progress` | 127 | 127 | 125 | 2 | 0 | 0 |
| `42-export-finished` | 129 | 129 | 127 | 2 | 0 | 0 |
| `50-min-window-editor` | 109 | 109 | 108 | 1 | 0 | 0 |
| `51-min-window-export` | 129 | 129 | 127 | 2 | 0 | 0 |
| `52-min-window-integrations` | 128 | 128 | 127 | 1 | 0 | 0 |
| `53-display-150-percent` | 109 | 109 | 108 | 1 | 0 | 0 |
| `54-display-125-percent` | 109 | 109 | 108 | 1 | 0 | 0 |
| `60-keyboard-focus` | 109 | 109 | 108 | 1 | 0 | 0 |
| `70-home-with-recent` | 18 | 18 | 18 | 0 | 0 | 0 |
| `80-after-a-render-error` | 0 | 47 | 0 | 0 | 47 | 0 |

## Reading it

- Nothing was taken away. The one control "not found after" is the render button in the timeline toolbar, which reads "Stop rendering" while previews render in the background and "Render previews" when they don't: it was caught in different states on two screens.
- The new controls are on `80-after-a-render-error`: before, an error while one part drew left the window blank, with nothing in it to count; now the rest of the editor is still there.
- "Named" are sliders (their thumb is what a screen reader announces, and it had no name), the keyframe button (it only had a tooltip), and the model picker (its tip now has the whole text).
- Menus that have to be opened to be seen are not in these lists. File → Appearance and File → Language are new; nothing was removed from any menu.

## What differs, screen by screen

### `02-editor-empty`

- named: `slider | ` → `slider | Timeline zoom`

### `03-editor-clip-selected`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`

### `04-left-audio`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`
- **not found after**: `button | Render previews`

### `04-left-effects`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`
- new: `button | Render previews`

### `04-left-generate`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`

### `04-left-looks`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`

### `04-left-media`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`

### `04-left-notes`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`

### `04-left-script`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`

### `04-left-text`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`

### `04-left-transitions`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`

### `05-right-mixer`

- named: `slider | ` → `slider | Main pan`
- named: `slider | ` → `slider | Voice pan`
- named: `slider | ` → `slider | Music pan`
- named: `slider | ` → `slider | Sound effects pan`
- named: `slider | ` → `slider | Master pan`
- named: `slider | ` → `slider | Timeline zoom`

### `06-right-copilot`

- named: `slider | ` → `slider | Timeline zoom`

### `07-inspector-nothing-selected`

- named: `slider | ` → `slider | Timeline zoom`

### `10-dialog-export`

- named (×7): `button | ` → `button | Animate this property`
- named: `slider | ` → `slider | Scale`
- named: `slider | ` → `slider | Rotation`
- named: `slider | ` → `slider | Opacity`
- named: `slider | ` → `slider | Tilt X`
- named: `slider | ` → `slider | Turn Y`
- named: `slider | ` → `slider | Depth`
- named: `slider | ` → `slider | Timeline zoom`
- named: `slider | ` → `slider | Quality`

### `11-dialog-shortcuts`

- named: `slider | ` → `slider | Timeline zoom`

### `12-dialog-about`

- named: `slider | ` → `slider | Timeline zoom`

### `13-dialog-graphics`

- named: `slider | ` → `slider | Timeline zoom`

### `14-dialog-versions`

- named: `slider | ` → `slider | Timeline zoom`

### `15-dialog-render-queue`

- named: `slider | ` → `slider | Timeline zoom`

### `16-dialog-integrations`

- named: `slider | ` → `slider | Timeline zoom`

### `17-command-palette`

- named: `slider | ` → `slider | Timeline zoom`

### `18-cleanup-gaps`

- named: `slider | ` → `slider | Timeline zoom`

### `19-cleanup-rates`

- named: `slider | ` → `slider | Timeline zoom`

### `20-clip-colours`

- named: `slider | ` → `slider | Timeline zoom`

### `21-compare`

- named: `slider | ` → `slider | Timeline zoom`

### `22-macros`

- named: `slider | ` → `slider | Timeline zoom`

### `23-auto-director`

- named: `slider | ` → `slider | Timeline zoom`

### `24-batch`

- named: `slider | ` → `slider | Timeline zoom`

### `25-storyboard`

- named: `slider | ` → `slider | Timeline zoom`

### `26-source-monitor`

- named: `slider | ` → `slider | Timeline zoom`

### `30-timeline-tools-menu`

- named: `slider | ` → `slider | Timeline zoom`

### `31-clip-context-menu`

- named: `slider | ` → `slider | Timeline zoom`

### `40-toasts-error-success`

- named: `slider | ` → `slider | Timeline zoom`

### `41-export-in-progress`

- named: `slider | ` → `slider | Timeline zoom`
- named: `slider | ` → `slider | Quality`

### `42-export-finished`

- named: `slider | ` → `slider | Timeline zoom`
- named: `slider | ` → `slider | Quality`

### `50-min-window-editor`

- named: `slider | ` → `slider | Timeline zoom`

### `51-min-window-export`

- named: `slider | ` → `slider | Timeline zoom`
- named: `slider | ` → `slider | Quality`

### `52-min-window-integrations`

- named: `slider | ` → `slider | Timeline zoom`

### `53-display-150-percent`

- named: `slider | ` → `slider | Timeline zoom`

### `54-display-125-percent`

- named: `slider | ` → `slider | Timeline zoom`

### `60-keyboard-focus`

- named: `slider | ` → `slider | Timeline zoom`

### `80-after-a-render-error`

- new: `button | Lumen`
- new: `button | Review`
- new: `button | Unsaved changes`
- new: `button | Search, or ask Copilot to edit…CtrlK`
- new: `button | Integrations`
- new: `button | Undo`
- new: `button | Redo`
- new: `button | Record a screen or window`
- new: `button | Copilot`
- new: `button | Export`
- new: `button | Media`
- new: `button | Audio`
- new: `button | Text`
- new: `button | Effects`
- new: `button | Transitions`
- new: `button | Looks`
- new: `button | Script`
- new: `button | Notes`
- new: `button | Generate`
- new: `button | Import`
- new: `input:text | Search media, tags…`
- new: `button | All1`
- new: `button | Video1`
- new: `button | Images0`
- new: `button | Audio0`
- new: `button | Add beach walk at playhead`
- new (×2): `button | Try again`
- new: `tab | Inspector`
- new: `tab | Mixer`
- new: `tab | Copilot`
- new: `input:text | `
- new: `button | Canvas`
- new: `button | Widescreen · 1920×1080`
- new: `button | 4K UHD · 3840×2160`
- new: `button | Vertical · 1080×1920`
- new: `button | Square · 1080×1080`
- new: `button | Portrait · 1080×1350`
- new: `combobox | Frame rate`
- new: `button | #000000`
- new: `button | #0b0b12`
- new: `button | #ffffff`
- new: `button | #1d1b2e`
- new: `button | #12281f`
- new: `button | #2b1522`
- new: `button | Overview`
- new: `button | Review my edit`

