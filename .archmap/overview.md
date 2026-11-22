# Architecture map — self architecture

This repository is both the plugin and its first fixture. The graph is intentionally small: one node per independently discussable responsibility.

## Layers

- **Host** — entry, project index/workspace resolver, graph store, memory store, exporter.
- **Client** — sidebar panel, canvas and Mermaid fence.
- **Docs & skill** — the bundled `architecture-map` workflow.

## Flow

1. The Host entry registers tools and the /arch command, and serves the vendored Mermaid runtime.
2. The project index resolves a local path or `remote:<id>` into a workspace root and a per-project state directory; the graph store owns `<stateDir>/graph.json`, memory reads it and writes stale status, and the exporter reads it for Mermaid/SVG/Markdown.
3. The sidebar panel polls the graph for the session workspace and delegates rendering to the canvas; the Host `/arch` command opens its tab (command → `command/executed` → `sidebarRight.openTab`).
4. The skill guides the sync → read → patch → dossier → commit loop.

## Caveats

- The panel follows the session workspace; open a session whose workspace is this repository to see this graph.
- Node positions are browser-local.
- Mermaid is vendored; `renderMermaid:auto` disables it when `dsh-mermaid-plus` is enabled.
- Remote projects are in development; only the project index and workspace resolver exist so far.
