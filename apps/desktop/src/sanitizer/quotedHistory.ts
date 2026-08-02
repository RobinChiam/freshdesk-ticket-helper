/**
 * Heuristically strip duplicated quoted email history from conversation bodies.
 * Best-effort only — preserve original order/content when unsure.
 */
const QUOTE_MARKERS = [
  /^on .+ wrote:$/i,
  /^from:\s+.+$/i,
  /^sent:\s+.+$/i,
  /^-----original message-----$/i,
  /^_{5,}$/,
  /^-{5,}.*forwarded message.*-{5,}$/i,
];

export function stripQuotedEmailHistory(text: string): string {
  const lines = text.split(/\n/);
  const cutIndexes: number[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (QUOTE_MARKERS.some((re) => re.test(line))) {
      cutIndexes.push(i);
    }
  }

  if (cutIndexes.length === 0) {
    // Drop leading ">" quote blocks that dominate the message.
    const withoutBlockQuotes = stripLeadingQuoteBlock(lines);
    return withoutBlockQuotes.join('\n').trim();
  }

  // Keep content before the earliest strong quote marker.
  const cutAt = cutIndexes[0] ?? lines.length;
  return lines.slice(0, cutAt).join('\n').trim();
}

function stripLeadingQuoteBlock(lines: string[]): string[] {
  const quoted = lines.filter((line) => line.trim().startsWith('>'));
  if (quoted.length >= Math.max(3, Math.floor(lines.length * 0.6))) {
    return lines.filter((line) => !line.trim().startsWith('>'));
  }
  return lines;
}
