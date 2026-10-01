import { describe, expect, it } from "vitest";
import { classifyTurn } from "../src/agent/answer-type.ts";
import { MetaTagStripper } from "../src/agent/meta.ts";

function run(fragments: string[]) {
  const s = new MetaTagStripper();
  const spoken = fragments.map((f) => s.push(f)).join("") + s.flush();
  return { spoken, meta: s.meta };
}

describe("MetaTagStripper", () => {
  it("strips a leading tag split across many fragments", () => {
    const { spoken, meta } = run(["<ko", 'ya type="clar', 'ifying" confidence="high" note="vague"/>', " Is this an incoming", " transfer?"]);
    expect(spoken).toBe("Is this an incoming transfer?");
    expect(meta).toEqual({ type: "clarifying", confidence: "high", note: "vague" });
  });

  it("passes through text that is not our tag, including a lone <", () => {
    expect(run(["Fees are < 1% ", "sometimes."]).spoken).toBe("Fees are < 1% sometimes.");
    expect(run(["<b>hi</b>"]).spoken).toBe("<b>hi</b>");
  });

  it("strips tags that appear mid-reply and keeps the last one", () => {
    const { spoken, meta } = run(['<koya type="lookup" confidence="high"/>Let me check. ', '<koya type="escalated" confidence="medium"/>A specialist will call you.']);
    expect(spoken).toBe("Let me check. A specialist will call you.");
    expect(meta.type).toBe("escalated");
  });

  it("ignores invalid attribute values", () => {
    expect(run(['<koya type="banana" confidence="high"/>Hi']).meta).toEqual({ confidence: "high" });
  });

  it("releases text held for a possible tag when the stream ends", () => {
    expect(run(["Total <ko"]).spoken).toBe("Total ");
    expect(run(["a <k"]).spoken).toBe("a ");
  });
});

describe("classifyTurn", () => {
  const kb = (score: number) => ({ name: "search_knowledge_base", input: { query: "fees" }, result: { found: true, chunks: [{ section: "How Does RelayPay Charge Fees?", score }] } });
  it("prioritises escalation over lookup and names the reference", () => {
    const c = classifyTurn(
      [
        { name: "lookup_payout", input: { payout_id: "PAY-7002" }, result: { found: true, payout_id: "PAY-7002", status: "review required", escalation_recommended: true } },
        { name: "create_escalation", input: { category: "compliance" }, result: { escalation_id: "ESC-5001" } },
      ],
      "A specialist will call you.",
    );
    expect(c).toEqual({ answerType: "escalated", confidence: "high", note: "Escalation ESC-5001 created (compliance)" });
  });
  it("grounded answers cite the sections used", () => {
    expect(classifyTurn([kb(0.8)], "Fees depend on the corridor.")).toEqual({ answerType: "answered", confidence: "high", note: "Grounded in: How Does RelayPay Charge Fees?" });
  });
  it("declines when the knowledge base has nothing or the reply declines", () => {
    expect(classifyTurn([{ name: "search_knowledge_base", input: {}, result: { found: false, chunks: [] } }], "I can't confidently answer that.").answerType).toBe("declined");
    expect(classifyTurn([kb(0.6)], "No, I can't guarantee that timeline.").answerType).toBe("declined");
  });
  it("detects clarifying questions and escalation intake without tools", () => {
    expect(classifyTurn([], "Is this an incoming transfer or an outgoing payout?").answerType).toBe("clarifying");
    expect(classifyTurn([], "A specialist needs to help with this. Can I take your name?").answerType).toBe("escalated");
  });
  it("reports lookups with the record status", () => {
    expect(classifyTurn([{ name: "lookup_transaction", input: { transaction_id: "TXN-9001" }, result: { found: true, transaction_id: "TXN-9001", status: "processing" } }], "It's processing.")).toEqual({
      answerType: "lookup",
      confidence: "high",
      note: "lookup_transaction: TXN-9001 processing",
    });
  });
});
