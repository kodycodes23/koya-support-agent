/**
 * Shared rules for spotting duplicate tickets, escalations and callback requests. Pure and
 * dependency-free so both the MCP server and the web app (`@koya/shared/duplicates`) can use it.
 *
 * - Same call (or the same form within DUPLICATE_WINDOW_MINUTES): a duplicate. The existing record
 *   is returned and nothing new is created or emailed.
 * - A later call within REPEAT_WINDOW_HOURS about the same open issue: a repeat contact. The
 *   existing record is reused, and the support team is told the customer got in touch again.
 */
export const DUPLICATE_WINDOW_MINUTES = 10;
export const REPEAT_WINDOW_HOURS = 72;

const REF = /\b(TXN|PAY|TKT|ESC)[\s-]?(\d{4,})\b/gi;

/** Payment, payout, ticket and escalation references mentioned in free text, normalized ("TXN-9001"). */
export function referencesIn(...texts: (string | null | undefined)[]): string[] {
  const refs = new Set<string>();
  for (const text of texts) for (const m of (text ?? "").matchAll(REF)) refs.add(`${m[1]!.toUpperCase()}-${m[2]}`);
  return [...refs];
}

export interface IssueKey {
  category: string;
  refs: string[];
}

/**
 * Whether two requests are about the same issue. A shared reference always matches. Two requests
 * that each name different references are different issues. Otherwise the category decides,
 * except "other", which is too vague to match across calls (`strict`): there it needs a reference.
 */
export function sameIssue(a: IssueKey, b: IssueKey, { strict = false }: { strict?: boolean } = {}): boolean {
  if (a.refs.some((r) => b.refs.includes(r))) return true;
  if (a.refs.length && b.refs.length) return false;
  if (strict && a.category === "other") return false;
  return a.category === b.category;
}

/** ISO timestamp `minutes` before `now`, for "created since" filters. */
export function since(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}
