# stormm

pnpm monorepo: a React canvas for Event Storming business processes, where each process is a YAML file.

Everything runs in the browser. There is no server of ours: processes and projects are kept in the browser's `localStorage`. The one thing that reaches the network is an optional **live session**, where a few people model one process together — that rides on Supabase Realtime and stores nothing (see below); leave it unconfigured and the app is entirely offline.

## Stack

- **apps/web** — React + Vite + TypeScript + Tailwind CSS v4
- **packages/process-model** — the process YAML v1 format: types, canonical writer, parser, validator, diff, derived layout and board edits ([spec](docs/process-yaml-v1.md))
- **packages/codegen** — R&D: process model → Go domain code (not used by the app)
- **packages/cli** — `stormm check` / `stormm changes` (plus `explain`, a reading aid for people): helpers for a process YAML; bundled into the plugin by `pnpm --filter @stormm/cli build`
- **plugins/stormm** — Claude Code plugin with the `storm-to-code` skill: process modeling coding: the storm is the domain design (model, interface, usage), and each project's own code decides how it's built ([README](plugins/stormm/README.md)). This repo is its marketplace: `/plugin marketplace add <this repo>` then `/plugin install stormm@stormm`

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable && corepack prepare pnpm@latest --activate`)

## Setup

```bash
pnpm install
pnpm dev:web   # http://localhost:5173
```

Live sessions are off until the app knows which Supabase project to meet on. To switch them on, copy `apps/web/.env.example` to `apps/web/.env` and fill in the two values from your project's **Settings → API**:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=…
```

Nothing else is needed — no tables, no policies, no sign-in. Both values are public by design: they ship in the bundle, and a public Realtime channel asks for nothing more. Without them the **Live** button simply doesn't appear.

## Where processes live

In this browser's `localStorage`:

```
stormm:processes     → [{ id, projectId }]   # the list, in creation order
stormm:process:<id>  → the process YAML       # canonical form; the only record of the process
stormm:projects      → [{ id, name }]
stormm:layout:<id>   → dragged block positions (a view preference, never in the YAML)
```

Every edit writes the whole YAML back straight away. Nothing leaves the browser — use **YAML → Download** to keep or share a process. Clearing site data deletes everything.

## What works

- **Processes** — create, rename (click the header title), delete, move between projects; each opens at `#/p/<id>`.
- **Canvas** — add blocks from the composer's `+` (connected from the selected block), drag from a block's right port onto another block to connect, click a connector to select it, Delete/Backspace to remove the selection. Drag on empty canvas to select the blocks inside a box (Shift adds), Shift-click to add or remove one, ⌘/Ctrl-A to select all; dragging a selected block moves the whole selection. ⌘/Ctrl-C copies the selected blocks and the connections between them as storm YAML; ⌘/Ctrl-V pastes them (into any process) with fresh ids. Scroll, Space-drag or middle-drag to pan; ⌘/Ctrl-scroll or the zoom control to zoom.
- **Layout** — positions are derived from the YAML (columns follow the connections; each connected group gets its own rows). Dragging a block is a personal view preference kept in localStorage next to the process; **Reset layout** clears it.
- **Inspector** — edit a block's title, actor, hotspots and fields; see what it connects from/to.
- **YAML** — the exact file as stored, its validation errors and warnings, copy and download.
- **Live sessions** — **Live → Start a session** shares the open process under a six-character key; anyone who types it into **Live → Join** edits it with you. Everyone works on one board — blocks, wires, titles and the arrangement — while each keeps their own pan, zoom and selection, so two people can work on different corners at once. You see each other's pointers on the canvas, each with its owner's name and color, placed in the board's own coordinates so a cursor sits over the same block for everyone however they've panned or zoomed.

  Edits merge part by part, by who touched each thing last: two people editing different blocks keep both edits, two people editing the same one settle on the later, and everybody lands on the same board without anyone being in charge (see `packages/process-model/src/merge.ts`). Even two people adding a block at the same instant — which derives the same id from the same default title — end up with both blocks.

  Only the host keeps the result: it's their process, saving to their browser as the session runs. Everyone else is offered a copy when the session ends, filed under a free id so nothing of theirs is overwritten. Nothing is stored anywhere else: the key is the whole invitation, the session ends when the host closes the tab, and anyone holding the key can edit — so share it like a meeting link.

## Other scripts

- `pnpm build` — build all apps
- `pnpm lint` — lint all apps
- `pnpm --filter @stormm/process-model test` — format tests
