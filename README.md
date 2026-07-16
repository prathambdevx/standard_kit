# standard_kit

A personal collection of reusable, drop-in kits for new projects. Each top-level folder is a
self-contained kit you can copy into a project and run.

## Kits

### `fluid-setup/` — fluid (`fl-*`) responsive scaling system

A one-time installer for a complete fluid-scaling system on Tailwind v4. Author any size/spacing/font
as two design numbers — `fl-text-[14,16]`, `fl-p-[16,24]`, `fl-gap-[8,12]` — and it glides smoothly
from a 360px design width to a 1440px one, then damps to a ×1.167 ceiling at 1920 and freezes. No
breakpoint jumps.

**Use it:**
1. Copy `fluid-setup/` into a project's `.claude/skills/`.
2. Tell Claude **"set up fluid"** (or run `/fluid-setup`) — it installs the plugin, math module,
   validator, `cn.ts` wiring, globals foundation, commit gate, and the `fluidize` conversion skill.
3. Then say **"fluidize &lt;page/component&gt;"** to convert existing UI, or author new UI with `fl-*`.

See `fluid-setup/README.md` for details, and open `fluid-setup/assets/docs/fluid-scaling.html` in a
browser for an interactive demo of the model.

---

_More standard kits to come._
