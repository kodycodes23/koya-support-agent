import { ANSWER_TYPES, CONFIDENCE_LEVELS, type AnswerType, type Confidence } from "@koya/shared";

/**
 * The model starts each reply with a metadata tag the caller must never hear:
 *   <koya type="lookup" confidence="high" note="..."/>
 * MetaTagStripper removes such tags from a streamed reply while passing all other
 * text through as early as possible (TTS latency), and remembers the last tag seen.
 */
export interface TurnMeta {
  type?: AnswerType;
  confidence?: Confidence;
  note?: string;
}

const TAG_OPEN = "<koya";

export function parseMetaTag(tag: string): TurnMeta {
  const attrs = Object.fromEntries([...tag.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
  const meta: TurnMeta = {};
  if ((ANSWER_TYPES as readonly string[]).includes(attrs.type ?? "")) meta.type = attrs.type as AnswerType;
  if ((CONFIDENCE_LEVELS as readonly string[]).includes(attrs.confidence ?? "")) meta.confidence = attrs.confidence as Confidence;
  if (attrs.note?.trim()) meta.note = attrs.note.trim();
  return meta;
}

export class MetaTagStripper {
  private pending = "";
  /** After a tag, leading whitespace is dropped even if it arrives in a later fragment. */
  private trimNext = false;
  meta: TurnMeta = {};

  /** Feed a streamed fragment; returns the text that is safe to speak now. */
  push(fragment: string): string {
    this.pending += fragment;
    return this.drain();
  }

  private drain(): string {
    let out = "";
    while (this.pending) {
      if (this.trimNext) {
        this.pending = this.pending.replace(/^\s+/, "");
        if (!this.pending) break;
        this.trimNext = false;
      }
      const lt = this.pending.indexOf("<");
      if (lt === -1) {
        out += this.pending;
        this.pending = "";
        break;
      }
      out += this.pending.slice(0, lt);
      this.pending = this.pending.slice(lt);
      // Not enough characters yet to know whether this "<" starts our tag.
      if (this.pending.length < TAG_OPEN.length && TAG_OPEN.startsWith(this.pending)) break;
      if (!this.pending.startsWith(TAG_OPEN)) {
        out += "<";
        this.pending = this.pending.slice(1);
        continue;
      }
      const end = this.pending.indexOf(">");
      if (end === -1) {
        // Guard against an unterminated tag swallowing the whole reply.
        if (this.pending.length > 400) {
          this.pending = this.pending.slice(TAG_OPEN.length);
          continue;
        }
        break;
      }
      this.meta = { ...this.meta, ...parseMetaTag(this.pending.slice(0, end + 1)) };
      this.pending = this.pending.slice(end + 1);
      this.trimNext = true;
    }
    return out;
  }

  /** Flush whatever is left at the end of the stream (a dangling partial tag is dropped). */
  flush(): string {
    const partialTag = this.pending.startsWith(TAG_OPEN) || TAG_OPEN.startsWith(this.pending);
    const rest = partialTag ? "" : this.pending;
    this.pending = "";
    return rest;
  }
}
