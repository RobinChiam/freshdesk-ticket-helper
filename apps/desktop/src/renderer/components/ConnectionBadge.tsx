/** Compact connection / mock-mode indicator for the header. */
import type { ConnectionStatus } from '@fth/protocol';

export function ConnectionBadge({ status }: { status: ConnectionStatus | null }) {
  if (!status) {
    return <span className="badge">Connection: unknown</span>;
  }
  const label = status.mockMode ? `mock · ${status.state}` : status.state;
  return (
    <span
      className={`badge ${status.mockMode ? 'badge-mock' : ''}`}
      title={status.lastError ?? undefined}
    >
      AI: {label}
      {status.queueDepth > 0 ? ` · queue ${status.queueDepth}` : ''}
    </span>
  );
}
