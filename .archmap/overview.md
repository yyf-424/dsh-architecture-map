# Architecture map — self architecture

This repository is both the plugin and its first fixture. The graph is intentionally small: one node per independently discussable responsibility.

## Layers

- **Host** — entry, project index/workspace resolver, content sources, SSH transport, consent gate, remote read tools, remote indexer/maintainer/commands, graph store, memory store, exporter.
- **Client** — sidebar panel with a local/remote source picker, canvas and Mermaid fence.
- **Docs & skill** — the bundled `architecture-map` workflow.

## Flow

1. The Host entry registers tools and the /arch command, and serves the vendored Mermaid runtime.
2. The project index resolves a local path or `remote:<id>` into a workspace root, a per-project state directory and a content source. The content source scans, hashes and reads workspace files; the graph store owns `<stateDir>/graph.json`; memory reads it and writes stale status; the exporter reads it for Mermaid/SVG/Markdown.
3. Remote reads pass the consent gate; remote tools and `/arch remote select` start the fingerprint poller. A changed fingerprint runs the manifest-only sync, writes `remote-state.json`, marks affected nodes stale and may hand the counts to the maintainer.
4. The sidebar panel reads `.archmap/index.json`, lets the user pick a local or remote source, polls that graph and delegates rendering to the canvas; selecting a remote source starts host polling. The Host `/arch` command opens its tab.
5. The skill guides the sync → read → patch → dossier → commit loop, including remote `arch_remote_*` reads and the command surface.

## Caveats

- The panel follows the session workspace; positions are browser-local and stored per source.
- Mermaid is vendored; `renderMermaid:auto` disables it when `dsh-mermaid-plus` is enabled.
- Remote projects are a developer preview: register/read/sync/poll/commands/auto-maintenance are wired; the real-remote 60-second refresh and spawned maintenance child are the remaining W12 acceptance.
