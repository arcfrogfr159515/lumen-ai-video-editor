import { RotateCcw, Save, TriangleAlert } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from './button'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

/**
 * A part of the editor that fails to draw takes only itself down. Without
 * these, one exception in one component unmounts everything: the window goes
 * blank, with the menus and the Save button gone with it.
 */

interface Props {
  /** What this part is, as the message names it: "The timeline". */
  name: string
  children: ReactNode
  /**
   * How it fails. A panel shows the message where it was, with a way to try
   * again. A dialog closes and says so in a toast — what is behind it is what
   * matters. The whole app (the last resort) offers to save a copy and reload.
   */
  as?: 'panel' | 'dialog' | 'app'
  /** For `app`: saves the project somewhere else, when that can be done here. */
  onSaveCopy?: () => void
}

interface State {
  error: Error | null
}

const brief = (error: Error) => (error.message || String(error)).slice(0, 240)

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} failed to draw`, error, info.componentStack)
    if (this.props.as === 'dialog') {
      toast.error(tt('{0} ran into a problem', this.props.name), {
        description: brief(error),
        action: { label: tt('Try again'), onClick: this.retry },
        duration: 12000,
      })
    }
  }

  retry = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const { name, as = 'panel', onSaveCopy } = this.props
    if (as === 'dialog') return null
    if (as === 'app') {
      return (
        <div role="alert" className="grid h-screen place-items-center bg-canvas p-8 text-fg">
          <div className="max-w-md text-center">
            <TriangleAlert className="mx-auto size-8 text-warn" />
            <h1 className="mt-4 text-xl font-semibold tracking-tight">{tt('Lumen ran into a problem')}</h1>
            <p className="mt-2 text-sm leading-relaxed text-fg-2">{tt('The editor couldn’t be drawn. Your project is still in memory, and what you hadn’t saved is offered back the next time Lumen opens.')}</p>
            <p className="mt-3 rounded-control bg-surface-2 px-3 py-2 text-left font-mono text-xs break-words text-fg-3">{brief(error)}</p>
            <div className="mt-5 flex justify-center gap-2">
              {onSaveCopy && (
                <Button variant="primary" onClick={onSaveCopy}>
                  <Save />{' '}{tt('Save a copy')}
                </Button>
              )}
              <Button onClick={() => location.reload()}>
                <RotateCcw />{' '}{tt('Reload Lumen')}
              </Button>
              <Button variant="ghost" onClick={this.retry}>
                {tt('Try again')}
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div role="alert" className="grid h-full min-h-0 place-items-center overflow-auto rounded-panel bg-surface p-4 shadow-panel">
        <div className="max-w-xs text-center">
          <TriangleAlert className="mx-auto size-5 text-warn" />
          <p className="mt-2 text-sm font-medium text-fg">{ttx('{0} ran into a problem', name)}</p>
          <p className="mt-1 text-xs leading-relaxed break-words text-fg-3">{brief(error)}</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-3">{tt('The rest of the editor still works: you can save, undo, or try again.')}</p>
          <Button size="sm" className="mt-3" onClick={this.retry}>
            <RotateCcw />{' '}{tt('Try again')}
          </Button>
        </div>
      </div>
    )
  }
}
