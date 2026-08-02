/**
 * Detect and redact likely PII / secrets with stable placeholders.
 * Placeholders are stable within a single sanitizer run (CUSTOMER_EMAIL_1, …).
 */
export type RedactionState = {
  /** placeholder -> category label (never the raw secret value) */
  map: Record<string, string>;
  counters: Record<string, number>;
};

const EMAIL =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

/** Rough international phone patterns — prefers over-redaction for the prototype. */
const PHONE =
  /(?<![A-Z0-9])(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}(?!\d)/g;

/** Payment-card-like 13–19 digit runs with optional separators. */
const CARD =
  /\b(?:\d[ -]*?){13,19}\b/g;

/** Bearer/API-looking tokens and long opaque secrets. */
const TOKEN =
  /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|ghp_[A-Za-z0-9]{20,}|api[_-]?key\s*[:=]\s*[A-Za-z0-9._~+/=-]{16,})\b/gi;

export function redactSensitiveValues(
  input: string,
  state: RedactionState,
): { text: string; state: RedactionState } {
  let text = input;
  text = replaceWithPlaceholder(text, EMAIL, 'CUSTOMER_EMAIL', state);
  text = replaceWithPlaceholder(text, TOKEN, 'AUTH_TOKEN', state);
  text = replaceWithPlaceholder(text, CARD, 'PAYMENT_CARD', state, isLikelyCardNumber);
  text = replaceWithPlaceholder(text, PHONE, 'PHONE_NUMBER', state, isLikelyPhone);

  return { text, state };
}

function replaceWithPlaceholder(
  input: string,
  pattern: RegExp,
  category: string,
  state: RedactionState,
  accept: (match: string) => boolean = () => true,
): string {
  return input.replace(pattern, (match) => {
    if (!accept(match)) {
      return match;
    }
    const placeholder = nextPlaceholder(category, state);
    // Store category only — never write the original secret into the map value.
    state.map[placeholder] = category;
    return placeholder;
  });
}

function nextPlaceholder(category: string, state: RedactionState): string {
  const next = (state.counters[category] ?? 0) + 1;
  state.counters[category] = next;
  return `[${category}_${next}]`;
}

function isLikelyCardNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  return luhnCheck(digits);
}

function isLikelyPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** Basic Luhn check to reduce false positives on long numeric IDs. */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}
