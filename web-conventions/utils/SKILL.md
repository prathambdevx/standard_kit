---
name: utils
description: Decide where a non-component helper belongs in apps/web — utils/ (standalone pure functions) vs lib/ (cross-cutting libraries, integration wrappers, cross-cutting stores) vs a module vs hooks/services. Use when adding a formatter, parser, store, SDK wrapper, or any "where does this go" call.
user-invocable: false
---
# Helpers: utils/ vs lib/ vs module vs elsewhere

BSC has no single "utils layer". Non-component logic splits by *kind*, not by being "a helper":

- **`src/utils/`** — **standalone pure functions.** Input → output, no app wiring, no third-party client, no React, no global state. Flat files: `src/utils/<snake_name>.ts`.
- **`src/lib/`** — **cross-cutting libraries + integration wrappers + cross-cutting Zustand stores.** Anything that holds a configured instance, wires a third-party/SDK, or owns state shared across ≥2 modules. May contain submodules (`lib/consent/`). Path: `src/lib/<snake_name>.ts`.

Source of truth: `.claude/rules/folder_structure.md` (Generic helpers row + Framework scaffolding table) and `apps/web/CLAUDE.md` (Folder structure). Read those first if a case is ambiguous.

## Before `utils/`: is this shaping backend data? Then it belongs on the BFF.

**`utils/` is for client-presentation transforms only.** If a helper *normalises a value the BFF returns* so it displays consistently — unit conversion (cm→ft), currency/precision normalisation, status-label mapping, date canonicalisation of an upstream field — it belongs in the **BFF response mapper** (`apps/bff/src/services/**`), not in `apps/web`.

Why: web and mobile are separate clients of the same BFF. Shaping on the client means **every client reimplements it**, and a later consistency tweak forces a **mobile app-store release** to match web. Shape once on the BFF; both clients render the field as-is.

| Transform | Home |
|---|---|
| Convert/normalise a field the BFF sends, for display consistency across clients | **BFF mapper** (`apps/bff/src/services/<vendor>/*.ts`) — annotate the unit/format on the shared type in `packages/types` |
| Format a value that is purely a web-UI concern (DOM/layout/interaction, never sent to mobile) | **`utils/`** |

Litmus test: *"If mobile showed this differently, would that be a bug?"* → **yes** = BFF. (Reference: `formatHeight` in `apps/bff/src/services/bombayshirts/order-status.ts` converts Enigma's cm height to feet'inches for every client.)


## The decision

| Your helper… | Goes in | BSC example |
|---|---|---|
| is a pure transform (format/parse/strip/hash), imports only `types/` + other pure files | **`utils/`** | `utils/helpers.ts` (`formatInr`, `stripGid`), `utils/format.ts` (`formatRating`), `utils/html.ts` (`stripTags`), `utils/parse_mixed_text.ts`, `utils/filter_hash.ts`, `utils/plp_columns.ts`, `utils/bot.ts` |
| wraps a third-party lib / holds a configured instance | **`lib/`** | `lib/cn.ts` (clsx+twMerge), `lib/fonts.ts` (next/font), `lib/server_sdk.ts` + `lib/commerce.ts` (BSC SDK instances) |
| is a Zustand store used across ≥2 modules + shared components | **`lib/`** | `lib/drawers.ts`, `lib/commerce.ts`, `lib/pincode.ts` |
| is a Zustand store used by **one** module only | **that module** | `modules/account/address/hooks/useAddressDialogs.ts` |
| is a small action that touches stores/SDK (not pure) | **`lib/`** | `lib/add_to_bag.ts` (calls `commerce.cart` + ui store) |
| fetches from the BFF | **`services/bff/<domain>.ts`** | server-only; never `utils/` |
| uses a React API (`useState`, `useEffect`, hooks) | **`hooks/`** (shared) or the module's `hooks/` | `hooks/useApiQuery` |
| maps a BFF response → UI shape for one page | **that module's `mappers.ts`** | `modules/pdp/mappers.ts` |

**One-line test for `utils/`:** if the function imports anything from `lib/`, `services/`, `hooks/`, a store, or a third-party package (other than tiny pure deps), it does **not** belong in `utils/`. A `utils/` file's only allowed imports are `types/` and other `utils/` files.

Note: a *pure* function that merely *names* a cookie key and parses its raw string is still `utils/` (`plp_columns.ts` exports `PLP_COLUMNS_COOKIE` + `parsePlpColumns`). Reading/writing the cookie at runtime is the consumer's job. BSC does **not** keep generic localStorage/cookie/device wrappers — `commerce` storage is injected (`lib/commerce.ts`) and persistence rides on Zustand `persist` (`lib/pincode.ts`).

## utils/ rules

- **Pure only.** No `fetch`, no SDK call, no store access, no React. Return a value.
- **Named exports**, arrow or `function` both fine (match the file). No default exports.
- `import type` for type-only imports. **No `any`** — type every param; `unknown` at boundaries.
- **Colocate the type** when it's used only by that file; promote to `src/types/common/` only when shared (`parse_mixed_text.ts` imports `TextPart` from there).
- **One domain per file.** A genuinely new domain with ≥2 functions → its own snake_case file (`format.ts`, `html.ts`). A one-off miscellaneous pure function → `helpers.ts`. Don't spawn a file per function.
- **No SSR guard ritual.** A pure function doesn't touch `window`; if it would, it isn't pure, so it isn't a `util` — move it.
- **BSC domain facts live in comments.** Prices arrive in rupees not paise (`formatInr` — no `/100`); Shopify GID shape (`stripGid`). Carry the *why* in a one-line comment per `.claude/rules/comments-web.md`.

## lib/ rules

- A `lib/` file may import third-party packages, `config/env`, other `lib/` files, and `types/`. It must **not** import from `modules/` or `app/` (dependency-cruiser: shared layer can't reach up).
- Cross-cutting stores live here precisely so shared `components/` can read them without a depcruise violation — that's the reason `drawers`/`commerce` are in `lib/`, not `modules/`.
- Server-only instances get `import 'server-only'` (`lib/server_sdk.ts`); browser-facing, session-aware instances live separately (`lib/commerce.ts`).

## Adding a helper — flow

1. **Pure transform, only `types/`/`utils/` deps?** → `src/utils/`. Fits an existing domain file? add there. New domain (≥2 fns)? new `<snake_name>.ts`. One-off? `helpers.ts`.
2. **Wraps a lib / holds an instance / cross-cutting store / impure action?** → `src/lib/<snake_name>.ts`.
3. **Single-module store or state?** → that module (`modules/<feature>/...`).
4. **Fetches, uses React, or maps one page's BFF data?** → `services/bff/`, `hooks/`, or the module's `mappers.ts` respectively — never `utils/`.

## Checklist (utils/)
- [ ] Pure — no `fetch`/SDK/store/React; returns a value
- [ ] Imports only `types/` + other `utils/` files
- [ ] Named export; `import type`; no `any`
- [ ] Lives in the right domain file (or `helpers.ts` if one-off) — not a new file per function
- [ ] Type colocated unless shared (then `types/common/`)
- [ ] BSC "why" captured in a comment where non-obvious
