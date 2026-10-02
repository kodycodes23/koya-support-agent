/**
 * Callback booking hours. RelayPay works 9am to 5pm, and callbacks can't start in the first or last
 * 30 minutes, so the bookable window is 9:30am to 4:30pm (inclusive). Pure and dependency-free:
 * used by the MCP escalation tool and the website's callback form (`@koya/shared/working-hours`).
 */
export const WORKING_HOURS = { open: "9am", close: "5pm", firstSlot: "9:30am", lastSlot: "4:30pm" } as const;
const FIRST = 9 * 60 + 30;
const LAST = 16 * 60 + 30;

export const CALLBACK_HOURS_MESSAGE =
  "Our team works from 9am to 5pm, and callbacks can't be booked in the first or last 30 minutes of the day, so the available times are 9:30am to 4:30pm.";

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUM = `(\\d{1,2}|${Object.keys(WORDS).join("|")})`;
const toHour = (h: string) => WORDS[h] ?? Number(h);

/** Hour with no am/pm, as people mean it for a business callback: "at 3" is 3pm, "at 10" is 10am. */
const businessHour = (h: number) => (h >= 1 && h <= 7 ? h + 12 : h);

/** Every clock time mentioned in a preferred-time phrase, in minutes after midnight. */
export function timesIn(phrase: string): number[] {
  const text = phrase.toLowerCase().replace(/\./g, (m, i, s) => (/\d/.test(s[i - 1] ?? "") && /\d/.test(s[i + 1] ?? "") ? ":" : ""));
  const found: number[] = [];
  const add = (h: number, m: number) => {
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) found.push(h * 60 + m);
  };
  const taken: [number, number][] = [];
  const free = (start: number, end: number) => taken.every(([a, b]) => end <= a || start >= b);
  const scan = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      taken.push([start, end]);
      fn(m as RegExpExecArray);
    }
  };

  if (/\b(noon|midday)\b/.test(text)) add(12, 0);
  if (/\bmidnight\b/.test(text)) add(0, 0);
  // "10am", "10:30 pm", "ten am", "2 p m"
  scan(new RegExp(`\\b${NUM}(?::(\\d{2}))?\\s*(am|pm|a m|p m)\\b`, "g"), (m) => {
    const h = toHour(m[1]!) % 12;
    add(m[3]!.startsWith("p") ? h + 12 : h, Number(m[2] ?? 0));
  });
  // "ten o'clock", "3 o'clock"
  scan(new RegExp(`\\b${NUM}\\s*o'?\\s?clock\\b`, "g"), (m) => add(businessHour(toHour(m[1]!)), 0));
  // "14:30", "9:45"
  scan(/\b(\d{1,2}):(\d{2})\b/g, (m) => {
    const h = Number(m[1]);
    add(h <= 7 && h >= 1 ? h + 12 : h, Number(m[2]));
  });
  // "at 3", "around 10", "between 2 and 4" (a bare number after a time word, not a date)
  scan(new RegExp(`\\b(?:at|around|about|by|from|after|before|between|and|till|until|to)\\s+${NUM}\\b(?!\\s*(?:st|nd|rd|th|/|-|\\d))`, "g"), (m) =>
    add(businessHour(toHour(m[1]!)), 0),
  );
  return found;
}

/**
 * Why a preferred callback time can't be booked, or null when it can. A phrase with no clock time
 * ("tomorrow morning", "Monday") is accepted: the specialist picks a time within working hours.
 */
export function callbackTimeProblem(phrase: string | null | undefined): string | null {
  if (!phrase?.trim()) return null;
  const text = phrase.toLowerCase();
  if (/\b(evening|tonight|night|midnight|dawn|early morning|before work|after work)\b/.test(text)) return CALLBACK_HOURS_MESSAGE;
  const times = timesIn(text);
  return times.every((t) => t >= FIRST && t <= LAST) ? null : CALLBACK_HOURS_MESSAGE;
}
