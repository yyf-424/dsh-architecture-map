# Incremental sync and stale review

The manifest records what has been analyzed. Incremental sync is the normal path; a full sync is only for the first pass or an explicit rebuild.

## Read the sync result

`arch_sync` (no `full`) reports:

- `added` — new files; no previous manifest entry.
- `changed (code)` — content signature changed; may invalidate nodes/edges.
- `changed (format/comment-only)` — hash changed but normalized code signature is identical; usually no graph impact.
- `deleted` — files in the manifest that are gone.
- `affected nodes` — nodes whose anchors point at added/changed-code/deleted files.
- `markStale` (optional) — `true` writes `status:"stale"` to affected nodes and increments the graph rev.

`full:true` lists every file as added and ignores `markStale`; never use it for an incremental review.

## Review loop

1. **Sync**
   ```
   arch_sync({ workspace })
   ```
2. **Mark affected nodes stale** if you are about to review them:
   ```
   arch_sync({ workspace, markStale: true })
   ```
   This writes the graph; skip it if you only want a report.
3. **Read only the changed files** and the affected nodes. Do not re-read the repository.
4. **Update the graph** with the current `rev`:
   - refresh summary/anchors/edges;
   - remove edges that no longer exist;
   - set `status:"stale"` while reviewing, `status:"fresh"` only when done.
   Use `apply:false` for non-trivial edits.
5. **Update the dossier** with `arch_doc_put` (`modules/<id>`, append to `notes/<id>` for a significant finding).
6. **Commit** the files you actually read:
   ```
   arch_manifest_commit({ workspace, paths: [...] })
   ```
7. **Re-sync** and expect 0/0/0. Do not mark fresh while the dossier or graph is still stale.

## Cosmetic changes

If the only change is comment/whitespace, the file is reported as `format/comment-only`:

- it does not affect nodes;
- `markStale:true` does not mark anything;
- commit the file if you reviewed it, to update the manifest signature;
- do not rewrite the graph for cosmetics.

The normalization is heuristic (comments/whitespace for common code extensions). If a string literal contains comment markers, review the actual diff before deciding.

## Deleted and renamed files

- **Deleted**: remove or update the affected node; remove edges that point at it; commit the manifest removal by committing the path (missing files are removed from the manifest).
- **Renamed**: a rename is usually delete + add. Move the anchor to the new path and keep the node id if the responsibility is unchanged; otherwise add a new node and remove the old one.

## Stale status

- `fresh` — the graph and dossier match the code you verified.
- `stale` — an anchored file changed; the node may be outdated.
- `proposed` — a change that is not applied yet.

`markStale:true` only writes code-affected nodes. A node can be stale without a sync (for example, a review found a mismatch); patch it explicitly.

Each anchor may store a sha256 `hash`. Sync also reports a node when its anchor hash differs from the current file, even if the manifest has no pending delta. After reviewing, refresh the hashes with:

```json
{ "refreshAnchors": true, "baseRev": 6, "ops": [{ "op": "update_node", "id": "n3", "patch": { "status": "fresh" } }] }
```

Without `refreshAnchors`, a status-only patch keeps the old hash and the node stays stale.

## Common mistakes

- Running `full:true` on every turn and treating added files as changes.
- Committing a file that was not read.
- Setting `fresh` before updating the module doc.
- Leaving a deleted file's node and edges in the graph.
- Re-reading the whole repo after a one-line change.
