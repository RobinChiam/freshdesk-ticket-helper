# Freshdesk Ticket Helper

Secure Electron desktop app for Freshdesk agents. Open a ticket by ID or URL, review its
conversation, inspect the locally sanitized AI context, and chat using either a provider API key or
an already-installed local subscription CLI.

## Prototype capabilities

- Freshdesk API v2 ticket and paginated conversation reads
- Private-note display when the Freshdesk API key permits it; AI inclusion is off by default
- Local plain-text conversion and redaction preview before any AI request
- Direct AI access from Electron's trusted main process through:
  - API keys: Google Gemini, OpenAI, Anthropic, or a custom OpenAI-compatible HTTPS endpoint
  - Subscription CLIs: Google Antigravity (`agy`), OpenAI Codex (`codex`), Anthropic Claude Code
    (`claude`)
- Streaming responses, cancellation, safe timeouts, and one automatic retry for API-key mode
- Per-ticket chat history in local SQLite
- Freshdesk and per-provider API keys encrypted with Electron `safeStorage`
- No VPS, WebSocket broker, SSH, Freshdesk writes, attachments, tools, or web search

API-key usage is billed by the selected provider under your API account. Subscription-CLI usage is
governed by the installed CLI’s current account, entitlement, and provider terms. Consumer plans such
as ChatGPT Plus, Google AI Pro, or Claude Pro do not guarantee access. The app never stores provider
OAuth tokens and never automates CLI login.

## Architecture

```text
Renderer (React, untrusted) --typed preload--> Main process (trusted)
                                                |-- Freshdesk HTTPS
                                                |-- selected AI provider HTTPS (API-key mode)
                                                |-- subscription CLI child processes (CLI mode)
                                                |-- SQLite (settings and chat history)
                                                `-- safeStorage vault (API keys only)
```

The renderer has no Node access, network client, or secret access. Shared Zod schemas in
`packages/protocol` validate IPC payloads in the main process. The sandboxed preload imports only
the schema-free channel constants from `@fth/protocol/preload`.

## Prerequisites

- Node.js 22+
- npm 10+
- Linux: a working Secret Service/libsecret or KWallet backend
- For subscription-CLI mode: the chosen provider CLI already installed and authenticated in a
  terminal

The app refuses to store credentials when Electron reports the insecure Linux `basic_text`
backend.

## Install and run

```bash
npm install
npm run dev
```

Other checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:smoke
npm run pack
```

## Configure the app

All configuration is entered in Settings; `.env` files are not used.

1. Enter the canonical Freshdesk account URL, such as `https://company.freshdesk.com`.
2. Optionally add other trusted Freshdesk UI hostnames whose ticket URLs you want to paste.
3. Enter a Freshdesk agent API key and test the connection.
4. Choose an AI connection method:
   - **API key** (default): select Google Gemini, OpenAI, Anthropic, or Custom OpenAI-compatible;
     enter the exact model ID and provider API key. For a custom provider only, enter its HTTPS
     OpenAI-compatible base URL.
   - **Existing CLI subscription**: select Antigravity, Codex, or Claude Code; use Check
     installation / Locate CLI / Test connection. No API key is required or stored for CLI mode.
5. Save, then open a ticket using an ID or an allowlisted HTTPS URL.

Keys are write-only in the UI: a saved key is indicated but never returned to the renderer. Each AI
provider has a separate stored key, so changing providers does not overwrite another provider's
credential.

### Subscription CLI notes

- The app assumes the CLI is already installed and authenticated. It does not install, update, or
  log in provider CLIs.
- The OS credential store may show a consent prompt when the CLI accesses Keychain / Credential
  Manager / Secret Service.
- Antigravity may open a browser when no saved login exists. Complete login in a terminal/browser,
  then return to the app.
- Antigravity ticket chat stays disabled unless the installed CLI version proves a secure
  stdin + structured-output + tool-containment contract. Otherwise the app reports that secure
  automation is unsupported.
- Packaged apps can use Locate CLI to pick a validated executable whose filename matches the adapter
  allowlist.

## Ticket context and chat history

Ticket HTML is converted to plain text and common emails, phones, auth-like tokens, and valid
card-like numbers are redacted locally. The preview is the context sent to the provider. Ticket
content is always sent as untrusted user data, never as system instructions.

Chat history is isolated by `freshdesk-host:ticket-id`, stored locally, and loaded when that ticket
is reopened. The UI displays up to 200 messages. Provider requests use at most the latest 20
messages and 40,000 history characters. Clearing history affects only the current ticket.

The offline `demo` ticket exercises ticket display and sanitization without Freshdesk credentials;
chat still requires a configured AI connection (API key + model, or a ready subscription CLI).

## Security boundaries

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- Main-process-only Freshdesk, AI network access, and CLI execution
- HTTPS required for Freshdesk and custom provider endpoints
- No generic shell, filesystem, or HTTP methods exposed through preload
- No API keys or CLI OAuth tokens in SQLite, localStorage, logs, tracked configuration, or renderer
  responses
- Ticket content is passed to CLIs through stdin only — never through process arguments
- Private notes remain clearly labeled and are excluded from AI context unless explicitly enabled
- Freshdesk access is read-only; the AI cannot post a reply or note

## Troubleshooting

| Symptom | What to try |
| --- | --- |
| Linux cannot save keys | Install/configure libsecret or KWallet and restart so Electron does not use `basic_text` |
| CLI missing in packaged app | Use Locate CLI, or install the provider’s native binary onto PATH |
| Login required | Authenticate in a terminal with the provider CLI (`codex login`, `claude auth login`, etc.) |
| Secure automation unsupported | Antigravity version lacks a proven secure automation contract; use API-key mode or another CLI |
| AI test fails after switching mode | Save settings first; API-key mode needs a vault key, CLI mode needs a ready installation |

## Repository guidance

- [AGENT.md](AGENT.md) is the canonical shared instruction file.
- [AGENTS.md](AGENTS.md) is a compatibility pointer.
- `docs/` contains local agent handoffs and design notes when present, and is intentionally ignored
  by Git.
