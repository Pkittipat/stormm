# Stormm process YAML — schema v1

A process is one YAML document, e.g. `checkout.yaml` (the file name is the process ID).
It holds business meaning only — no positions, no layout file.

## Example

```yaml
schemaVersion: 1
id: checkout
name: Checkout

blocks:
  - id: cart
    kind: readmodel
    title: Cart
    fields:
      - { name: cartId, type: string }
      - { name: items, type: "CartItem[]" }
  - id: place-order
    kind: command
    title: Place order
    actor: Customer
    hotspots:
      - What if the cart is empty?
    fields:
      - { name: cartId, type: string }
      - { name: shippingAddress, type: Address }
  - id: order
    kind: aggregate
    title: Order
    invariants:
      - An order needs at least one item
  - { id: order-placed, kind: event, title: Order placed }
  - { id: ship-when-placed, kind: policy, title: Ship when order placed }
  - { id: ship-order, kind: command, title: Ship order, actor: Warehouse }
  - { id: shipment, kind: aggregate, title: Shipment }
  - { id: order-shipped, kind: event, title: Order shipped }

connections:
  - { from: cart, to: place-order }
  - { from: place-order, to: order }
  - { from: order, to: order-placed }
  - { from: order-placed, to: ship-when-placed }
  - { from: ship-when-placed, to: ship-order }
  - { from: ship-order, to: shipment }
  - { from: shipment, to: order-shipped }
```

## Keys

**Process (top level)**

| Key | Required | Meaning |
|---|---|---|
| `schemaVersion` | yes | Always `1` for this version. |
| `id` | yes | Process slug; matches the file name. Frozen after creation. |
| `name` | yes | Display name; free to rename. |
| `blocks` | yes | Every block on the canvas. |
| `connections` | no | Directed links between blocks, one per line. |

**Block**

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | Slug of the title at creation, then frozen. Unique in the file (collision → `order-2`). |
| `kind` | yes | `readmodel` \| `command` \| `aggregate` \| `system` \| `event` \| `policy` (`system` is an external system) |
| `title` | yes | Business name on the card. |
| `actor` | no | Who performs it, e.g. `Customer`. |
| `invariants` | no | Aggregates only: rules the aggregate always protects, list of strings in plain words, e.g. `A job can only be published once`. |
| `hotspots` | no | Open questions, list of strings. |
| `fields` | no | List of `{ name, type }`; `type` is free text. |

Optional keys are omitted when empty.

An invariant is a decided rule; a hotspot is an open question. When a hotspot is answered with a rule, it moves to `invariants`.

**Connection**: `{ from: <block id>, to: <block id> }`. No other keys in v1.

## Rules

- **Stable IDs.** Renaming changes `title`/`name`, never `id`. Diffs are computed by ID.
  One exception: a block added in the current editing session keeps its ID in step with its title, so a block added as "New policy" and named "Reserve stock" becomes `reserve-stock`. Once the page reloads, the ID is frozen.
- **Canonical output.** Fixed key order and formatting; the same model always serializes to the same bytes.
- **Stable order.** Blocks and connections keep their order; new items are appended.
- **Repeat a concept when that reads better.** A second `Order` aggregate (`order-2`) can keep two chains apart instead of joining them through one shared block.

## Storage and saving

Processes live in the browser's `localStorage`; there is no server.

- `stormm:process:<id>` → the process YAML, canonical form. The key's ID is the process ID.
- `stormm:processes` → `[{ "id": "checkout", "projectId": null }]`, the list in creation order; `projectId` files the process under a project (`null` = No project).
- `stormm:projects` → `[{ "id": "shop", "name": "Shop" }]`.

- **Whole-file saves.** Every edit writes the whole YAML back at once. Last write wins; two tabs editing the same process overwrite each other.
- **Canonical in storage.** The YAML is always written in canonical form.
- **Errors don't block saving.** Validation errors and warnings show in the YAML panel; the file is saved either way.
- **ID mismatch is an error.** A stored YAML whose `id` doesn't match its key is reported as an error.
- **New processes** start with no blocks.
- **Hand-broken YAML** still appears in the list and shows its parse errors when opened.
- **Nothing leaves the browser.** Download the YAML to keep or share a process; clearing site data deletes it.

## Layout (derived, never stored)

- **Groups.** Blocks connected to each other, directly or through other blocks, form a group. Each group gets its own band of rows, stacked top to bottom in the order its first block appears in the file.
- **Columns.** Within a group, a block's column is its longest path from the group's start blocks. Back edges (e.g. `policy → command` loops) are ignored for ranking.
- **Rows.** The first column follows file order. Each later column is ordered by the average row of each block's predecessors, so a block sits beside what leads into it and branches don't cross; ties (and blocks with no predecessor) follow file order.
- **Unconnected blocks** share one last row, left to right in file order.

### Dragged positions (per browser)

Dragging is a personal view preference. It is kept in `localStorage` separately from the process, never in the YAML.

- Key: `stormm:layout:<process id>` → `{ "<block id>": { "x": 0, "y": 0 } }` (absolute canvas coordinates).
- On load, a block uses its saved position if one exists; otherwise its derived position.
- Keyed by block ID, so a dragged block keeps its place across renames. Positions for block IDs no longer in the file are dropped.
- New blocks always appear at their derived position, even if dragged blocks now sit nearby.
- **Reset layout** clears the process's saved positions and returns every block to its derived position.
- If `localStorage` is unavailable (private window, cleared data), the derived layout is used; nothing breaks.

## Validation

| Rule | Level |
|---|---|
| `schemaVersion` is known | error |
| IDs are valid slugs and block IDs are unique | error |
| `kind` is one of the six kinds | error |
| An invariant is empty | error |
| Invariants on a block that isn't an aggregate | warning |
| Connection ends exist | error |
| Duplicate connection, or a block connected to itself | error |
| Grammar: `readmodel → command → aggregate → event → policy → command`, plus `event → readmodel`; an external system can stand in for the aggregate: `command → system → event` | warning |
| Block with no connections | warning |

## Versioning

Readers migrate older versions forward; the writer only writes the current version.
Adding an optional key (e.g. a connection `note`) does not bump `schemaVersion`; removing or changing the meaning of a key does.
