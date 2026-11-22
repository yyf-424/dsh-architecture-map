# src

Host implementation (plain ESM) and the hand-written client bundle.

## Host

- `host/plugin.js` — entry: `arch_*` tools, `/arch` command, Mermaid static routes, bundled skill registration.
- `host/projects.js` — `.archmap/index.json` project registry: local and remote entries, validation, atomic writes.
- `host/workspace.js` — resolves a local path or `remote:<id>` into `workspaceRoot` + per-project `stateDir`.
- `host/content/index.js` — read-only content contract shared by local and future remote sources.
- `host/content/local.js` — local content source: scan, anchor hashes, describe, bounded reads.
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
