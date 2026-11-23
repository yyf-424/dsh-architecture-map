## 0.2.1 — 2026-11-23

### Added

- Remote consent scopes: `/arch remote grant <id> session` grants only the current session (and its discussion children, in memory); `/arch remote grant <id> always` or no scope persists a workspace grant. `/arch remote revoke <id>` clears both. The content-read card keeps the same two choices.

### Fixed

- Local node positions no longer freeze the whole layout when the graph revision changes: only dragged nodes are stored as `{x, y}` overrides, so undragged nodes follow the automatic layout after an edit.
- `Reset layout` clears the local overrides instead of materializing the current layout into the position map.
- The sidebar's Discuss/Lite buttons now pass the selected source to `/arch discuss`: a node in a remote source is resolved in `remote:<id>` instead of the session's local workspace, which previously produced `node "<id>" does not exist in <cwd>`.

### Docs

- State that a cyclic graph falls back to a compact grid and that the layered layout is for acyclic graphs.

## 0.2.0 — 2026-11-22

### Added

- Read-only remote Linux repositories over SSH: `.archmap/index.json` projects, `remote:<id>` workspaces, a project source picker and a remote status line.
- `arch_remote_list/status/tree/read/grep` tools, a blocking consent card (session / always / reject), and durable workspace consent.
- `/arch remote add/list/select/sync/update/grant/revoke/remove` commands.
- Fingerprint polling, `remote-state.json`, manifest-only incremental sync, stale marking and maintenance handoff.
- Non-git metadata fingerprints, root-containment checks for escapes/symlink escapes, and a read-only remote smoke script.

### Fixed

- `readRange` no longer treats SSH connection diagnostics as the file size.
- Repeated edits to an already-dirty git file now move the fingerprint.

### Developer preview notes

- A maintenance run does not clear the local `remote-state.pending` counter yet.
- Auto maintenance does not start from an idle parent session; `/arch remote update <id>` is the manual fallback.
- 65 tests pass; real SSH/host/tool/consent flows were verified on a non-production Linux host.

## 0.1.0 — 2026-11-21

- Canonical `.archmap/graph.json` with revision, validation, atomic writes and backup.
- Sidebar SVG canvas with layered layout, pan/zoom/Fit, node dragging and local position memory.
- Architecture memory: manifest, incremental `arch_sync`, cosmetic detection, anchor-hash stale marking, dossier documents.
- Per-node `arch_discuss` fork/lite conversations, sidebar buttons and notes.
- Deterministic `arch_export` to Mermaid, SVG and Markdown.
- Built-in Mermaid fence rendering with a vendored runtime and `auto/on/off` configuration.
- Bundled `architecture-map` skill and localized panel strings.
- `node --test` suite and GitHub Actions CI.
