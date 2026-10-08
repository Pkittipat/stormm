import { useEffect, useState, type KeyboardEvent } from 'react'
import { Avatar, Button, useMenu } from '../components'
import { readSessionKey } from './sessionKey'
import type { LivePerson, LiveSession } from './useLiveSession'

/** The name this browser last went by, so nobody types it twice. */
const NAME_KEY = 'stormm.liveName'

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Storage unavailable (private window, blocked): the name just lasts for this page load.
  }
}

interface LiveControlProps {
  /** null when no session is running — the control then offers to start or join one. */
  session: LiveSession | null
  /** A session shares the open process, so there has to be one. Joining never needs it. */
  canStart: boolean
  onStart: (name: string) => void
  onJoin: (key: string, name: string) => void
  onLeave: () => void
}

/**
 * The header's "Live" button and its popover: start a session and share its key, join one with a
 * key, or see who's in and leave. A session puts everyone on one board — this is the whole of its
 * UI, since the canvas itself is what the session is.
 */
export function LiveControl({ session, canStart, onStart, onJoin, onLeave }: LiveControlProps) {
  const { ref, open, toggle, close } = useMenu()
  const [name, setName] = useState(storedName)
  const [key, setKey] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  // Each opening starts clean: an old "that isn't a key" has nothing to do with this one.
  const [problemWhile, setProblemWhile] = useState(open)
  if (problemWhile !== open) {
    setProblemWhile(open)
    setProblem(null)
  }

  const named = (): string | null => {
    const who = name.trim()
    if (!who) {
      setProblem('Your name, so the others know who they are with.')
      return null
    }
    rememberName(who)
    return who
  }

  const start = () => {
    const who = named()
    if (!who) return
    close()
    onStart(who)
  }

  const join = () => {
    const who = named()
    if (!who) return
    const typed = readSessionKey(key)
    if (!typed) {
      setProblem('A session key is six letters and digits.')
      return
    }
    close()
    setKey('')
    onJoin(typed, who)
  }

  const copyKey = () => {
    if (!session) return
    navigator.clipboard.writeText(session.key).then(
      () => setCopied(true),
      () => setProblem("Couldn't copy — the key is right there to read out."),
    )
  }

  const host = session?.people.find((p) => p.role === 'host')
  const dot =
    session?.status === 'live' ? 'bg-accent' : session?.status === 'error' ? 'bg-hotspot-dot' : session ? 'bg-border-dot' : 'bg-transparent ring-1 ring-border-dot'

  return (
    <div ref={ref} className="relative">
      <Button aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <span aria-hidden="true" className={`box-border h-indicator-xs w-indicator-xs shrink-0 rounded-full ${dot}`} />
        Live
        {session && session.people.length > 0 && <span className="text-text-muted">{session.people.length}</span>}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Live session"
          // whitespace-normal: the header's action row sets nowrap, which the prose here must not inherit.
          className="absolute top-full right-0 z-20 mt-step-2xs flex w-80 flex-col gap-0 rounded-xl border border-border-elevated bg-surface-raised p-step-2xs whitespace-normal shadow-float-md"
        >
          {session ? (
            <>
              <Label>{session.role === 'host' ? 'Session key' : `Editing with ${host?.name ?? 'the host'}`}</Label>
              <div className="flex items-center gap-step-sm px-step-md pt-step-2xs pb-step-sm">
                <code className="flex-grow font-mono text-heading tracking-heading text-text">{session.key}</code>
                <Button onClick={copyKey} className="h-control-xs! px-step-md!">
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <Note>
                {session.status === 'error'
                  ? "Couldn't reach the session. Check the key, or your connection."
                  : session.role === 'host'
                    ? 'Anyone with this key edits this process with you. It stays saved in your browser; the session ends when you leave.'
                    : 'You are editing the host’s process with them. It isn’t saved here — you’ll be offered a copy when the session ends.'}
              </Note>

              {session.status !== 'error' && (
                <>
                  <Label>In this session</Label>
                  {session.people.length === 0 ? <Note>Connecting…</Note> : session.people.map((p) => <Person key={p.id} person={p} />)}
                </>
              )}

              <div className="mt-step-2xs border-t border-border pt-step-2xs">
                <Button onClick={onLeave} className="w-full justify-center">
                  {session.role === 'host' ? 'End session' : 'Leave session'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Label>Work on this together</Label>
              <Note>
                {canStart
                  ? 'Start a session and share its key: everyone who joins edits this process with you, on one board, as you work.'
                  : 'Open a process to share one. You can still join someone else’s session with their key.'}
              </Note>

              {canStart && (
                <>
                  <div className="px-step-md">
                    <Field label="Your name" value={name} placeholder="e.g. Ann" onChange={setName} onEnter={start} />
                  </div>
                  <div className="px-step-md pt-step-sm">
                    <Button variant="primary" onClick={start} className="w-full justify-center">
                      Start a session
                    </Button>
                  </div>
                </>
              )}

              {canStart && <div role="separator" className="mx-step-sm mt-step-md mb-step-2xs h-px shrink-0 bg-border" />}
              <Label>{canStart ? 'Or join one' : 'Join a session'}</Label>
              {!canStart && (
                <div className="px-step-md">
                  <Field label="Your name" value={name} placeholder="e.g. Ben" onChange={setName} onEnter={join} />
                </div>
              )}
              <div className="flex items-end gap-step-sm px-step-md pb-step-2xs">
                <Field label="Session key" value={key} placeholder="ABC234" mono onChange={setKey} onEnter={join} />
                <Button onClick={join}>Join</Button>
              </div>
            </>
          )}

          {problem && <div className="px-step-md py-step-xs text-meta text-hotspot-text">{problem}</div>}
        </div>
      )}
    </div>
  )
}

function Label({ children }: { children: string }) {
  return <div className="px-step-sm pt-1.25 pb-step-2xs text-chip font-medium text-text-muted">{children}</div>
}

function Note({ children }: { children: string }) {
  return <p className="m-0 px-step-md pb-step-xs text-meta text-text-muted">{children}</p>
}

function Person({ person }: { person: LivePerson }) {
  return (
    <div className="flex h-control-lg shrink-0 items-center gap-step-md px-step-md">
      <Avatar initial={person.name.slice(0, 1).toUpperCase()} />
      <span className="min-w-0 flex-grow truncate text-body text-text">{person.name}</span>
      {person.role === 'host' && <span className="shrink-0 text-meta text-text-muted">host</span>}
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  placeholder: string
  mono?: boolean
  onChange: (value: string) => void
  onEnter: () => void
}

function Field({ label, value, placeholder, mono, onChange, onEnter }: FieldProps) {
  return (
    <label className="flex min-w-0 flex-grow flex-col gap-step-2xs pt-step-2xs">
      <span className="text-label font-medium text-text-muted">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onEnter()
          }
        }}
        className={`h-control-md w-full min-w-0 rounded-md border-0 bg-surface px-step-md text-body text-text ring-1 ring-border-input outline-none placeholder:text-text-placeholder focus:ring-accent ${
          mono ? 'font-mono tracking-mono-label uppercase' : ''
        }`}
      />
    </label>
  )
}
