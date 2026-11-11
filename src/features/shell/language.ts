import { toast } from 'sonner'
import { chooseLanguage, tt, type LanguageChoice } from '@/lib/i18n'
import { desktop } from '@/lib/platform'
import { isDirty, saveProject } from '@/project/session'

/**
 * Sets the language of the interface. What a window says is settled as it opens, so the change shows the next
 * time Lumen starts: the user is offered that now, with their project saved first.
 */
export function switchLanguage(choice: LanguageChoice) {
  if (!chooseLanguage(choice)) return
  toast(tt('The language changes when Lumen starts again'), {
    description: desktop ? tt('Your project is saved first.') : tt('Reload the page to see it.'),
    duration: 20000,
    action: desktop ? { label: tt('Restart now'), onClick: () => void restart() } : undefined,
  })
}

async function restart() {
  // Nothing is lost: an unsaved project is saved first (cancelling the Save dialog cancels the restart).
  if (isDirty() && !(await saveProject())) return
  desktop?.system.relaunch()
}
