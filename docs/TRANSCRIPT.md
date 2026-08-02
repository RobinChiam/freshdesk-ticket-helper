# Engineering transcript

Append-only summarized log. No credentials, customer data, raw private notes, or machine-specific secrets.

## 2026-08-02 — Initial prototype bootstrap

- Inspected repository: clean `Main` branch with introductory README only; no prior app code.
- Chose monorepo layout (`apps/desktop`, `packages/protocol`, `docs`) with electron-vite + React + Zod + Vitest + `node:sqlite`.
- Implemented secure Electron shell, SQLite non-secret state, `safeStorage` vault, Freshdesk read client, sanitizer, WSS client + mock broker, and prototype UI.
- Added AGENT.md (canonical) and AGENTS.md (pointer).
- Fixed TypeScript project config (consume built `@fth/protocol`) and React lint setState-in-effect finding.
- Verification results:
  - `npm run typecheck` — pass
  - `npm run lint` — pass
  - `npm test` — 33 passed (ticket URL, sanitizer, IPC schemas, WSS/mock, Freshdesk client)
  - `npm run build` — electron-vite main/preload/renderer bundles produced under `apps/desktop/out`
  - `npm run pack` — electron-builder linux dir package produced under `apps/desktop/release/linux-unpacked` (Electron pinned to 37.10.3)
- Secret scan of tracked sources: no real credentials detected.
- Renderer review: no Node `fs`/`child_process` usage; no `innerHTML` writes.
