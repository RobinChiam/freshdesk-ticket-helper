# Architecture

## Overview

Freshdesk Ticket Helper is an Electron + React + TypeScript monorepo:

```
apps/desktop          Electron application
  main/               Trusted process (network, secrets, SQLite, IPC)
  preload/            contextBridge-only API
  renderer/           React UI
  database/           SQLite migrations + recent tickets
  freshdesk/          URL parser + API v2 client
  sanitizer/          Local HTML→text + redaction
  websocket/          Typed WSS client + mock broker
packages/protocol     Shared Zod schemas (IPC + WSS)
docs/                 Architecture, security, protocol, handoff, transcript
```

## Data flow

1. Agent configures Freshdesk URL + API key and public WSS URL + device token.
2. Secrets go to OS vault (`safeStorage`); non-secret settings go to SQLite.
3. Agent opens ticket by ID or allowlisted URL.
4. Main process fetches ticket + all conversation pages from Freshdesk API v2.
5. Renderer shows timeline with private-note badges (plain text only).
6. Sanitizer builds a revisioned context preview; private notes excluded by default.
7. Chat requests sync sanitized context over WSS (or mock broker), then stream deltas.

## Trust boundaries

- Renderer cannot reach Freshdesk or WSS directly.
- Preload exposes only named methods in `window.desktopApi`.
- Main process validates every IPC payload.
- WSS inbound messages are schema-validated and size-limited.
- Internal broker ports (for example `8787`) are server-side details and are not requested from users.

## Extension points

- `ticket_browser_cache` SQLite table for a future assigned/open ticket browser
- Protocol package can grow broker capabilities without leaking into renderer
- Sanitizer stages are modular (`htmlToText`, `quotedHistory`, `redact`, `buildSanitizedContext`)

## Build tooling

- `electron-vite` for main/preload/renderer builds
- Vitest for unit tests of pure modules
- ESLint + Prettier at repo root
- `node:sqlite` (`DatabaseSync`) for local persistence without native addon rebuilds
