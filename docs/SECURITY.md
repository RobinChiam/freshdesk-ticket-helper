# Security

## Electron hardening

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- No `remote` module
- Restrictive Content-Security-Policy on renderer responses
- External navigation denied by default; HTTPS allowlist for documentation hosts only
- Permission request handler denies all prototype-irrelevant permissions

## Preload boundary

`window.desktopApi` exposes only typed methods (settings, ticket open, sanitizer preview, chat, connection status). There is no generic filesystem, shell, HTTP, or command execution API.

## Credential storage

| Secret | Storage |
| --- | --- |
| Freshdesk API key | Electron `safeStorage` vault file |
| WSS device/pairing token | Electron `safeStorage` vault file |

Non-secret settings and recent tickets use SQLite only.

### Linux limitation

If `safeStorage.getSelectedStorageBackend()` returns `basic_text`, the app refuses to store secrets and surfaces a clear limitation. Workaround examples:

```bash
# if Secret Service / libsecret is available
electron-app --password-store=gnome-libsecret

# or KWallet
electron-app --password-store=kwallet6
```

## Network rules

- Freshdesk: HTTPS from main process only
- AI broker: `wss://` public URL only
- Packaged builds block insecure `ws://` (no silent downgrade)
- Mock broker is explicit and visually badged

## SSH boundary

The Electron application must never SSH into the VPS and must not collect SSH username, password, private key, passphrase, or port.

Administrators deploy/maintain the broker separately:

```bash
ssh -p <SSH_PORT> -i <LOCAL_PRIVATE_KEY_PATH> <SSH_USER>@<VPS_HOST>
```

## Content safety

- Ticket HTML is converted to plain text; renderer uses text nodes / `<pre>`, never `innerHTML`
- Sanitizer redacts emails, phones, auth-like tokens, and Luhn-valid card-like numbers
- Raw ticket text is never placed in a system prompt
- Private notes default to excluded from AI context

## Logging

Do not log API keys, device tokens, Authorization headers, or raw private note bodies. User-facing errors are sanitized.
