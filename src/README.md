# src

Status: M0 skeleton in progress. Planned layout (implementation detail, see the local `docs/PLAN.md` §4):

- `host/` — Host plugin: `ctx.arch` service, store, schema, sync, docs, discuss, export, tools, commands, DSH adapter.
- `client/` — Web client: right-sidebar graph tab, canvas, node card, discussion bridge, theme.
- `client/mermaid/` — bundled Mermaid fence renderer; copied/adapted MIT code keeps its original copyright header and is listed in `THIRD_PARTY_NOTICES.md`.

Current M0 state:
- `host/plugin.js` — Host entry (hello tool only).
- `client.js` at the package root — hand-written M0 client bundle (right-sidebar placeholder); later built from `client/`.

