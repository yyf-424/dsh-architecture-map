---
name: architecture-map
description: Use when the user asks for an architecture map, module/dependency overview, or to discuss a module; also to maintain .archmap/graph.json and its dossier.
---

# Architecture map

Maintain one canonical graph at `.archmap/graph.json` plus a dossier under `.archmap/`. The sidebar renders it; each node can open an isolated side conversation. Do not rebuild the graph every turn.

## Hard rules

1. **Sync before analysis.** Call `arch_sync` first. Use `full:true` only when there is no manifest or the user asks for a full pass; otherwise use incremental sync.
2. **Read before patch.** Call `arch_graph_get` and pass its `rev` as `baseRev`. Batch changes; use `apply:false` first for non-trivial edits.
3. **Only read what changed.** The sync result names the changed files and affected nodes. Do not re-read the whole repository for one change.
4. **Stable ids.** Keep node/edge ids stable; never renumber the graph.
5. **Anchors are evidence.** Every code node needs at least one `path#symbol` anchor. A conceptual node is allowed only if you say it is conceptual. After a review, refresh stale anchor hashes with `refreshAnchors:true`.
6. **Write only the map.** Graph/dossier writes go through `arch_graph_patch`, `arch_doc_put` and `arch_manifest_commit`. Do not edit source code as part of mapping.
7. **Commit after analysis.** `arch_manifest_commit` records files you actually read; never commit files you did not inspect.
8. **No general memory.** The dossier is only for this graph: overview, modules and node notes. Do not turn it into a conversation-summary store.

## First pass (bootstrap)

1. `arch_sync({ full: true })` to inventory the workspace.
2. `arch_graph_get` to see the existing graph (possibly empty).
3. Plan **8–20 responsibility nodes** for a medium project; group large systems by layer/subsystem.
4. Read representative files: entry points, routes, stores, clients, key services. Skip generated, binary, vendored and ignored files.
5. Add nodes, then edges, in batches; prefer `apply:false` for the first batch.
6. Write `overview` and `modules/<id>` with `arch_doc_put`.
7. Commit analyzed files with `arch_manifest_commit`.
8. Tell the user which nodes/edges are **conceptual or uncertain**.

See `references/bootstrap.md`.

## Incremental pass

1. `arch_sync` (no `full`); read `changed (code)`, `changed (format/comment-only)`, `deleted`, `affected nodes`.
2. For real code changes, call `arch_sync` again with `markStale:true`, or patch affected nodes to `status:"stale"`.
3. Read only changed files and affected nodes.
4. Update node summary/anchors/edges and the module doc; append a note for a significant finding.
5. `arch_manifest_commit` the changed files.
6. Set the node back to `status:"fresh"` only after graph and dossier match the code.

Cosmetic changes update the manifest but do not require stale marking. See `references/incremental.md`.

## Discussions

Use `arch_discuss` for a node/edge:

- `fork` — inherits the main conversation's completed turns; use when the decision depends on conversation context.
- `lite` — starts fresh from the graph/dossier; cheaper; use for narrow code questions.

The child stays on its target, prefers `apply:false`, writes conclusions to `notes/<id>`, and does not message the parent. The sidebar `Discuss (fork)` / `Lite` buttons are the same operation. See `references/discussion.md`.

## Graph quality

- **Node**: one independently discussable responsibility, not one file. A file can feed several nodes; one node can span files.
- **Edge kinds**: `call`, `data`, `dependency`, `next`, `contains`. Avoid "everything talks to the database" noise.
- **Status**: `fresh` (verified), `stale` (anchor changed; needs review), `proposed` (not applied).
- **Groups**: layers/subsystems, not every folder.

## References

- `references/schema.md` — graph/dossier schema, ids, anchors, patch operations and errors.
- `references/bootstrap.md` — first full analysis and batching.
- `references/incremental.md` — sync, stale, review and commit loop.
- `references/discussion.md` — fork/lite, child rules, conclusions and graph edits.
