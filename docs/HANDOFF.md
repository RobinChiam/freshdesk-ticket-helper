# Handoff

## Current implementation status

Runnable first prototype of **Freshdesk Ticket Helper** (Electron + React + TypeScript monorepo). Freshdesk writes and real VPS AI execution remain disabled/mocked until the broker is ready.

**Verification (2026-08-02):** typecheck ✅, lint ✅, tests 33/33 ✅, electron-vite build ✅, electron-builder pack ✅.

## Completed work

- Monorepo: `apps/desktop`, `packages/protocol`, docs, AGENT instructions
- Secure Electron main/preload/renderer with CSP and narrow IPC
- SQLite migrations for non-secret state + recent tickets (`node:sqlite`)
- `safeStorage` vault with Linux `basic_text` refusal
- Freshdesk URL parser + read-only API v2 client
- Local sanitizer + preview UI
- Typed WSS client, mock broker, reconnect/backoff, duplicate protection
- Prototype UI: settings, ticket open, timeline, private-note controls, chat streaming
- Offline `demo` ticket path for UI verification without credentials
- Unit tests for URL parser, sanitizer, IPC schemas, WSS/mock behaviour, Freshdesk client
- Documentation: README, ARCHITECTURE, SECURITY, PROTOCOL, HANDOFF, TRANSCRIPT, AGENT.md

## Known limitations

- Real VPS broker not implemented; mock mode is default
- No Freshdesk reply/note writing
- No attachment upload
- Assigned/open ticket browser not implemented (SQLite extension point only)
- Linux environments without libsecret/KWallet cannot store secrets
- Sanitizer quoted-history removal is heuristic
- `node:sqlite` is experimental; monitor Electron/Node compatibility
- Packaging targets Linux `dir` only in this prototype

## Architecture decisions

- Main-process-only network I/O
- Zod schemas shared via `@fth/protocol`
- Secrets exclusively in OS vault; never SQLite
- Public `wss://` URL only; no SSH settings in-app
- Demo ticket input `demo` for offline UI verification

## Exact verification commands

```bash
npm install
npm run build -w @fth/protocol
npm run typecheck
npm run lint
npm test
npm run build
```

Optional packaging:

```bash
npm run pack
```

Dev run:

```bash
npm run dev
```

## Next recommended tasks

1. Stand up a real WSS broker implementing `docs/PROTOCOL.md` behind Cloudflare/Nginx on 443
2. Add integration test harness with recorded Freshdesk fixtures (synthetic data only)
3. Implement assigned/open ticket browser using `ticket_browser_cache`
4. Harden sanitizer with more locale-aware phone/PII detectors
5. Add electron-builder signed artifacts for Linux/macOS/Windows
6. Optional: end-to-end Playwright smoke against mock broker

## Files most relevant to the next agent

- `packages/protocol/src/wss.ts` — broker contract
- `apps/desktop/src/websocket/client.ts` — desktop WSS client
- `apps/desktop/src/freshdesk/client.ts` — Freshdesk read API
- `apps/desktop/src/sanitizer/index.ts` — context builder
- `apps/desktop/src/main/ipc/handlers.ts` — IPC surface
- `docs/PROTOCOL.md` / `docs/SECURITY.md`
