# Node and edge discussions

`arch_discuss` starts a managed child session for one graph target. The child runs in parallel; the parent conversation stays clean.

## Choose a mode

- **fork** — the child is seeded with the parent's completed turns. Use it when the answer depends on decisions already made in the main conversation. Costs more and has a larger context.
- **lite** — the child starts fresh with the graph and dossier. Use it for narrow code questions where the graph is enough; it cannot recall main-conversation facts.

Targets: `node:<id>` or `edge:<id>`. The child name is `node-<id>` (fork) or `node-<id>-lite` (lite); an existing child with the same name is reused instead of duplicated.

## Parent call

```json
{
  "workspace": "/abs/project",
  "target": "node:n3",
  "mode": "fork",
  "question": "What does this node own and what would break if it changed?"
}
```

The tool returns immediately with the child name/id and a sidebar address. Do not wait for the child in the same turn; the user can open it from the subagent catalog, or the sidebar buttons open it directly.

The sidebar `Discuss (fork)` / `Lite` buttons call the same Host operation (`/arch discuss ...`) and open the mounted `subagentchat` resource.

## Child rules (already in the prompt)

- The Host denies shell and generic source-write tools at execution; `arch_graph_patch` / `arch_doc_put` remain available. A fork may still display the inherited tool schemas, so the model should treat bash/write/edit as unavailable and rely on an actual call error.

- stay on the target node/edge and its direct edges;
- read the graph and `modules/<id>` first;
- do not edit source code;
- graph edits go through `arch_graph_patch` with the latest `rev`, preferably `apply:false` until the user approves;
- do not message the parent;
- write conclusions to `notes/<id>` with `arch_doc_put` (`mode:"append"`);
- if an anchor looks stale, run `arch_sync` and say so.

## Conclusion format

1. **Conclusion** — one paragraph.
2. **Evidence** — anchor paths/symbols and the files inspected.
3. **Impact** — upstream/downstream nodes and edges.
4. **Open questions** — only what genuinely needs the user.

A dry-run proposal is better than a silent graph write. Example:

```
proposed summary: ...
proposed edge: n3 -> n4 (next)
apply:false result: validated 2 ops; no write (rev stays 6)
```

## Merging back

The child writes notes and may propose patches; the parent (or the user) decides whether to apply. Never let two discussions apply conflicting patches blindly:

- read the current `rev` before applying;
- apply one batch at a time;
- on `STALE_REV`, re-read and rebase;
- after a review, set affected nodes to `fresh` and commit analyzed files.

## Notes, not chat logs

`notes/<id>` is for durable decisions/findings, not a transcript. Append a short conclusion with anchor evidence. Do not copy the whole child conversation into the dossier.

The dossier is architecture memory, **not** a general conversation-memory store.
