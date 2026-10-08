/**
 * Build-time configuration, read through `import.meta.env`. Everything here ships in the
 * bundle — only ever public values. Both of these are optional: without them the app keeps
 * working exactly as it does offline, with live sessions switched off (see live/client.ts).
 */
interface ImportMetaEnv {
  /** The Supabase project that carries live sessions, e.g. `https://xxxx.supabase.co`. */
  readonly VITE_SUPABASE_URL?: string
  /** That project's anon (publishable) key — public by design. */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
