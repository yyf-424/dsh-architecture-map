# Bootstrap: first architecture pass

Goal: produce a useful graph and dossier in one pass, without reading the whole repository or dumping every file.

## Deliverables

1. A graph with **8–20 nodes** for a medium project (more only when the project is genuinely large; group by layer/subsystem).
2. At least one anchor per code node, or an explicit "conceptual" note.
3. An `overview` document and one `modules/<id>` document per node.
4. A committed manifest for the files actually read.
5. A short list of uncertain/conceptual edges for the user.

## Loop

### 1. Inventory

```
arch_sync({ full: true })
```

`full:true` ignores the manifest and lists every scannable file. It does **not** write the manifest. Ignore binaries, generated files and vendored directories (the tool already skips common ones).

If the workspace has a graph already, call `arch_graph_get` and decide whether this is a fresh build or an extension.

### 2. Choose the skeleton

Do not start from files. Start from responsibilities:

- entry / request dispatch
- transport or API boundary
- domain services
- persistence / stores
- UI surfaces
- external integrations

Use `groups` for layers/subsystems. Keep ids short and stable (`n1`, `n2`, …); they are references, not display names.

### 3. Read selectively

Read in this order, stopping when the skeleton is clear:

1. entry points and route tables
2. stores / data models
3. the modules with the most inbound/outbound edges
4. README / design docs for intent

Do not read every file in a large directory. The goal is a correct skeleton, not exhaustive coverage. Mark uncertain nodes/edges instead of guessing silently.

### 4. Add nodes, then edges

Use batches of roughly 10–20 operations. For a non-trivial first batch, use `apply:false` and review the diff:

```json
{
  "workspace": "/abs/project",
  "baseRev": 0,
  "apply": false,
  "ops": [
    { "op": "add_node", "node": { "id": "n1", "title": "Entry", "kind": "entry", "anchors": [{ "path": "src/index.ts", "symbol": "main" }] } },
    { "op": "add_node", "node": { "id": "n2", "title": "Store", "kind": "store" } },
    { "op": "add_edge", "edge": { "id": "e1", "from": "n1", "to": "n2", "label": "writes", "kind": "call" } }
  ]
}
```

Then apply with the current `rev`.

### 5. Write the dossier

Use `arch_doc_put`:

- `overview` — purpose, layout, groups, key edges, caveats.
- `modules/<id>` — anchor, content/responsibility, relations, uncertainty.
- `notes/<id>` — only when a decision/finding needs a durable note.

Keep each document concise; link to anchors rather than pasting whole files.

### 6. Commit what you read

```
arch_manifest_commit({ paths: ["src/index.ts", "src/store.ts", ...] })
```

Commit only files you actually inspected. Then run incremental `arch_sync` and expect `0 added / 0 changed / 0 deleted`. If not, commit the missing analyzed files or fix the manifest.

## Quality checks

- Can a reader answer "what are the main responsibilities and how do they flow?" from the graph alone?
- Does every edge have a direction and a reason, or is it generic noise?
- Are uncertain areas labeled as uncertain?
- Is there one node per independently discussable responsibility, not one per file?
- Did you avoid turning the dossier into a general memory store?

## Common mistakes

- Starting from a full directory dump and creating 100 nodes.
- Using one node per file; files are implementation detail, responsibilities are the unit.
- Adding edges because two modules are "related"; prefer observed calls/data/dependencies.
- Committing a file you only skimmed.
- Writing a huge `modules/<id>` with the whole file content instead of a summary + anchors.
