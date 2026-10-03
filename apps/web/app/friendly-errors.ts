/**
 * Turns raw voice and chat errors into messages a customer can act on. Raw details (often nested
 * objects from the voice SDK) go to the browser console for debugging, never onto the page.
 */

/** Every piece of text inside an error, however deeply nested ({ error: { error: { msg } } } etc.). */
function textsIn(value: unknown, depth = 0, out: string[] = []): string[] {
  if (value == null || depth > 5) return out;
  if (typeof value === "string") out.push(value);
  else if (value instanceof Error) {
    out.push(value.name, value.message);
    textsIn((value as Error & { cause?: unknown }).cause, depth + 1, out);
  } else if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) textsIn(v, depth + 1, out);
  }
  return out;
}

const VOICE_RULES: [RegExp, string][] = [
  [/notallowed|permission|denied|microphone|getusermedia|audio device|notfound/i, "Koya can't hear you yet: microphone access is blocked. Allow the microphone for this site in your browser, then try again."],
  [/offline|network|failed to fetch|connection|websocket|\bice\b|timed? ?out|timeout|unreachable/i, "We couldn't connect the call. Check your internet connection and try again in a moment."],
  [/llm|pipeline|model|assistant|custom|server|5\d\d|unavailable|starting|wak/i, "Koya is taking a moment to get ready. Please try the call again in a few seconds, or switch to Chat."],
  [/quota|credit|billing|payment required|402|429|rate/i, "Voice calls are busy right now. Please try again shortly, or switch to Chat."],
  [/ended|ejected|meeting/i, "The call ended unexpectedly. Please start it again, or switch to Chat."],
];

/** A short, friendly explanation of why a voice call failed, with what to do next. */
export function voiceErrorMessage(e: unknown): string {
  console.warn("Koya voice call error:", e);
  const text = textsIn(e).join(" ");
  for (const [pattern, message] of VOICE_RULES) if (pattern.test(text)) return message;
  return "Something went wrong with the call. Please try again, or switch to Chat.";
}

/** A short, friendly explanation of why a chat message didn't go through. */
export function chatErrorMessage(e: unknown, status?: number): string {
  console.warn("Koya chat error:", status ?? "", e);
  const text = textsIn(e).join(" ");
  if (status === 429) return "You're sending messages quickly. Please wait a moment, then try again.";
  if (status === 400) return "That message couldn't be sent. Please try rephrasing it.";
  if (status && status >= 500) return "Koya is taking a moment to get ready. Please send your message again in a few seconds.";
  if (/failed to fetch|network|offline|load failed/i.test(text)) return "We couldn't reach Koya. Check your internet connection and try again.";
  return "Koya couldn't reply just now. Please try sending your message again.";
}
