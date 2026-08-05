/** Shows exactly what sanitized ticket data may be sent to the selected provider. */
import type { SanitizedContext } from '@fth/protocol';

export function SanitizerPreview({ context }: { context: SanitizedContext | null }) {
  return (
    <section className="panel">
      <h2>Sanitized AI context preview</h2>
      <p className="muted">
        This is the exact ticket context prepared for the AI provider. Raw ticket HTML is never used
        as a system prompt.
      </p>
      {!context ? (
        <p className="muted">Open a ticket to generate a sanitizer preview.</p>
      ) : (
        <>
          <p className="muted">
            Revision {context.contextRevision}
            {context.warnings.length ? ` · ${context.warnings.join(' ')}` : ''}
          </p>
          <pre className="preview-block">{context.previewText}</pre>
        </>
      )}
    </section>
  );
}
