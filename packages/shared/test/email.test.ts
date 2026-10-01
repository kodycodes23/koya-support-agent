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
