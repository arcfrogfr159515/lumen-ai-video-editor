/**
 * Small text files written where the user chooses: marker lists, clip notes,
 * macros. A Save dialog in the desktop app, a download in a browser.
 */
import { toast } from 'sonner'
import { desktop } from '@/lib/platform'
import { tt } from '@/lib/i18n'

export interface TextFile {
  /** Suggested file name, without the extension. */
  name: string
  extension: string
  /** What the Save dialog calls this kind of file. */
  filterName: string
  mime?: string
  text: string
}

/** Characters a file name can't hold on Windows, macOS or Linux. */
export const safeFileName = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || tt('Untitled')

/** Saves the text; resolves to where it went, or null if the user closed the dialog. */
export async function saveTextFile(file: TextFile, done?: string): Promise<{ path: string } | null> {
  const name = safeFileName(file.name)
  if (!desktop) {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mime ?? 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.${file.extension}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    if (done) toast.success(done, { description: a.download })
    return { path: a.download }
  }
  const handle = await desktop.export.begin({ defaultName: name, extension: file.extension, filterName: file.filterName })
  if (!handle) return null
  try {
    await desktop.export.write(handle.id, 0, new TextEncoder().encode(file.text))
    const res = await desktop.export.finish(handle.id)
    if (done) toast.success(done, { description: res.path, action: { label: tt('Show'), onClick: () => void desktop?.files.reveal(res.path) } })
    return { path: res.path }
  } catch (err) {
    await desktop.export.abort(handle.id).catch(() => {})
    throw err
  }
}

/** Reads a text file the user picks (null if they pick none). */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const file = input.files?.[0]
      resolve(file ? { name: file.name, text: await file.text() } : null)
    }
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

export async function copyText(text: string, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
    return true
  } catch {
    toast.error('Couldn’t reach the clipboard')
    return false
  }
}
