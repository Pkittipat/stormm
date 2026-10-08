import { useState, type KeyboardEvent } from 'react'
import type { Issue } from '@stormm/process-model'
import { Button, IconButton, PanelSection } from '../components'

interface YamlPanelProps {
  path: string
  yaml: string
  issues: Issue[]
  onCopy: () => void
  onDownload: () => void
  /** Parses the edited text and, if it's a valid process, replaces the board with it. */
  onApply: (text: string) => { applied: boolean; issues: Issue[] }
  onClose: () => void
}

/**
 * The docked YAML view: the exact file a developer reviews (canonical, as stored), with the
 * validation result. Errors block saving; warnings are advice. The source is editable — paste
 * in YAML (e.g. from a GitHub PR) to review it, then Apply to replace the board with it, or
 * Revert to drop the draft. Edits are local until Apply, like every other field in the app.
 */
export function YamlPanel({ path, yaml, issues, onCopy, onDownload, onApply, onClose }: YamlPanelProps) {
  const [draft, setDraft] = useState(yaml)
  const [synced, setSynced] = useState(yaml)
  const [dirty, setDirty] = useState(false)
  const [applyResult, setApplyResult] = useState<{ ok: boolean; issues: Issue[] } | null>(null)

  // Adopt a new canonical yaml from outside (another edit on the canvas) — but only while there's
  // no unapplied draft, so it never clobbers YAML the user is mid-paste/mid-edit on.
  if (yaml !== synced) {
    setSynced(yaml)
    if (!dirty) {
      setDraft(yaml)
      setApplyResult(null)
    }
  }

  const apply = () => {
    const result = onApply(draft)
    setApplyResult({ ok: result.applied, issues: result.issues })
    if (result.applied) setDirty(false)
  }

  const revert = () => {
    setDraft(yaml)
    setDirty(false)
    setApplyResult(null)
  }

  const shown = applyResult ? applyResult.issues : issues
  const errors = shown.filter((i) => i.level === 'error')
  const warnings = shown.filter((i) => i.level === 'warning')

  return (
    <aside aria-label="Process YAML" className="box-border flex h-full w-[420px] shrink-0 flex-col overflow-hidden border-l border-border bg-surface-sunken p-step-lg">
      <div className="flex items-center justify-between pt-step-2xs pr-step-2xs pb-0 pl-step-md">
        <div className="font-mono text-micro font-medium tracking-mono-label text-text-muted uppercase">YAML</div>
        <IconButton size="sm" aria-label="Close YAML" onClick={onClose} icon={<span aria-hidden="true">&times;</span>} />
      </div>
      <div className="truncate px-step-md pt-step-2xs pb-step-lg font-mono text-label text-text" title={path}>
        {path}
      </div>

      <div className="-mx-step-lg min-h-0 flex-grow overflow-y-auto px-step-lg">
        <PanelSection
          label={
            applyResult && !applyResult.ok
              ? "Couldn't apply"
              : `Validation · ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}, ${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}`
          }
        >
          {shown.length === 0 && <div className="px-step-md py-step-xs text-meta text-text-muted">No problems found</div>}
          <ul className="m-0 flex list-none flex-col gap-step-xs p-0">
            {[...errors, ...warnings].map((issue, i) => (
              <li key={i} className="flex gap-step-sm rounded-lg px-step-md py-step-xs text-meta">
                <span className={`shrink-0 font-medium ${issue.level === 'error' ? 'text-hotspot-text' : 'text-text-secondary'}`}>
                  {issue.level === 'error' ? 'Error' : 'Warning'}
                </span>
                <span className="text-text">{issue.message}</span>
              </li>
            ))}
          </ul>
        </PanelSection>

        <PanelSection
          label="File"
          action={
            dirty ? (
              <div className="flex items-center gap-step-sm">
                <span className="text-meta text-text-muted">Edited, not applied</span>
                <Button onClick={revert} className="h-7! px-step-md!">
                  Revert
                </Button>
                <Button variant="primary" onClick={apply} className="h-7! px-step-md!">
                  Apply
                </Button>
              </div>
            ) : (
              <div className="flex gap-step-2xs">
                <Button onClick={onCopy} className="h-7! px-step-md!">
                  Copy
                </Button>
                <Button onClick={onDownload} className="h-7! px-step-md!">
                  Download
                </Button>
              </div>
            )
          }
        >
          <textarea
            aria-label="YAML source"
            spellCheck={false}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setDirty(e.target.value !== yaml)
              setApplyResult(null)
            }}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                apply()
              }
              if (e.key === 'Escape' && dirty) {
                e.preventDefault()
                revert()
              }
            }}
            className="m-0 h-[60vh] w-full resize-y overflow-auto rounded-lg border border-border-subtle bg-surface-raised p-step-md font-mono text-[11px] leading-relaxed whitespace-pre text-text outline-none focus:ring-1 focus:ring-border-input"
          />
        </PanelSection>
      </div>
    </aside>
  )
}
