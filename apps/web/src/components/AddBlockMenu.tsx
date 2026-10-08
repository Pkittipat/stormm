import { TypeSwatch } from './TypeSwatch'
import { BLOCK_KINDS } from '@stormm/process-model'
import { blockKindLabel, type BlockKind } from './types'

const kinds: readonly BlockKind[] = BLOCK_KINDS

interface AddBlockMenuProps {
  onSelect: (kind: BlockKind) => void
}

/**
 * The floating "elevation 2" dropdown opened by the composer's add
 * button. Positions itself above its trigger — render inside a
 * `position: relative` wrapper with this as an absolutely-positioned
 * sibling (see Composer).
 */
export function AddBlockMenu({ onSelect }: AddBlockMenuProps) {
  return (
    <div
      role="menu"
      aria-label="Add block"
      className="absolute -left-0.5 bottom-12.5 flex w-menu-width flex-col gap-0 rounded-xl border border-border-elevated bg-surface-raised p-step-2xs shadow-float-md"
    >
      <div className="px-step-sm pt-1.25 pb-step-2xs text-chip font-medium text-text-muted">Add block</div>
      {kinds.map((kind) => (
        <button
          key={kind}
          type="button"
          role="menuitem"
          onClick={() => onSelect(kind)}
          className="flex h-control-sm items-center gap-step-md rounded-md border-0 bg-transparent px-step-sm text-left text-label text-text outline-none hover:bg-surface-sunken focus-visible:bg-surface-sunken"
        >
          <TypeSwatch kind={kind} size="md" />
          {blockKindLabel[kind]}
        </button>
      ))}
    </div>
  )
}
