# package.json wiring

Add to the web app's `package.json` `scripts` (the one whose directory contains
`scripts/`, `tailwind-plugins/`, and `src/` — i.e. `<webRoot>`):

```jsonc
{
  "scripts": {
    "check:fluid": "bun scripts/check-fluid.mjs",
    "test:fluid": "bun test scripts/fluid-math.test.mjs scripts/check-fluid.test.mjs scripts/fluid-plugin.test.mjs"
  }
}
```

- `bun run check:fluid` — validate every `fl-*` usage in `src/` + `tailwind-plugins/`
  (glob root resolves from the script's own location, so cwd doesn't matter).
- `bun run test:fluid` — run the math + plugin + validator invariant tests (57 tests).

## Runtime dependencies

The `cn.ts` wiring needs these (Tailwind v4 project — you almost certainly already have them):

```
clsx            ^2.1.1
tailwind-merge  ^2.6.0
```

Install if missing: `bun add clsx tailwind-merge`

Nothing else. The plugin, math module, and validator are pure JS with only Node/Bun built-ins.
