/**
 * A session key is the whole invitation: it names the channel the host and its guests meet on,
 * and nothing about a session is stored anywhere else. So it's built to be read aloud and typed
 * by hand — no I, L, O, 0 or 1, which are the characters people get wrong.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const LENGTH = 6

export function newSessionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH))
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

/** Uppercases a typed-in key and drops spaces and dashes; null when what's left isn't a key. */
export function readSessionKey(input: string): string | null {
  const key = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (key.length !== LENGTH) return null
  return [...key].every((c) => ALPHABET.includes(c)) ? key : null
}
