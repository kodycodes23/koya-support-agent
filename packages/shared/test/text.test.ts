import { describe, expect, it } from "vitest";
import { SpokenStream, maskSensitive, sanitizeSpoken, writtenReferences, typedFieldOf, typedValues } from "../src/text.ts";

function streamed(fragments: string[]) {
  const s = new SpokenStream();
  return fragments.map((f) => s.push(f)).join("") + s.flush();
}

describe("SpokenStream", () => {
  it("keeps numbers that happen to start a fragment", () => {
    expect(streamed(["Your ticket number is TKT-1", "001. The team will follow up."])).toBe(
      "Your ticket number is TKT-1001. The team will follow up.",
    );
  });
  it("strips list markers and headings only at real line starts", () => {
    expect(streamed(["## Fees\n- corridor", "\n2. method and 3. more"])).toBe("Fees\ncorridor\nmethod and 3. more");
  });
  it("removes URLs and markdown even when split across fragments", () => {
    expect(streamed(["See https://relay", "pay.example/fees for **details** "])).toBe("See  for details ");
    expect(streamed(["Read [the ", "guide](https://x.y) now"])).toBe("Read the guide now");
  });
  it("matches sanitizeSpoken on whole text", () => {
    expect(sanitizeSpoken("1. First\n* second 🙂")).toBe("First\nsecond ");
  });
});

describe("maskSensitive", () => {
  it("masks emails but keeps the domain", () => {
    expect(maskSensitive({ user_email: "efua@accrastack.example", reason: "x" })).toEqual({ user_email: "***@accrastack.example", reason: "x" });
  });
});

describe("writtenReferences", () => {
  it.each([
    ["Your ticket number is T K T, one zero three five.", "Your ticket number is TKT-1035."],
    ["Your ticket number is TKT 1035 and we'll follow up.", "Your ticket number is TKT-1035 and we'll follow up."],
    ["Reference p a y seven zero zero two is on hold", "Reference PAY-7002 is on hold"],
    ["Escalation E S C, five zero three three.", "Escalation ESC-5033."],
    ["Already written TKT-1035 stays the same.", "Already written TKT-1035 stays the same."],
  ])("%s", (input, expected) => {
    expect(writtenReferences(input)).toBe(expected);
  });
  it("leaves ordinary words and other numbers alone", () => {
    expect(writtenReferences("You pay one two three times a year")).toBe("You pay one two three times a year"); // references have 4 digits
    expect(writtenReferences("Fees are shown before you confirm.")).toBe("Fees are shown before you confirm.");
  });
});

describe("typed input during a voice call", () => {
  it("reads every typed value from a caller message", () => {
    expect(typedValues("My name is Chi Kodi [typed name] Chikodi Agorua")).toEqual([{ field: "name", value: "Chikodi Agorua" }]);
    expect(typedValues("[typed email] kosi@example.com [typed reference] TXN-9001")).toEqual([
      { field: "email", value: "kosi@example.com" },
      { field: "reference", value: "TXN-9001" },
    ]);
    expect(typedValues("no typing here")).toEqual([]);
  });
  it("tells names, emails and references apart by shape", () => {
    expect(typedFieldOf("Kosisochukwu Nebolisa")).toBe("name");
    expect(typedFieldOf("kosi.nebolisa@example.com")).toBe("email");
    expect(typedFieldOf("pay 7001")).toBe("reference");
  });
});
