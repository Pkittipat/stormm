import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The project URL, e.g. `https://xxxx.supabase.co`. The client appends its own paths, so a URL
 * copied from the dashboard's Data API section (which ends in `/rest/v1/`) is trimmed back to
 * the project — otherwise the websocket would be looked for under the REST endpoint.
 */
const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, '').replace(/\/rest\/v\d+$/, '')
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Live sessions ride on Supabase Realtime's Broadcast and Presence: a hosted WebSocket fan-out
 * with no tables, no rows and no sign-in. Both values below are public by design (they ship in
 * the bundle, and a public channel needs nothing more).
 *
 * Without them the app is exactly what it was — everything in this browser's localStorage — the
 * Live control stays hidden, and the client's chunk is never requested.
 */
export const liveConfigured = Boolean(url && anonKey)

let client: SupabaseClient | null = null
let loading: Promise<SupabaseClient> | null = null

/**
 * Starts (or joins) loading the client, which arrives in its own chunk — the realtime library is
 * some 56KB gzipped, and most sessions never open one, so it stays off the first paint. Null when
 * live sessions aren't configured.
 */
export function loadClient(): Promise<SupabaseClient> | null {
  if (!url || !anonKey) return null
  loading ??= import('@supabase/supabase-js').then(({ createClient }) => {
    // Nothing here signs in, so there's no session to keep or refresh.
    client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    return client
  })
  return loading
}

/** The client once it has loaded — enough for cleanup, which can only run after a channel exists. */
export const loadedClient = (): SupabaseClient | null => client
