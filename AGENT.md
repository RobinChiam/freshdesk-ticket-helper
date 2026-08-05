# AGENT.md — Freshdesk Ticket Helper

Canonical instructions for coding agents working in this repository.

## Project purpose

Help Freshdesk agents open a ticket, fetch metadata and conversations (including private notes when
the API key allows), sanitize content locally, and chat through a user-selected AI connection:
either a provider API key or an already-installed local subscription CLI. Freshdesk access remains
read-only.

## Architecture and trust boundaries

| Layer | Trust | Responsibilities |
| --- | --- | --- |
| Renderer | Untrusted UI | Display and user input only; no Node, secrets, or network |
| Preload | Narrow bridge | Typed `contextBridge` methods only |
| Main | Trusted | Freshdesk/AI HTTPS, subscription-CLI child processes, SQLite, `safeStorage`, IPC validation |
| Protocol package | Shared contracts | Zod schemas for IPC; schema-free preload channel entrypoint |

There is no VPS broker, WSS runtime, or SSH integration. Provider OAuth credentials remain owned by
the installed CLI; this app never stores provider OAuth tokens.

## Commands

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run test:smoke
npm run pack
npm run dev
```

Workspace packages: `@fth/protocol`, `@fth/desktop`. Node.js 22+ is required.

## Coding conventions

- TypeScript strict mode
- Zod validation at every IPC boundary
- Short module-purpose comments; explain security boundaries and non-obvious data flow
- Prefer plain text rendering; never assign untrusted HTML to `innerHTML`
- Keep Freshdesk write APIs unimplemented until explicitly required
- Keep provider-specific behavior behind the main-process provider runtime
- Keep logical provider identity (`AiProviderId`) separate from CLI adapter IDs

## Secret-handling rules

- Store Freshdesk and per-provider AI API keys only via Electron `safeStorage`
- Never write secrets to SQLite, localStorage, fixtures, docs, transcripts, screenshots, or logs
- Never return secret values to the renderer; return presence booleans only
- On Linux, if the backend is `basic_text`, fail safely and do not store plaintext
- Error messages must not echo provider response bodies, credentials, or authorization headers
- `apps/desktop/src/main/secrets/vault.ts` is tracked source code, not a credential file; runtime
  ciphertext lives below Electron's userData directory
- Subscription-CLI mode must never require or save an API key, and must never store CLI OAuth tokens

## Allowed subscription-CLI adapters

Only these local CLI adapters may be executed, and only from the Electron main process:

- Google Antigravity CLI (`agy`) — capability-gated; fail closed when secure stdin/structured
  output/tool containment cannot be proven
- OpenAI Codex CLI (`codex`)
- Anthropic Claude Code CLI (`claude`)

Cursor must not be added as an AI provider, subscription adapter, enum value, UI option,
documentation example, or test fixture.

Hard rules for CLI adapters:

- Main-process execution only (`spawn`/`execFile` with argument arrays and `shell: false`)
- No generic shell, filesystem, environment, or raw stdout/stderr IPC through preload
- No automated install, update, login, logout, or OAuth flows
- No reading, copying, exporting, or modifying provider credential stores
- No provider-owned session resume or persistence; SQLite remains canonical chat history
- Never place ticket content, private notes, or user questions in process arguments — use stdin
- Do not use Claude `--bare` for subscription mode (it skips OAuth/keychain)
- Sanitize child env to preserve profile/keychain variables while stripping API-key overrides
- Terminate the exact child and descendants on cancel/timeout without shell command strings
- Never log full CLI stdout, stderr, prompts, ticket context, or provider responses

## Prohibited operations

- SSH or VPS configuration from the Electron app
- WSS/broker/device-token runtime compatibility paths (one-time stored-token cleanup is allowed)
- Provider tool calling, web search, or automatic model discovery in this prototype
- Non-HTTPS Freshdesk or custom AI endpoints
- Generic filesystem, shell, or HTTP APIs through preload
- Attachment upload or Freshdesk reply/note writes
- Raw ticket text in a system prompt
- Cursor subscription/provider adapters

## Freshdesk and private-note handling

- Distinguish private notes via conversation `private` and show a clear local badge
- Private notes appear only when the Freshdesk API key's agent permissions return them
- “Include private notes in AI context” defaults off and shows a warning when enabled
- Label included notes as `INTERNAL_NOTE`
- API permissions remain authoritative

## AI and IPC security rules

- Validate every IPC payload in main and verify sender frame against the expected main frame
- Renderer sends commands only through the narrow preload API; all network I/O and CLI execution
  stay in main
- Sandboxed preload imports only `@fth/protocol/preload` and no Zod runtime
- Require exact provider model IDs for API-key mode; custom OpenAI-compatible base URLs must use
  HTTPS and contain no URL credentials
- Keep ticket data and questions in user messages; use only static system instructions
- Sanitize both ticket context and the user's current question before provider transmission
- Preserve `ticketKey`/`contextRevision` identity across chat payloads
- Bound provider history to 20 messages and 40,000 characters; bound UI history to 200 messages
- Enforce request IDs, cancellation, total/chunk timeouts, and duplicate `clientRequestKey` protection
- Persist the user message when accepted; persist the assistant message only after full completion
- Never persist a partial assistant response after cancellation or failure
- Optional CLI executable overrides must be chosen via main-process file picker and allowlisted by
  adapter filename — never free-form renderer commands

## Handoff and transcript updates

`docs/` is intentionally local-only and gitignored. When present:

1. Update `docs/HANDOFF.md` with status, limitations, verification commands, and next tasks
2. Append a dated summary to `docs/TRANSCRIPT.md` without credentials or customer data
3. Keep `AGENTS.md` as a short pointer to this file

Do not add `docs/` to Git. A clean clone uses this file and README as shared sources of truth.

## Definition of done

- Typecheck, lint, unit tests, Electron smoke test, and Electron build succeed
- URL parser, sanitizer, IPC schemas, provider orchestration (API-key and CLI), persistence, and CSP
  are covered
- No secrets or real ticket data exist in tracked files
- Renderer remains sandboxed with no Node or direct network access
- Local handoff/transcript are updated when `docs/` exists
