/**
 * Convert untrusted Freshdesk HTML into plain text.
 * Scripts, styles, tracking pixels, and unsafe URLs are stripped — never executed.
 */
const UNSAFE_URL_SCHEMES = /^(javascript|data|vbscript|file):/i;

export function htmlToPlainText(input: string): string {
  if (!input) {
    return '';
  }

  // Fast path when Freshdesk already provided plain text.
  if (!/[<>]/.test(input)) {
    return decodeEntities(input);
  }

  let html = input;
  html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  html = html.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  html = html.replace(/<!--[\s\S]*?-->/g, ' ');
  // Tracking / media that should not influence AI context.
  html = html.replace(/<(img|iframe|object|embed|link|meta)[^>]*>/gi, ' ');
  html = html.replace(/<\/?(br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n');
  html = html.replace(/<\/?(ul|ol|table|thead|tbody|blockquote)[^>]*>/gi, '\n');

  // Replace anchors with visible text + sanitized URL when the URL looks safe.
  html = html.replace(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href, text) => {
    const visible = stripTags(text).trim() || 'link';
    const safeHref = sanitizeUrl(String(href));
    return safeHref ? `${visible} (${safeHref})` : visible;
  });

  html = stripTags(html);
  return decodeEntities(html);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function sanitizeUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || UNSAFE_URL_SCHEMES.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') {
      return null;
    }
    return url.toString();
  } catch {
    // Relative URLs are dropped rather than reconstructed against Freshdesk.
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)));
}
