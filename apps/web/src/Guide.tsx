import { BLOCK_KINDS } from '@stormm/process-model'
import { blockKindClasses, blockKindLabel, TypeSwatch } from './components'
import { liveConfigured } from './live/client'

/** One step of the usual EventStorming grammar, shown as a labeled arrow chain. */
const GRAMMAR_STEPS = ['Read model', 'Command', 'Aggregate', 'Event', 'Policy', 'Command'] as const

const KIND_NOTES: Record<(typeof BLOCK_KINDS)[number], string> = {
  readmodel: 'Data shown to someone so they know what to do next — a list, a dashboard, a confirmation screen.',
  command: 'An intent someone (or something) triggers — "Place order", "Cancel subscription". Give it an Actor.',
  aggregate: 'The business entity that enforces the rules. Carries invariants (decided rules) and hotspots (open questions).',
  system: 'Something outside this domain — a payment processor, an email service. Can stand in for an aggregate in the flow.',
  event: 'A fact: something already happened. Named in the past tense — "Order placed", "Payment failed".',
  policy: 'An automatic reaction to an event that fires a new command — "Whenever X happens, do Y".',
}

const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'Delete / Backspace', does: 'Delete the selected blocks or connection' },
  { keys: 'Escape', does: 'Clear the selection' },
  { keys: '⌘/Ctrl A', does: 'Select every block (on the canvas)' },
  { keys: '⌘/Ctrl C', does: 'Copy the selected blocks, with the connections between them' },
  { keys: '⌘/Ctrl V', does: 'Paste blocks — or paste YAML copied from anywhere' },
  { keys: '⌘/Ctrl Z', does: 'Undo the last edit' },
  { keys: '⌘/Ctrl ⇧ Z  (or ⌘/Ctrl Y)', does: 'Redo' },
  { keys: 'Space + drag', does: 'Pan the canvas' },
  { keys: 'Scroll / trackpad pinch', does: 'Pan or zoom the canvas' },
  { keys: 'Double-click a block', does: 'Rename it in place' },
  { keys: 'Right-click', does: 'Add a block (empty canvas) or rename/delete it (a block or connection)' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-step-md border-t border-border-subtle pt-step-2xl first:border-t-0 first:pt-0">
      <h2 className="m-0 text-heading font-semibold tracking-heading text-text">{title}</h2>
      <div className="flex flex-col gap-step-md text-body text-text">{children}</div>
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="m-0 leading-relaxed text-text-secondary">{children}</p>
}

/**
 * The in-app help page, reached from the "?" button in the sidebar footer (`#/guide`). A static
 * reference, not a tutorial to click through — what the six block kinds mean, how to build and
 * wire a process, and every keyboard shortcut. Reuses the app's own design tokens so it reads as
 * part of the product rather than a bolted-on docs page.
 */
export function Guide() {
  return (
    <div className="min-h-0 flex-grow overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-step-2xl px-step-3xl py-step-3xl">
        <header className="flex flex-col gap-step-xs">
          <h1 className="m-0 text-emphasis font-semibold text-text">Guide</h1>
          <P>Stormm is an EventStorming board: lay out a process as six kinds of block, wire them together, and keep the result as plain YAML. Everything here is saved only in this browser.</P>
        </header>

        <Section title="The six block kinds">
          <P>Click “+” in the composer or right-click empty canvas to add one. Each kind has its own color, used consistently across the board, the Inspector, and the YAML.</P>
          <ul className="m-0 flex list-none flex-col gap-step-sm p-0">
            {BLOCK_KINDS.map((kind) => (
              <li key={kind} className={`flex gap-step-md rounded-lg border p-step-md ${blockKindClasses[kind].surface} ${blockKindClasses[kind].line}`}>
                <TypeSwatch kind={kind} size="md" />
                <div className="flex flex-col gap-step-2xs">
                  <div className={`font-mono text-micro font-medium tracking-mono-label uppercase ${blockKindClasses[kind].text}`}>{blockKindLabel[kind]}</div>
                  <div className="text-meta text-text-secondary">{KIND_NOTES[kind]}</div>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="The usual grammar">
          <P>A process doesn't have to follow this, but most do — it's checked as a warning, not an error, so you can break it deliberately:</P>
          <div className="flex flex-wrap items-center gap-step-2xs rounded-lg border border-border-subtle bg-surface-raised p-step-md text-label font-medium text-text">
            {GRAMMAR_STEPS.map((step, i) => (
              <span key={i} className="flex items-center gap-step-2xs">
                {i > 0 && <span className="text-text-muted">→</span>}
                <span>{step}</span>
              </span>
            ))}
          </div>
          <P>Two other shapes are also valid: an event can lead straight to a read model (closing the loop back to the UI), and an external system can stand in for the aggregate step — command → system → event.</P>
        </Section>

        <Section title="Building a process">
          <P>
            <strong className="text-text">Add a block</strong> with the “+” composer at the bottom of the canvas, or right-click empty canvas to drop one exactly where you click.
          </P>
          <P>
            <strong className="text-text">Wire two blocks</strong> by dragging from a block's right-hand port to another block's body. Dragging a wire onto empty canvas instead opens a menu to create a new, already-connected block there.
          </P>
          <P>
            <strong className="text-text">Rename</strong> a block by double-clicking its title, or editing it in the Inspector.
          </P>
          <P>
            <strong className="text-text">Select</strong> a block by clicking it; shift-click or drag a box over several to select more than one. Dragging a selected block moves the whole selection; a “Reset layout” button appears once you've moved anything, to snap back to the automatic layout.
          </P>
        </Section>

        <Section title="The Inspector">
          <P>Selecting one block opens the Inspector, docked on the right — the same place the sidebar lives on the left. Edit its Actor, Hotspots (open questions), Invariants (rules an aggregate enforces), and Fields there, and see what it connects to.</P>
        </Section>

        <Section title="The YAML panel">
          <P>The “YAML” button in the header shows the process as the exact file it's stored as, with live validation — errors and warnings, same rules either way you edit.</P>
          <P>The YAML is editable: paste in YAML (from a GitHub PR, say) to review it, then <strong className="text-text">Apply</strong> to replace the board with it, or <strong className="text-text">Revert</strong> to drop the draft. The process's id stays frozen even if the pasted YAML names a different one.</P>
          <P>Copy or Download export the canonical file as currently saved.</P>
        </Section>

        <Section title="Undo & saving">
          <P>Every edit — renaming, wiring, adding or deleting a block, applying YAML — can be undone and redone (⌘/Ctrl Z, ⌘/Ctrl ⇧ Z). Dragging a block to reposition it is a personal view preference, not board content, so it isn't part of undo history.</P>
          <P>Everything saves straight to this browser's storage as you go — no account, and no copy of a process anywhere else. Use Import/Export (or copy/paste YAML) to move a process between browsers or share it.</P>
        </Section>

        {liveConfigured && (
          <Section title="Live sessions">
            <P>
              <strong className="text-text">Live → Start a session</strong> shares this process under a six-character key. Anyone who types it into <strong className="text-text">Live → Join</strong> edits it with you: one board, everyone's changes appearing as they're made. Your pan, zoom and selection stay yours, so two people can work on different corners at once.
            </P>
            <P>
              Edits merge by who touched each thing last. Two people changing different blocks keep both changes; two people changing the same one settle on the later. Undo takes back your own last edit, and travels like any other.
            </P>
            <P>Only the person who started the session keeps the process — it's theirs, and it saves to their browser as you work. Everyone else is offered a copy when the session ends, filed under a new name so nothing of theirs is overwritten. Opening one of your own processes leaves the session.</P>
            <P>Nothing is stored anywhere else. The key is the whole invitation, so share it like a meeting link — anyone holding it can edit — and the session ends when the host closes the tab.</P>
          </Section>
        )}

        <Section title="Projects & import">
          <P>Group processes under a project from the sidebar. “Import” accepts one or more <code className="rounded-sm bg-surface-raised px-1 font-mono text-meta">.yaml</code>/<code className="rounded-sm bg-surface-raised px-1 font-mono text-meta">.yml</code> files, or a whole folder — a <code className="rounded-sm bg-surface-raised px-1 font-mono text-meta">.stormm/</code> folder's files import together as one project.</P>
        </Section>

        <Section title="Keyboard shortcuts">
          <ul className="m-0 flex list-none flex-col gap-px p-0">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex items-center justify-between gap-step-lg rounded-lg px-step-md py-step-xs">
                <span className="text-meta text-text-secondary">{s.does}</span>
                <kbd className="shrink-0 rounded-md border border-border-input bg-surface-raised px-step-sm py-step-3xs font-mono text-meta text-text">{s.keys}</kbd>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}
