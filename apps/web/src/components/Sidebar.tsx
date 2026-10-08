import type { ReactNode } from 'react'
import { Avatar } from './Avatar'
import { IconButton } from './IconButton'
import { NavGroupLabel, NavItem } from './NavItem'
import { NavProject } from './NavProject'

interface SidebarProps {
  userInitial: string
  userName: string
  onCollapse?: () => void
  /** Opens the in-app guide — rendered as a "?" button in the footer, next to the user. */
  onGuide?: () => void
  guideActive?: boolean
  children: ReactNode
}

/**
 * The 256px process-list rail. `children` is the nav tree — compose it
 * from NavProject, NavGroupLabel and NavItem; it scrolls when it
 * overflows. This component only owns the outer chrome (wordmark,
 * collapse button, user footer); it holds no nav-tree state (which
 * projects are expanded, search) — that's app-level.
 */
export function Sidebar({ userInitial, userName, onCollapse, onGuide, guideActive, children }: SidebarProps) {
  return (
    <nav aria-label="Processes" className="flex w-sidebar-width shrink-0 flex-col gap-step-2xs border-r border-border bg-surface-sunken p-step-lg">
      <div className="flex items-center justify-between py-0 pr-step-2xs pb-step-lg pl-step-md">
        <div className="flex items-center gap-step-md">
          <StormmMark />
          <span className="text-heading font-semibold tracking-heading text-text">Stormm</span>
        </div>
        {onCollapse && <IconButton size="md" aria-label="Hide sidebars" onClick={onCollapse} icon={<CollapseIcon />} />}
      </div>

      <div className="-mx-step-lg flex min-h-0 flex-grow flex-col gap-px overflow-y-auto px-step-lg pb-step-lg">{children}</div>

      <div className="mt-auto flex items-center gap-step-md border-t border-border p-step-sm pt-step-md">
        <Avatar initial={userInitial} />
        <span className="flex-grow text-body font-medium text-text">{userName}</span>
        {onGuide && <IconButton size="sm" aria-label="Guide" aria-pressed={guideActive} onClick={onGuide} icon={<GuideIcon />} />}
      </div>
    </nav>
  )
}

export { NavGroupLabel, NavItem, NavProject }

function StormmMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" className="text-text" />
      <rect x="11.5" y="1.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" className="text-text" />
      <rect x="1.5" y="11.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" className="text-text" />
      <rect x="11.5" y="11.5" width="7" height="7" rx="1.5" fill="currentColor" className="text-text" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  )
}

function GuideIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.3h.01" />
    </svg>
  )
}
