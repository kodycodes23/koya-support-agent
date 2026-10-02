/** Truncates to `max` chars for log summaries. */
export function truncate(value: string, max = 280): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Compact, log-safe JSON summary of a value, with sensitive keys masked. */
export function summarize(value: unknown, max = 280): string {
  return truncate(JSON.stringify(maskSensitive(value)) ?? "", max);
}

const SENSITIVE_KEYS = /(email|phone|password|secret|token|key|authorization)/i;

/** Masks values whose key looks sensitive (emails keep their domain for debuggability). */
export function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) && typeof v === "string" ? maskValue(k, v) : maskSensitive(v)]),
    );
  }
  return value;
}

function maskValue(key: string, v: string): string {
  if (/email/i.test(key) && v.includes("@")) return `***@${v.split("@")[1]}`;
  return "***";
}

/**
 * Makes model output safe to hand to TTS: strips markdown, URLs, bullets and emoji.
 * Only use this on complete text; for streamed fragments use SpokenStream, which knows
 * whether a fragment really starts a new line.
 */
export function sanitizeSpoken(text: string): string {
  const stream = new SpokenStream();
  return stream.push(text) + stream.flush();
}

/**
 * Streaming variant of sanitizeSpoken. Line-start rules (bullets, "1." list markers, headings)
 * apply only at a real line start, so "Your ticket is TKT-1" + "001. Thanks" stays intact.
 * Text that might still become a URL or a markdown link is held until it is unambiguous.
 */
export class SpokenStream {
  private atLineStart = true;
  private pending = "";

  /** `spellReferences`: for text-to-speech, say "CUS-1001" as "C U S, one zero zero one" (never "minus one thousand one"). */
  constructor(private readonly opts: { spellReferences?: boolean } = {}) {}

  push(fragment: string): string {
    this.pending += fragment;
    // Hold back a trailing partial token (possible URL or line-start marker) until more arrives.
    const cut = Math.max(this.pending.lastIndexOf(" "), this.pending.lastIndexOf("\n"));
    if (cut === -1) return "";
    const ready = this.pending.slice(0, cut + 1);
    this.pending = this.pending.slice(cut + 1);
    return this.clean(ready);
  }

  flush(): string {
    const rest = this.pending;
    this.pending = "";
    return this.clean(rest);
  }

  private clean(text: string): string {
    let out = "";
    for (const line of text.split(/(?<=\n)/)) {
      let l = line;
      if (this.atLineStart) l = l.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+|#+\s+)/, "");
      out += l;
      this.atLineStart = l.endsWith("\n");
    }
    const spoken = this.opts.spellReferences ? spokenReferences(out) : out;
    return spoken
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\]\(\)?|[[\]]/g, "") // leftovers of a link split across fragments; brackets are never spoken
      .replace(/\*\*|__|`+/g, "")
      .replace(/\p{Extended_Pictographic}/gu, "");
  }
}

const SPOKEN_DIGIT = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "Your case is ESC-5040." → "Your case is E S C, five zero four zero." Letters and digits one at a time. */
export function spokenReferences(text: string): string {
  return text.replace(/\b(TKT|TXN|PAY|ESC|CUS)[-\s]?(\d{4,6})\b/gi, (_, prefix: string, digits: string) =>
    `${prefix.toUpperCase().split("").join(" ")}, ${digits.split("").map((d) => SPOKEN_DIGIT[Number(d)]).join(" ")}`,
  );
}

/**
 * Turns spelled-out references back into written form for records and screens:
 * "T K T, one zero three five" or "TKT 1035" → "TKT-1035" (also TXN, PAY, ESC, CUS).
 * Mirrors apps/web/app/references.ts.
 */
const REF_PREFIXES = new Set(["TKT", "TXN", "PAY", "ESC", "CUS"]);
const REF_DIGITS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const REF_DIGIT = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|\\d)";
const SPOKEN_REF = new RegExp(`\\b([a-z])[\\s.,-]*([a-z])[\\s.,-]*([a-z])[\\s,.:-]*(${REF_DIGIT}(?:[\\s,-]*${REF_DIGIT}){3,5})\\b`, "gi");

export function writtenReferences(text: string): string {
  return text.replace(SPOKEN_REF, (match, a: string, b: string, c: string, digits: string) => {
    const prefix = `${a}${b}${c}`.toUpperCase();
    if (!REF_PREFIXES.has(prefix)) return match;
    const number = digits
      .split(/[\s,-]+/)
      .flatMap((t) => (/^\d+$/.test(t) ? t.split("") : [REF_DIGITS[t.toLowerCase()] ?? ""]))
      .join("");
    return `${prefix}-${number}`;
  });
}

/** On-screen typing during a voice call: "[typed name] Chikodi Agorua", "[typed email] …", "[typed reference] …". */
export type TypedField = "name" | "email" | "reference";
const TYPED = /\[typed (name|email|reference)\]\s*([^[]+)/gi;

/** Every typed value in a caller message, in order. */
export function typedValues(text: string): { field: TypedField; value: string }[] {
  return [...text.matchAll(TYPED)].map((m) => ({ field: m[1]!.toLowerCase() as TypedField, value: m[2]!.trim() })).filter((t) => t.value);
}

/** Which kind of value the caller typed, from its shape. */
export function typedFieldOf(value: string): TypedField {
  if (/@/.test(value)) return "email";
  if (/^\s*(TXN|PAY|TKT|ESC)[-\s]?\d+/i.test(value)) return "reference";
  return "name";
}
