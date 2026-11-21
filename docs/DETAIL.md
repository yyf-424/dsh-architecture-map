# Architecture map

![Architecture map panel](preview.svg)

A live, addressable architecture graph for DeepSeek Harness. The model writes nodes, edges and anchors into one canonical file; the right sidebar renders it; every node can open an isolated discussion with inherited conversation memory.

## What you get

- **Canonical graph** — `.archmap/graph.json` with a revision, schema validation, atomic writes and a one-step backup.
- **Right-sidebar canvas** — layered SVG layout, pan/zoom/Fit, node dragging, reset layout and node details.
- **Architecture memory** — a manifest of analyzed files, incremental `arch_sync`, code-vs-cosmetic detection, stale marking and a Markdown dossier (`overview`, `modules/<id>`, `notes/<id>`).
- **Per-node discussions** — `arch_discuss` starts a fork (inherits completed turns) or lite (fresh from graph/dossier) child; the sidebar opens it; conclusions go to `notes/<id>`.
- **Exports** — deterministic Mermaid, SVG and Markdown files under `.archmap/export/`.
- **Built-in Mermaid** — assistant ` ```mermaid ` fences render with a vendored runtime served by the plugin; no CDN and no extra Mermaid plugin.
- **Bundled skill** — `architecture-map` explains the sync → read → patch → dossier → commit loop.

## Tools

| Tool | Purpose |
| --- | --- |
| `arch_hello` | Diagnostic activation check |
| `arch_graph_get` / `arch_graph_patch` | Read and batch-edit the graph (`apply:false` previews) |
| `arch_sync` | Full or incremental workspace comparison (`markStale` optional) |
| `arch_manifest_commit` | Record analyzed files in the manifest |
| `arch_doc_get` / `arch_doc_put` | Read/write the dossier |
| `arch_discuss` | Start a node/edge fork or lite discussion |
| `arch_export` | Write Mermaid/SVG/Markdown exports |

## Install and enable

Install the bundle in a DSH profile and enable the `architecture-map` row. The right sidebar gets an **Architecture map** tab. `/arch` opens it; the node detail has `Discuss (fork)` / `Lite`.

The model can also use the bundled `architecture-map` skill in a new session.

## Configuration

```yaml
- id: architecture-map
  name: dsh-architecture-map
  config:
    renderMermaid: auto
```

`renderMermaid: auto|on|off` controls the built-in renderer. `auto` disables it when the known conflicting `dsh-mermaid-plus` plugin is enabled; `off` also keeps fences as code blocks and does not load the 5.2 MB runtime.

## Data and permissions

- Reads/writes only under `<workspace>/.archmap/` (plus the browser's local position preference).
- No telemetry and no external network requests; Mermaid is served from the plugin's own Host route.
- Graph/dossier writes are bounded and atomic; source files are never edited by `arch_graph_patch` or `arch_doc_put`.
- Discussion children are prompt-constrained; shell and generic source-write calls are denied at execution (a fork may still display inherited tool schemas).
- Mermaid uses `securityLevel: 'strict'`.

## Known limitations

- The canvas is a hand-written SVG implementation, not React Flow.
- Node positions are local to the browser; shared positions are not implemented yet.
- The sidebar follows the **session workspace**; it does not show a graph from an explicit `workspace` argument when the two differ.
- Fork discussions inherit the parent request prefix, so their tool list can still show schemas that are denied at execution.
- If the parent agent uses `send_message` to continue a child, DSH posts a native settlement notice (with the child's closing text) in the parent conversation. The initial `arch_discuss` result is caller-only; the child transcript is not copied into the main log.
- Mermaid layout is Mermaid's default (dagre); a layout selector is not exposed.

## Third-party

- Mermaid 12.2.0 (MIT) and ELK/elkjs 0.9.3 (EPL-2.0), vendored in `vendor/`.
- Static-route/renderer approach adapted from `dsh-mermaid-plus` 0.6.2 (MIT).
- See `THIRD_PARTY_NOTICES.md` and `vendor/*.LICENSE`.

## Status

Pre-alpha working skeleton. `npm test` covers graph, memory, stale-hash and export behavior; CI runs syntax checks, tests and `npm pack --dry-run`.
