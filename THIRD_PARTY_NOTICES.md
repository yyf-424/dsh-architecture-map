# Third-party notices

Architecture map is MIT-licensed. Some of its implementation is inspired by, adapted from, or copied from MIT-licensed DSH plugins and libraries. When code is copied, the original copyright and permission notice is retained in the source file and reproduced here, as the MIT license requires.

This file is populated as the implementation lands. Until then it records the planned sources.

## Mermaid rendering

- **dsh-mermaid-plus** — https://github.com/pidongqianqian/dsh-mermaid-plus (MIT)
  Reference/adaptation for the built-in `mermaid` chat fence renderer (rendering, layout selection, zoom/export behavior).
- **mermaid** — https://github.com/mermaid-js/mermaid (MIT)
  Bundled diagram renderer.

## Side chat UX references (no code copied at design time)

- **@eduwork/dsh-side-chat** — https://github.com/ECNU/EduWork/tree/main/packages/dsh-side-chat (MIT / MulanPSL-2.0)
  Reference for native seed-fork side chats and hiding inherited messages.
- **@ahggg/dsh-side-chat** — https://github.com/AHGGG/dsh-side-chat (MIT)
  Reference for Codex-style side-chat interaction.

## Optional companion (not bundled)

- **dsh-plugin-codegraph** — https://github.com/CC19990113/dsh-plugin-codegraph (MIT)
  Not a dependency; only recommended in the README.

## Libraries bundled into the client artifact

- **@xyflow/react** — MIT
- **dagre** — MIT
- **mermaid** — MIT

When bundled, their license texts are included in the published artifact and summarized here.
