# Architecture map

English | [中文](README.zh.md)

**中文名：架构地图** · An architecture workbench for DeepSeek Harness: a live semantic architecture graph, per-node side conversations, and incremental architecture memory.

> Status: **design / pre-alpha.** No code yet. Design and construction notes are kept locally and intentionally not tracked in this repository.

---

## Why

Agents can already read a repository and draw a diagram. The diagram is dead:

- you cannot click a node and ask about it;
- every regeneration renames and re-lays-out everything, so last week's "N3" is gone;
- discussing one module means polluting the main conversation or starting a fresh session that forgot everything;
- the next session re-reads the whole repository because nothing was remembered.

Architecture map makes the architecture a **first-class, addressable object** in the harness:

- the agent builds a **semantic graph** (stable ids, code anchors, status);
- you view it on an interactive canvas in the right sidebar;
- each node can open an **isolated side conversation** that inherits the main conversation's memory;
- side conversations merge their edits back into the one canonical graph;
- an **architecture dossier** makes later analysis incremental — only changed files are re-read.

## What it looks like

```
┌──────────────── main conversation ────────────────┬──────── right sidebar ────────┐
│  you: draw the architecture of this project       │  [Graph]  [n3 · discuss]  [+] │
│  agent: 14 nodes, 19 edges — see the map        │   ┌────┐      ┌────┐          │
│                                                   │   │ n1 │─────▶│ n3 │          │
│  (conversation stays clean while you discuss)     │   └────┘      └────┘          │
│                                                   │  n3 · Session Store           │
│                                                   │  summary / anchors / edges    │
│                                                   │  [lite] [fork]                │
└───────────────────────────────────────────────────┴───────────────────────────────┘
```

## Features

- **Semantic graph, deterministic rendering** — the model writes nodes/edges/anchors; the client computes layout. No model-generated coordinates, no drift.
- **One canonical graph per workspace** — `.archmap/graph.json` with a revision number. Child sessions, the main session, and the UI read the same file; writes are serialized and conflict-checked.
- **Per-node side conversations** — `fork` inherits the main conversation's completed turns (true memory, higher cost); `lite` spawns with a dossier digest (cheap, no memory). Contexts are isolated; conclusions are shared through node notes.
- **Incremental memory** — `.archmap/manifest.json` records content hashes of analyzed files; `arch_sync` returns only what changed and which nodes went stale.
- **Built-in Mermaid rendering** — ` ```mermaid ` blocks in chat render out of the box. You do **not** need `dsh-mermaid-plus` or any other plugin.
- **Self-contained by default** — canvas, Mermaid, export, and discussion entry ship in one bundle. Optional companions are recommendations, never dependencies.

## What it is not

- Not a general whiteboard (Excalidraw-style). No freehand pixels; every element is addressable.
- Not a general memory plugin. The dossier exists to complete the architecture graph, not to store all conversation memory.
- Not just a diagram generator. The graph, discussions, merges, and memory are one loop.

## Dependencies

No runtime plugin dependencies beyond DSH itself:

| Feature | Extra plugin? |
|---|---|
| Canvas, graph storage, export | No — bundled |
| Mermaid rendering | No — bundled |
| Side conversations | No — DSH native subagent UI |
| Skill / workflow guidance | No — bundled `architecture-map` skill |
| Architecture memory | No — workspace files managed by this plugin |
| Sharper call/impact edges | Optional: `dsh-plugin-codegraph` (recommended, **not installed automatically**) |

## How memory works (no extra plugin)

Architecture map keeps an architecture-specific dossier in the workspace, managed by the plugin itself:

```
.archmap/
├── graph.json        # canonical graph + rev
├── manifest.json     # path -> sha256 of analyzed files
├── overview.md       # one-page overview
├── modules/<id>.md   # per-module dossier
└── notes/<node>.md   # per-node discussion conclusions
```

- The first pass reads the repository once and writes the dossier + graph.
- Later, `arch_sync` hashes the workspace and returns only changed/added/deleted files and affected nodes. The agent reads only those, updates the dossier, then `arch_manifest_commit` records them.
- Conversation memory is separate: a `fork` side chat inherits the main conversation's completed turns through DSH's native fork; `lite` gets a dossier digest.
- This is **not** a general memory system and does **not** depend on `dsh-project-brain`, `dsh-living-memory`, or `dsh-memex`. Uninstall those and it still works.

## Optional companion (recommended)

- [dsh-plugin-codegraph](https://github.com/CC19990113/dsh-plugin-codegraph) — tree-sitter code intelligence (symbols, callers, impact). Recommended if you want sharper edges; **not required**. Upstream reports ~1s first index and ~45ms re-index on a 337-file workspace, so structural queries are cheap after the first build. It is type-free, so dynamic dispatch and member calls may stay unresolved and fall back to text search. On a small repo the first index can cost more than a few greps.

## Installation

Not available yet. When v0.1 ships:

1. Install the bundle via **Plugins → Add plugin** (local directory) or the plugin manager.
2. Open a new session, ask for the architecture diagram, and open the **Architecture map** tab in the right sidebar.
3. Optional but recommended: install `dsh-plugin-codegraph` separately (`dsh plugin add dsh-plugin-codegraph`). It is **not bundled and not installed automatically**.

## Requirements

- DeepSeek Harness with a Web/Desktop host.
- A workspace the agent can read.

## Roadmap

| Version | Scope |
|---|---|
| 0.1 | graph core, canvas, built-in Mermaid, bootstrap dossier, fork/lite discussions, sync, Mermaid/SVG export |
| 0.2 | direct node→discussion bridge, pinned positions, persisted proposals, graph diff |
| 0.3 | edge discussions, group collapse, Mermaid import, Office export |
| 0.4 | multiple graphs, PR links, shared team maps |

## Prior art & acknowledgements

This space already has excellent DSH plugins. Architecture map builds on their ideas and, where stated, their MIT-licensed code:

| Project | What we take |
|---|---|
| [dsh-mermaid-plus](https://github.com/pidongqianqian/dsh-mermaid-plus) (MIT) | The built-in Mermaid fence renderer will be adapted from it; original copyright notices will be retained. |
| [@eduwork/dsh-side-chat](https://github.com/ECNU/EduWork/tree/main/packages/dsh-side-chat) (MIT/MulanPSL-2.0) | UX reference for native seed-fork side chats and hiding inherited messages. |
| [@ahggg/dsh-side-chat](https://github.com/AHGGG/dsh-side-chat) (MIT) | Codex-style side-chat interaction reference. |
| [dsh-project-brain](https://github.com/yj-liuzepeng/dsh-project-brain) (MIT) | Prior art for project memory; our dossier is architecture-specific, not a general memory. |
| [dsh-anatomy](https://github.com/h2298511604-ops/dsh-anatomy) (MIT) | Live architecture-map UI reference (targets DSH itself). |
| [dsh-diagram-gallery](https://www.npmjs.com/package/dsh-diagram-gallery) (MIT) | Diagram generation/gallery reference. |
| [dsh-mindmap-live](https://github.com/SSShooter/dsh-mindmap-live) (MIT) | Bidirectional agent/user editing reference. |
| [dsh-plugin-codegraph](https://github.com/CC19990113/dsh-plugin-codegraph) (MIT) | Optional code-fact companion. |

Copied or adapted code keeps its original license header and is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) once the implementation lands.

## Design notes

Design and construction notes are kept locally and intentionally not tracked. The tracked README is the public overview; implementation details live in the local `docs/` folder.

## License

MIT.
