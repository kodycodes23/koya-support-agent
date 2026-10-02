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

const UNITS: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_WORD = `(?:${Object.keys(UNITS).join("|")}|hundred|thousand|and)`;
// Text-to-speech formatting can turn "CUS-1001" into "c u s minus one thousand one".
const WORDED_REF = new RegExp(`\\b([a-z])[\\s.]*([a-z])[\\s.]*([a-z])[\\s,]*(?:minus|dash|hyphen)\\s+((?:${NUMBER_WORD}[\\s-]+)*${NUMBER_WORD})\\b`, "gi");

function wordsToNumber(words: string): number | null {
  let total = 0;
  let current = 0;
  for (const w of words.toLowerCase().split(/[\s-]+/)) {
    if (w === "and") continue;
    if (w === "hundred") current *= 100;
    else if (w === "thousand") {
      total += current * 1000;
      current = 0;
    } else if (w in UNITS) current += UNITS[w]!;
    else return null;
  }
  return total + current;
}

export function writtenReferences(text: string): string {
  text = text.replace(WORDED_REF, (match, a: string, b: string, c: string, words: string) => {
    const prefix = `${a}${b}${c}`.toUpperCase();
    const n = wordsToNumber(words);
    return PREFIXES.has(prefix) && n !== null && n >= 1000 ? `${prefix}-${n}` : match;
  });
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

/** What the caller typed during a voice call, by shape. Mirrors typedFieldOf() in packages/shared/src/text.ts. */
export function typedFieldOf(value: string): "name" | "email" | "reference" {
  if (/@/.test(value)) return "email";
  if (/^\s*(TXN|PAY|TKT|ESC)[-\s]?\d+/i.test(value)) return "reference";
  return "name";
}
