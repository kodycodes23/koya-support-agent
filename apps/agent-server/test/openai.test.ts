import { describe, expect, it } from "vitest";
import { chatRequestSchema, splitConversation } from "../src/routes/openai.ts";
import { statusFromEndedReason } from "../src/routes/vapi.ts";

describe("splitConversation", () => {
  it("takes the newest user message and builds a transcript without system prompts", () => {
    const { userText, transcript } = splitConversation(
      chatRequestSchema.parse({
        messages: [
          { role: "system", content: "vapi system prompt" },
          { role: "assistant", content: "Hi, I'm Koya." },
          { role: "user", content: "My payment is stuck." },
          { role: "assistant", content: "Is it incoming or outgoing?" },
          { role: "user", content: [{ type: "text", text: "Outgoing." }] },
          { role: "assistant", content: null },
        ],
        call: { id: "abc", extra: true },
        temperature: 0.2,
      }).messages,
    );
    expect(userText).toBe("Outgoing.");
    expect(transcript).toBe("Koya: Hi, I'm Koya.\nCaller: My payment is stuck.\nKoya: Is it incoming or outgoing?");
  });

  it("joins everything the caller said since Koya last spoke (barge-in)", () => {
    const { userText, transcript } = splitConversation([
      { role: "assistant", content: "How can I help?" },
      { role: "user", content: "Check TXN-9001." },
      { role: "user", content: "Actually, it's TXN-9004." },
    ]);
    expect(userText).toBe("Check TXN-9001. Actually, it's TXN-9004.");
    expect(transcript).toBe("Koya: How can I help?");
  });

  it("returns empty text when there is no user utterance", () => {
    expect(splitConversation([{ role: "assistant", content: "Hello" }]).userText).toBe("");
  });
});

describe("statusFromEndedReason", () => {
  it.each([
    ["customer-ended-call", "completed"],
    ["assistant-said-end-call-phrase", "completed"],
    ["pipeline-error-openai-llm-failed", "error"],
    ["customer-did-not-answer", "abandoned"],
    [undefined, "completed"],
  ] as const)("%s -> %s", (reason, status) => {
    expect(statusFromEndedReason(reason)).toBe(status);
  });
});
