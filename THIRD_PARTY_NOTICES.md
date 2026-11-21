# Third-party notices

Architecture map is MIT-licensed. Some of its implementation is inspired by, adapted from, or copied from MIT-licensed DSH plugins and libraries. When code is copied, the original copyright and permission notice is retained in the source file and reproduced here, as the MIT license requires.

This file is populated as the implementation lands. Until then it records the planned sources.

## Mermaid rendering

- **dsh-mermaid-plus 0.6.2** — https://github.com/pidongqianqian/dsh-mermaid-plus (MIT)
  Reference/adaptation for the built-in `mermaid` chat fence renderer. Its vendored Mermaid
  bundle (`vendor/mermaid.esm.min.mjs`), license files and the static-route approach were
  copied from this MIT project; the original license texts are retained under `vendor/`.
- **mermaid 12.2.0** — https://github.com/mermaid-js/mermaid (MIT)
  Bundled as `vendor/mermaid.esm.min.mjs`; MIT text in `vendor/mermaid.LICENSE`.
- **ELK (elkjs) 0.9.3** — https://github.com/kieler/elkjs (EPL-2.0)
  Inlined into the vendored Mermaid bundle as an unmodified dependency. EPL text in
  `vendor/elkjs.LICENSE`; the source is available at the URL above. Do not describe the
  whole package as MIT-only when redistributing the vendored runtime.

## Side chat UX references (no code copied at design time)

- **@eduwork/dsh-side-chat** — https://github.com/ECNU/EduWork/tree/main/packages/dsh-side-chat (MIT / MulanPSL-2.0)
  Reference for native seed-fork side chats and hiding inherited messages.
- **@ahggg/dsh-side-chat** — https://github.com/AHGGG/dsh-side-chat (MIT)
  Reference for Codex-style side-chat interaction.

## Optional companion (not bundled)

- **dsh-plugin-codegraph** — https://github.com/CC19990113/dsh-plugin-codegraph (MIT)
  Not a dependency; only recommended in the README.

## Libraries bundled into the client artifact

- **mermaid 12.2.0** — MIT, served on demand from `vendor/mermaid.esm.min.mjs`
- **ELK (elkjs) 0.9.3** — EPL-2.0, inlined into the Mermaid bundle
- The hand-written canvas uses no React Flow or dagre dependency.
