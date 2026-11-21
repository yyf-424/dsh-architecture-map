# src

Host implementation (plain ESM) and the hand-written client bundle.

## Host

- `host/plugin.js` — entry: `arch_*` tools, `/arch` command, Mermaid static routes, bundled skill registration.
- `host/graph.js` — graph schema/validation, store, rev, atomic writes, backup, anchor hashes.
- `host/memory.js` — manifest, incremental sync, cosmetic signatures, stale marking, dossier docs.
- `host/export.js` — deterministic Mermaid/SVG/Markdown exports.
- `host/signature.js` — shared sha256 + normalized code signature.

## Client

The client is the package-root `client.js` (hand-written, no build step):

- right-sidebar panel and layered SVG canvas,
- node dragging and local positions,
- discussion buttons and the `subagentchat` resource,
- the `mermaid` chat fence renderer.

The local `docs/PLAN.md` / `docs/DESIGN.md` are design notes and are intentionally not shipped.
