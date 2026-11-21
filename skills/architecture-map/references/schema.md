# Graph and dossier schema

All data lives under `<workspace>/.archmap/`. Do not invent another store.

```
.archmap/
├── graph.json          # canonical graph, schema 1
├── graph.bak.json      # previous revision (written from the second write on)
├── manifest.json       # analyzed-file hashes and normalized signatures
├── overview.md         # dossier entry point
├── modules/<id>.md     # one document per graph node
├── notes/<id>.md       # append-only discussion notes
└── export/             # arch_export output (architecture.mmd/.svg/.md)
```

## graph.json

```json
{
  "schema": 1,
  "rev": 6,
  "updatedAt": "2026-11-20T...",
  "layout": { "mode": "layered", "direction": "LR" },
  "groups": [{ "id": "g-core", "title": "Core" }],
  "nodes": [
    {
      "id": "n1",
      "title": "Entry",
      "kind": "entry",
      "group": "g-core",
      "summary": "User request enters the agent and dispatches tools.",
      "status": "fresh",
      "anchors": [{ "path": "src/host/plugin.js", "symbol": "apply" }]
    }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2", "label": "writes", "kind": "call" }
  ]
}
```

- **id**: lowercase letter, then lowercase letters/digits/`_`/`-`; unique within its kind.
- **kind**: free lower-case text; common values `entry`, `module`, `store`, `client`, `service`, `external`.
- **status**: `fresh`, `stale`, `proposed`.
- **anchor**: workspace-relative POSIX `path`, optional `symbol`, optional `hash`; no `..`, absolute paths, backslashes or empty segments.
- **group**: optional group id; groups have `id` and `title`.
- **edge**: `from`/`to` must be existing node ids; `kind` common values `call`, `data`, `dependency`, `next`, `contains`.
- `layout.mode` is advisory for the client; the current client uses its own grid + local positions.

`rev` increments on every successful write. Pass the latest `rev` as `baseRev`; a mismatch returns `STALE_REV`. `apply:false` validates and returns a diff without writing.

## Patch operations

```
add_node    { node }
update_node { id, patch }
remove_node { id, cascade? }
add_edge    { edge }
update_edge { id, patch }
remove_edge { id }
set_group   { group }
remove_group{ id }
```

Add referenced nodes/groups before edges. Large edits should be batched; the tool bounds operation count and field sizes. Unknown fields are rejected so a typo cannot be silently ignored.

## Dossier

- `arch_doc_get({ id })` / `arch_doc_put({ id, content, mode })`
- Valid ids: `overview`, `modules/<node-id>`, `notes/<node-id>`.
- `mode:"append"` adds a blank line + content; overwrite is the default.
- Documents are capped at **32 KiB** and always end with a newline.
- `modules/<id>` documents the node (content, relations, history); `notes/<id>` records decisions/findings; `overview` is the map-level summary.

## Memory files

`manifest.json` stores `{sha256, size, signature}` per analyzed file. `signature` is a normalized hash that ignores comments/whitespace for code files. Never edit the manifest by hand; use `arch_manifest_commit`.

## Exports

`arch_export` writes deterministic files:

- `format:"mermaid"` → `.archmap/export/architecture.mmd`
- `format:"svg"` → `.archmap/export/architecture.svg`
- `format:"markdown"` → `.archmap/export/architecture.md`

Exports never modify `graph.json` or the manifest.

## Limits and failures

- Paths are realpath-checked and must stay inside the workspace.
- Writes are atomic (temp file + rename); a failed write must be reported, never silently retried.
- The UI polls the graph every 2s; a successful patch becomes visible within ~3s.
- Node positions are a **local view preference** (browser localStorage), not part of `graph.json`.
