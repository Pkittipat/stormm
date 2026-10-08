import type { ReactNode } from 'react'
import { IconButton } from './IconButton'
import { TypeSwatch } from './TypeSwatch'
import { blockKindClasses, blockKindLabel, type BlockKind } from './types'

interface PanelProps {
  kind: BlockKind
  /** Plain text, or an inline editor (see EditableText). */
  title: ReactNode
  onClose?: () => void
  /**
   * `docked` sits flush against the app edge inside the normal layout
   * flow (square corners, border-l only — see Main.dc.html). `floating`
   * is absolutely positioned with all-around corners and a shadow (see
   * Focus-Selected.dc.html) — its parent must be `position: relative`.
   */
  variant?: 'docked' | 'floating'
  children: ReactNode
}

/**
 * The block inspector. Both variants share the same internal chrome
 * (mono type-eyebrow + close button, block-name heading) — only the
 * outer shell differs. Compose PanelSection + FieldRow + Tabs inside
 * `children` for the body.
 */
export function Panel({ kind, title, onClose, variant = 'docked', children }: PanelProps) {
  const shellClass =
    variant === 'docked'
      ? 'h-full w-panel-width border-l border-border bg-surface-sunken'
      : // bottom clears the canvas's floating composer bar (24px offset + ~56px tall + a gap) so the two never overlap.
        'absolute top-step-2xl right-step-2xl bottom-[88px] w-panel-width rounded-floating-panel border border-border bg-surface-sunken shadow-float-md'

  return (
    <aside aria-label="Block inspector" className={`box-border flex flex-col overflow-hidden p-step-lg ${shellClass}`}>
      <div className="flex items-center justify-between pt-step-2xs pr-step-2xs pb-0 pl-step-md">
        <div className={`flex items-center gap-step-xs font-mono text-micro font-medium tracking-mono-label uppercase ${blockKindClasses[kind].text}`}>
          <TypeSwatch kind={kind} size="sm" />
          {blockKindLabel[kind]}
        </div>
        <IconButton size="sm" aria-label="Close inspector" onClick={onClose} icon={<CloseIcon />} />
      </div>
      <div className="px-step-md pt-step-2xs pb-step-lg text-heading font-semibold text-text">{title}</div>
      {children}
    </aside>
  )
}

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
