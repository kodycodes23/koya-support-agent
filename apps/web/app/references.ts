/**
 * Koya spells references aloud ("T K T, one zero three five") so the voice reads them clearly.
 * For anything on screen, turn them back into their written form ("TKT-1035"). Also handles
 * transcriber output such as "TKT 1035". Mirrors writtenReferences() in packages/shared/src/text.ts
 * (kept separate because that package is server-side).
 */
const PREFIXES = new Set(["TKT", "TXN", "PAY", "ESC", "CUS"]);
const DIGITS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const DIGIT = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|\\d)";
const SPOKEN_REF = new RegExp(`\\b([a-z])[\\s.,-]*([a-z])[\\s.,-]*([a-z])[\\s,.:-]*(${DIGIT}(?:[\\s,-]*${DIGIT}){3,5})\\b`, "gi");

export function writtenReferences(text: string): string {
  return text.replace(SPOKEN_REF, (match, a: string, b: string, c: string, digits: string) => {
    const prefix = `${a}${b}${c}`.toUpperCase();
    if (!PREFIXES.has(prefix)) return match;
    const number = digits
      .split(/[\s,-]+/)
      .flatMap((t) => (/^\d+$/.test(t) ? t.split("") : [DIGITS[t.toLowerCase()] ?? ""]))
      .join("");
    return `${prefix}-${number}`;
  });
}
