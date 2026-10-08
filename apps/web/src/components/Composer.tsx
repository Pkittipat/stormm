import { useState } from 'react'
import { AddBlockMenu } from './AddBlockMenu'
import type { BlockKind } from './types'
import { useMenu } from './useMenu'

interface ComposerProps {
  placeholder?: string
  onAddBlock: (kind: BlockKind) => void
  onSubmit?: (value: string) => void
}

/**
 * The floating natural-language input bar pinned to the bottom of the
 * canvas. Its add-block menu uses the shared useMenu hook (closes on
 * outside click or Escape, like every other menu) and highlights the
 * "+" button while open, so it's never left stuck open with no visible
 * state. The 40px add-button uses `radius-node`, distinct from
 * IconButton's sm/md sizes; the circular send button is a one-off
 * (`rounded-full`, bg-text).
 */
export function Composer({ placeholder, onAddBlock, onSubmit }: ComposerProps) {
  const addMenu = useMenu()
  const [value, setValue] = useState('')

  return (
    <form
      className="m-0 flex w-full items-center gap-step-sm rounded-2xl border border-border-elevated bg-surface-raised p-step-sm shadow-float-sm"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.(value)
      }}
    >
      <div ref={addMenu.ref} className="relative shrink-0">
        <button
          type="button"
          aria-label="Add block"
          aria-haspopup="menu"
          aria-expanded={addMenu.open}
          onClick={addMenu.toggle}
          className="flex h-control-xl w-control-xl items-center justify-center rounded-node border-0 bg-transparent text-lg text-text aria-expanded:bg-surface-sunken"
        >
          +
        </button>
        {addMenu.open && (
          <AddBlockMenu
            onSelect={(kind) => {
              onAddBlock(kind)
              addMenu.close()
            }}
          />
        )}
      </div>
      <label htmlFor="composer-prompt" className="sr-only">
        Describe a process
      </label>
      <input
        id="composer-prompt"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? 'Describe a process, e.g. “When an order is cancelled, refund the payment”'}
        className="h-control-xl min-w-0 flex-grow border-0 bg-transparent p-0 text-emphasis text-text outline-none"
      />
      <button
        type="submit"
        aria-label="Send"
        className="flex h-control-lg w-control-lg shrink-0 items-center justify-center rounded-full border-0 bg-text text-surface"
      >
        &uarr;
      </button>
    </form>
  )
}
