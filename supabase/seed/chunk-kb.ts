/**
 * Splits the RelayPay knowledge base markdown into retrieval chunks.
 *
 * One chunk per `###` subsection; text that sits directly under a `##` heading
 * (before its first `###`) becomes its own chunk. The file-level `#` title and its
 * preamble describe the document rather than RelayPay, so they are skipped.
 */
export interface KbChunk {
  chunk_key: string;
  source_title: string;
  section: string;
  content: string;
  summary: string;
  position: number;
}

const DOC_TITLE_FALLBACK = "RelayPay Knowledge Base";

export function chunkKnowledgeBase(markdown: string): KbChunk[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let docTitle = DOC_TITLE_FALLBACK;
  let h2: string | null = null;
  let h3: string | null = null;
  let buffer: string[] = [];
  const chunks: KbChunk[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    buffer = [];
    if (!h2 || !body) return;
    const section = h3 ?? h2;
    chunks.push({
      chunk_key: slug(h3 ? `${h2}-${h3}` : `${h2}-overview`),
      source_title: `${docTitle} › ${h2}`,
      section,
      content: body,
      summary: firstSentence(body),
      position: chunks.length,
    });
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!heading) {
      buffer.push(line);
      continue;
    }
    flush();
    const level = heading[1]!.length;
    const text = heading[2]!.trim();
    if (level === 1) {
      docTitle = text;
      h2 = null;
      h3 = null;
    } else if (level === 2) {
      h2 = text;
      h3 = null;
    } else {
      h3 = text;
    }
  }
  flush();
  return chunks;
}

export function firstSentence(body: string): string {
  const prose = body
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
    .join(" ");
  // Take sentences until the summary is informative (FAQ answers often open with "No." or "Yes.").
  const sentences = prose.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [prose];
  let sentence = "";
  for (const s of sentences) {
    sentence = `${sentence} ${s.trim()}`.trim();
    if (sentence.length >= 25) break;
  }
  return sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
