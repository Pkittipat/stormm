/** How many presence colors tokens.css defines. */
const PRESENCE_COLORS = 8

/**
 * The color someone shows up in, derived from the id they hold for the session.
 *
 * Deliberately not random per client: a color each browser picked for itself would make
 * "the one in blue" mean nothing, since you'd each be looking at a different blue. Derived
 * this way, everyone sees the same person in the same color without anyone agreeing on it.
 */
export function colorOf(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return `var(--color-presence-${(hash % PRESENCE_COLORS) + 1})`
}
