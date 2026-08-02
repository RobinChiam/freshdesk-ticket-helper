/** Reusable empty / loading / error messaging without unsafe HTML. */
type Tone = 'info' | 'success' | 'warning' | 'error';

export function StatusBanner({
  tone,
  title,
  message,
}: {
  tone: Tone;
  title: string;
  message: string;
}) {
  return (
    <div className={`banner banner-${tone}`} role="status">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}
