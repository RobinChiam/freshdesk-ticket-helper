# Freshdesk Ticket Helper

Secure Electron desktop app for Freshdesk agents: open a ticket, review its full conversation thread (including private notes when permitted), sanitize content locally, and chat about the ticket through an authenticated WebSocket Secure AI broker on a VPS.

## What this prototype does

- First-run configuration for Freshdesk URL/API key and public WSS URL/device token
- OS credential vault storage for secrets (refuses insecure Linux `basic_text` fallback)
- Ticket ID / URL parsing with host allowlisting (https only)
- Freshdesk API v2 ticket + paginated conversation fetch (read-only)
- Local sanitizer with redaction preview
- Typed WSS client with mock broker mode
- Recent tickets in local SQLite
- No Freshdesk writes and no SSH from the desktop app

## Architecture (short)

```
Renderer (React)  --typed preload-->  Main process
                                      ├─ Freshdesk HTTPS
                                      ├─ WSS client / mock broker
                                      ├─ SQLite (non-secret state)
                                      └─ safeStorage vault (secrets)
```

Shared Zod schemas live in `packages/protocol`. Sandboxed preload imports `@fth/protocol/preload` (channel constants only).

## Prerequisites

- Node.js 20.19+ (22+ recommended)
- npm 10+
- Linux: a working secret store (libsecret / KWallet) for real credential storage

## Commands

```bash
npm install
npm run build -w @fth/protocol
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

Packaging (directory output):

```bash
npm run pack
```

Configuration is entered in the app Settings UI (not via `.env`). Secrets go to the OS vault; non-secret settings go to local SQLite under the Electron userData path.

## Security highlights

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- Restrictive production CSP; development CSP adds only the Vite Fast Refresh / HMR allowances
- No remote module; no generic shell/FS preload APIs
- Secrets never stored in SQLite, localStorage, or source-controlled env files
- Production builds refuse silent `ws://` fallback
- The app never SSHs into the VPS

Administrator SSH (outside the app only):

```bash
ssh -p <SSH_PORT> -i <LOCAL_PRIVATE_KEY_PATH> <SSH_USER>@<VPS_HOST>
```

Never paste an SSH private key into the application.

## Documentation

- [AGENT.md](AGENT.md) — canonical agent instructions
- [AGENTS.md](AGENTS.md) — compatibility pointer

Architecture, security, protocol, and handoff notes may exist under a local-only `docs/` directory on a developer machine; that directory is gitignored and is not part of a clean clone.

## Offline demo

With mock broker enabled (default), open ticket input `demo` to load a local sample ticket and exercise sanitizer + chat without Freshdesk credentials.
