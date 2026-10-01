import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkKnowledgeBase, firstSentence } from "../seed/chunk-kb.ts";

const kb = readFileSync(new URL("../../assets/relaypay-knowledge-base.md", import.meta.url), "utf8");

describe("chunkKnowledgeBase", () => {
  const chunks = chunkKnowledgeBase(kb);

  it("produces one chunk per subsection with unique keys", () => {
    expect(chunks.length).toBeGreaterThan(30);
    expect(new Set(chunks.map((c) => c.chunk_key)).size).toBe(chunks.length);
  });

  it("skips the document preamble", () => {
    expect(chunks.some((c) => c.content.includes("approved support knowledge for the Week 6"))).toBe(false);
  });

  it("keeps the fee FAQ intact with its source title", () => {
    const fees = chunks.find((c) => c.section === "How Does RelayPay Charge Fees?");
    expect(fees?.source_title).toBe("RelayPay Knowledge Base › Frequently Asked Questions");
    expect(fees?.content).toContain("displays applicable fees before a transaction is confirmed");
  });

  it("captures H2 intro text as an overview chunk", () => {
    expect(chunks.find((c) => c.chunk_key === "policies-and-compliance-overview")?.content).toContain("Anti-Money Laundering");
  });
});

describe("firstSentence", () => {
  it("flattens list items and stops at the first sentence", () => {
    expect(firstSentence("Users can:\n\n- Add things\n- Remove things")).toBe("Users can: Add things Remove things");
    expect(firstSentence("No. Exchange rates may fluctuate. More text here.")).toBe("No. Exchange rates may fluctuate.");
  });
});
