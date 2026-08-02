# AGENT.md — Freshdesk Ticket Helper

Canonical instructions for coding agents working in this repository.

## Project purpose

Help Freshdesk agents open a ticket, fetch metadata and conversations (including private notes when the API key allows), sanitize content locally, and chat via an authenticated `wss://` AI broker. The desktop app must never SSH into the VPS.

## Architecture and trust boundaries

| Layer | Trust | Responsibilities |
| --- | --- | --- |
| Renderer | Untrusted UI | Display only; no Node, no secrets, no network |
| Preload | Narrow bridge | Typed `contextBridge` methods only |
| Main | Trusted | Freshdesk HTTPS, WSS, SQLite, `safeStorage` |
| Protocol package | Shared contracts | Zod schemas for IPC + WSS |
| VPS broker | External | Reached only via public WSS URL |

SSH is for human administrators deploying the server, not for the Electron runtime.

## Commands

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
npm run pack
```

Workspace packages: `@fth/protocol`, `@fth/desktop`.

## Coding conventions

- TypeScript strict mode
- Zod validation at every IPC and WSS boundary
- Short module purpose comments; explain security boundaries and data flow, not obvious syntax
- Prefer plain text rendering; never assign untrusted HTML to `innerHTML`
- Keep Freshdesk write APIs unimplemented until explicitly required

## Secret-handling rules

- Store Freshdesk API key and WSS device token only via Electron `safeStorage`
- Never write secrets to SQLite, localStorage, fixtures, docs, transcripts, screenshots, or logs
- On Linux, if backend is `basic_text`, fail safely and explain — do not store plaintext
- Error messages must never echo credentials

## Prohibited operations

- SSH from the Electron app (no SSH user/password/key/port settings)
- Silent fallback from `wss://` to `ws://` in production builds
- Exposing generic filesystem, shell, or HTTP APIs through preload
- Uploading attachments in this prototype
- Writing replies/notes back to Freshdesk in this prototype
- Placing raw ticket text inside a system prompt

## Freshdesk / private-note handling

- Distinguish private notes via conversation `private`
- Show a clear Private note badge locally
- Private notes appear only when the Freshdesk API key’s agent permissions allow the API to return them
- “Include private notes in AI context” defaults to off; warn when enabled
- Label included notes as `INTERNAL_NOTE`
- API key permissions remain authoritative

## IPC and WSS security rules

- Validate all IPC payloads with `@fth/protocol` schemas
- Validate IPC sender/frame against the expected BrowserWindow main frame
- Main-process-only network access
- Sandboxed preload imports only `@fth/protocol/preload` (no Zod runtime)
- WSS readiness means authenticated (or mock), not merely socket-open
- Wait for matching `context.ack` before `chat.request`
- Enforce max message sizes, request IDs, cancellation, and duplicate `clientRequestKey` protection
- Mock broker must be visually obvious
- Chat payloads must keep outer `ticketKey`/`contextRevision` equal to `sanitizedContext`

## Handoff and transcript updates

`docs/` is intentionally **local-only** and gitignored. When present on a developer machine:

1. Update `docs/HANDOFF.md` with status, limitations, verification commands, and next tasks
2. Append a dated summary to `docs/TRANSCRIPT.md` (no credentials, customer data, or raw private notes)
3. Keep `AGENTS.md` as a short pointer to this file

Do not add `docs/` to Git. A clean clone will not include those files; use this AGENT.md and the README as the source of truth for shared instructions.

## Definition of done

- Typecheck, lint, unit tests, Electron smoke test, and Electron build succeed
- URL parser, sanitizer, IPC schema, and WSS protocol tests covered
- No secrets or real ticket data in tracked files
- Renderer has no Node integration
- Local handoff/transcript updated when `docs/` exists on the machine (still ignored by Git)
