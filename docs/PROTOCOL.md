# Protocol

Shared schemas live in `packages/protocol`.

## Common envelope (every WSS message)

| Field | Description |
| --- | --- |
| `protocolVersion` | Currently `1` |
| `type` | Message type |
| `requestId` | UUID correlating request/response streams |
| `ticketKey` | `host:ticketId` or `null` for auth/ping |
| `timestamp` | ISO-8601 timestamp |
| `payload` | Type-specific object |

Maximum JSON message size: 256,000 bytes.

## Message types

| Type | Direction | Purpose |
| --- | --- | --- |
| `auth` | client → server | Device/pairing token authentication |
| `auth.result` | server → client | Accept/reject session |
| `context.sync` | client → server | Push sanitized ticket context revision |
| `context.ack` | server → client | Acknowledge context revision |
| `chat.request` | client → server | User chat text + context revision |
| `chat.queued` | server → client | Queue position |
| `chat.delta` | server → client | Streaming chunk + sequence |
| `chat.completed` | server → client | Final text |
| `chat.failed` | server → client | Structured failure |
| `chat.cancel` | client → server | Cancel in-flight request |
| `ping` / `pong` | both | Application heartbeat |

## Auth payload

```json
{
  "deviceToken": "…",
  "clientName": "freshdesk-ticket-helper",
  "clientVersion": "0.1.0"
}
```

## Chat request payload

Contains only sanitized context revision metadata and the user message. It must not include raw Freshdesk HTML.

## Duplicate protection

Clients send `clientRequestKey` (UUID). The desktop client rejects duplicate keys locally before transmission.

## Mock broker

When `useMockBroker` is enabled, an in-process adapter simulates auth, queueing, streaming deltas, and completion. UI shows a persistent mock banner. Mock mode is never a silent fallback from failed WSS auth.
