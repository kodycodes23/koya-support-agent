import { describe, expect, it } from "vitest";
import { emailConfigFromEnv, renderEscalationEmail } from "../src/email.ts";

const base = {
  reference: "ESC-5040",
  category: "compliance",
  reason: "Payout PAY-7002 on hold pending review.",
  userName: "Efua Mensah",
  userEmail: "efua@accrastack.example",
  customerId: "CUS-1003",
  company: "AccraStack",
  createdAt: new Date("2026-10-01T09:30:00Z"),
};

describe("renderEscalationEmail", () => {
  it("labels the three kinds of request", () => {
    expect(renderEscalationEmail({ ...base, source: "voice", preferredTime: "Tomorrow 10am" }).subject).toBe("ESC-5040 · Callback booked on a Koya call · AccraStack");
    expect(renderEscalationEmail({ ...base, source: "voice" }).subject).toBe("ESC-5040 · Escalation from a Koya call · AccraStack");
    expect(renderEscalationEmail({ ...base, source: "callback-form" }).subject).toBe("ESC-5040 · Callback request · AccraStack");
  });

  it("escapes anything the caller typed", () => {
    const { html, text } = renderEscalationEmail({ ...base, source: "callback-form", reason: '<script>alert("x")</script> & <b>hi</b>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;b&gt;hi&lt;/b&gt;");
    expect(text).toContain('<script>alert("x")</script>'); // plain text needs no escaping
  });

  it("includes the details the support team needs", () => {
    const { html } = renderEscalationEmail({ ...base, source: "voice", preferredTime: "Tomorrow 10am" });
    for (const s of ["Efua Mensah", "AccraStack", "efua@accrastack.example", "CUS-1003", "Compliance", "Tomorrow 10am", "Voice call with Koya"]) expect(html).toContain(s);
  });
});

describe("emailConfigFromEnv", () => {
  it("is disabled without a key, and during tests even with one", () => {
    expect(emailConfigFromEnv({})).toBeNull();
    expect(emailConfigFromEnv({ RESEND_API_KEY: "re_x", VITEST: "true" })).toBeNull();
  });
  it("needs a recipient, and defaults to Resend's shared sender", () => {
    expect(emailConfigFromEnv({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(emailConfigFromEnv({ RESEND_API_KEY: "re_x", SUPPORT_TEAM_EMAIL: "team@example.com" })).toEqual({
      apiKey: "re_x",
      from: "RelayPay Support <onboarding@resend.dev>",
      to: "team@example.com",
    });
  });
});

describe("ticket emails", () => {
  const ticket = {
    reference: "TKT-1046",
    source: "voice" as const,
    caseType: "ticket" as const,
    priority: "medium",
    category: "technical",
    reason: "Dashboard shows a blank error when Amara tries to make any transfer.",
    userName: "Amara Okafor",
    userEmail: "amara@lagosledger.example",
    company: "LagosLedger",
  };

  it("labels the ticket, its priority and summary, with no callback row", () => {
    const { subject, html, text } = renderEscalationEmail(ticket);
    expect(subject).toBe("TKT-1046 · Support ticket (Medium priority) · LagosLedger");
    expect(html).toContain("TKT-1046 needs follow-up");
    expect(text).toContain("Summary: Dashboard shows a blank error");
    expect(text).toContain("Priority: Medium");
    expect(text).toContain("Category: Technical");
    expect(text).not.toContain("Preferred callback");
  });

  it("handles a caller who was never identified", () => {
    const { html, text } = renderEscalationEmail({ ...ticket, userName: "", userEmail: "", company: null });
    expect(text).toContain("A caller reported an issue");
    expect(text).toContain("Customer: Not identified on the call");
    expect(text).not.toContain("Email:");
    expect(html).not.toContain("Reply to the customer directly");
  });
});
