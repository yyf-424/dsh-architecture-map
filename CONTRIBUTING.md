# Contributing

Thanks for taking a look. This is a 0.2.0 developer-preview bundle; small, focused changes with tests are easiest to review.

## Development

```bash
npm run check   # syntax check the Host/Client entry points
npm test        # node --test
npm pack --dry-run
```

The client is hand-written (`client.js`); there is no build step for it. Host code is plain ESM under `src/host/`.

## What to change

- Keep the canonical graph schema backward-compatible unless the change explicitly bumps it.
- Add or update tests for graph validation, patching, memory sync, stale detection or exports.
- Do not commit `.archmap/` data, local design notes under `docs/DESIGN.md` / `PLAN.md` / `M0-FINDINGS.md`, or `vendor/` modifications without updating `THIRD_PARTY_NOTICES.md`.
- If you copy third-party code, keep its license header and add it to `THIRD_PARTY_NOTICES.md`.

## Reporting issues

Include the DSH version, the workspace layout, the exact tool call, and the raw tool result or browser console error. Do not include credentials.
