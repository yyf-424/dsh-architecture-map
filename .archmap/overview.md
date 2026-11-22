# Architecture map — self architecture

This repository is both the plugin and its first fixture. The graph is intentionally small: one node per independently discussable responsibility.

## Layers

- **Host** — entry, project index/workspace resolver, content source, remote transport and remote content source, consent gate, remote read tools, graph store, memory store, exporter.
- **Client** — sidebar panel with a local/remote source picker, canvas and Mermaid fence.
- **Docs & skill** — the bundled `architecture-map` workflow.

## Flow

1. The Host entry registers tools and the /arch command, and serves the vendored Mermaid runtime.
2. The project index resolves a local path or `remote:<id>` into a workspace root, a per-project state directory and a content source. The content source scans, hashes and reads workspace files; the graph store owns `<stateDir>/graph.json`; memory reads it and writes stale status; the exporter reads it for Mermaid/SVG/Markdown.
3. The sidebar panel reads `.archmap/index.json`, lets the user pick a local or remote source, polls that graph and delegates rendering to the canvas; the Host `/arch` command opens its tab (command → `command/executed` → `sidebarRight.openTab`).
4. The skill guides the sync → read → patch → dossier → commit loop, including remote `arch_remote_*` reads behind the consent gate and manifest-only remote sync.

## Caveats

- The panel follows the session workspace; open a session whose workspace is this repository to see this graph.
- Node positions are browser-local and stored per source.
- Mermaid is vendored; `renderMermaid:auto` disables it when `dsh-mermaid-plus` is enabled.
- Remote projects are a developer preview: read tools, consent, remote sync/commit and the panel source picker are implemented; change polling, auto maintenance and the add command arrive later. The panel's GUI matrix still needs the worktree profile or a merge.
