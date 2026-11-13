/**
 * Lumen's updates, as the editor sees them: the main process checks the GitHub
 * Releases page, downloads a newer version in the background and installs it on
 * restart. The editor shows where that's at and offers the restart.
 */
import { toast } from 'sonner'
import { create } from 'zustand'
import type { UpdateState } from '@shared/app'
import { APP_VERSION, desktop } from '@/lib/platform'
import { tt } from '@/lib/i18n'

/** The Releases page this build updates from — the same repository the installer's update feed names. */
export const RELEASES_URL: string = typeof __RELEASES_URL__ === 'string' ? __RELEASES_URL__ : ''
export const releaseUrl = (version: string) => `${RELEASES_URL}/tag/v${version}`

export const useUpdates = create<UpdateState>(() => ({ status: desktop ? 'idle' : 'unsupported', current: APP_VERSION }))

let started = false
let announced: string | undefined
/** The user asked for this check — say how it went. */
let asked = false

function readyToast(version: string) {
  toast(tt('Lumen {0} is ready', version), {
    id: 'lumen-update',
    description: tt('Restart to update. If anything is unsaved, you’ll be asked first.'),
    duration: Number.POSITIVE_INFINITY,
    action: { label: tt('Restart'), onClick: () => void installUpdate() },
  })
}

function apply(state: UpdateState) {
  useUpdates.setState(state, true)
  if (state.status === 'ready' && state.version && announced !== state.version) {
    announced = state.version
    readyToast(state.version)
  }
  if (!asked || state.status === 'checking' || state.status === 'idle') return
  asked = false
  if (state.status === 'up-to-date') toast.success(tt('Lumen {0} is the latest version.', state.current))
  else if (state.status === 'downloading') toast(tt('Downloading Lumen {0}…', state.version), { description: tt('It installs when you restart.') })
  else if (state.status === 'ready' && state.version) readyToast(state.version)
  else if (state.status === 'error') toast.error(state.error ?? tt('Couldn’t check for updates.'))
  else if (state.status === 'unsupported') toast(tt('This build doesn’t update itself'), { description: tt('Updates come to the installed app — download it from the Releases page.') })
}

export function startUpdates() {
  if (started || !desktop) return
  started = true
  desktop.updates.onState(apply)
  void desktop.updates.state().then(apply)
}

export async function checkForUpdates() {
  if (!desktop) return
  asked = true
  apply(await desktop.updates.check())
}

export async function installUpdate() {
  if (!desktop) return
  if (!(await desktop.updates.install())) toast.error(tt('There’s no downloaded update to install yet.'))
}
