/**
 * Support-team notification emails, sent through Resend's HTTP API.
 *
 * Self-contained (no other imports) so both the MCP server and the web app can use it via
 * "@koya/shared/email". Everything a caller typed is HTML-escaped before it reaches the
 * template. Styling follows the brand direction: deep blue, teal accent, off-white, flat,
 * minimal, and email-client safe (tables and inline styles only, no images or web fonts).
 */

export interface EmailConfig {
  apiKey: string;
  from: string;
  to: string;
}

/** Reads email settings from the environment; null (sending disabled) when the API key is missing. */
export function emailConfigFromEnv(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const to = env.SUPPORT_TEAM_EMAIL?.trim();
  // Never send real email from test runs, even if a key is present in .env.
  if (!apiKey || !to || env.VITEST || env.NODE_ENV === "test") return null;
  return {
    apiKey,
    // Resend's free plan can only send from its shared address until a domain is verified.
    from: env.EMAIL_FROM?.trim() || "RelayPay Support <onboarding@resend.dev>",
    to,
  };
}

export interface EscalationEmail {
  reference: string;
  source: "voice" | "callback-form";
  category: string;
  reason: string;
  userName: string;
  userEmail: string;
  customerId?: string | null;
  company?: string | null;
  preferredTime?: string | null;
  followUp?: string | null;
  conversationId?: string | null;
  createdAt?: Date;
  /** Account snapshot at the time of the escalation. */
  account?: { plan: string; status: string; kyc: string } | null;
  /** What Koya looked up on the call, with the results. */
  checks?: string[];
  /** The conversation up to the escalation (most recent last). */
  transcript?: { speaker: "Caller" | "Koya"; text: string }[];
  /** Set when an open case is reused because the customer got in touch again about it. */
  repeatContact?: { openedAt: Date } | null;
  /** "ticket" for a support ticket (follow-up work, no callback); default "escalation". */
  caseType?: "escalation" | "ticket";
  /** Ticket priority (low, medium, high, urgent). */
  priority?: string | null;
}

const BRAND = {
  navy: "#0a2150",
  text: "#16202e",
  muted: "#5b6676",
  border: "#e2e5ea",
  background: "#f4f6f9",
  surface: "#ffffff",
  accent: "#0891b2",
  accentSoft: "#e6f4f8",
  font: "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

const CATEGORY_LABEL: Record<string, string> = {
  compliance: "Compliance",
  account: "Account",
  dispute: "Dispute",
  payment: "Payment",
  payout: "Payout",
  invoice: "Invoice",
  technical: "Technical",
  onboarding: "Onboarding (new customer)",
  other: "Other",
};

function sectionTitle(title: string): string {
  return `<p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.muted};">${escapeHtml(title)}</p>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d) + " UTC";
}

/** Subject, HTML and plain-text bodies for a new escalation, callback request or support ticket. */
export function renderEscalationEmail(e: EscalationEmail): { subject: string; html: string; text: string } {
  const category = CATEGORY_LABEL[e.category] ?? e.category;
  const ticket = e.caseType === "ticket";
  const priority = e.priority ? e.priority.charAt(0).toUpperCase() + e.priority.slice(1) : null;
  // Koya can book a callback during a call (an escalation with a preferred time) or escalate without one.
  const kind = e.repeatContact
    ? "Repeat contact"
    : ticket
      ? `Support ticket${priority ? ` (${priority} priority)` : ""}`
      : e.source === "callback-form"
        ? "Callback request"
        : e.preferredTime
          ? "Callback booked on a Koya call"
          : "Escalation from a Koya call";
  const who = `${e.userName || "A caller"}${e.company ? ` from ${e.company}` : ""}`;
  const heading = e.repeatContact
    ? `${e.reference}: the customer got in touch again`
    : ticket
      ? `${e.reference} needs follow-up`
      : `${e.reference} needs a specialist`;
  const intro = e.repeatContact
    ? `${who} contacted us again about this open case. No new case was created. Details are below.`
    : ticket
      ? `${who} reported an issue on a Koya call that needs follow-up from the support team. Details are below.`
      : `${who} is waiting for a follow-up. Details are below.`;
  const summaryLabel = e.repeatContact ? "What they said this time" : ticket ? "Summary" : "Reason";
  const when = formatDate(e.createdAt ?? new Date());
  const subject = `${e.reference} · ${kind}${e.company ? ` · ${e.company}` : ""}`;

  const rows: [string, string][] = [
    ["Customer", [e.userName, e.company].filter(Boolean).join(" · ") || "Not identified on the call"],
    ...(e.userEmail ? ([["Email", e.userEmail]] as [string, string][]) : []),
    ...(e.customerId ? ([["Customer ID", e.customerId]] as [string, string][]) : []),
    ["Category", category],
    ...(priority ? ([["Priority", priority]] as [string, string][]) : []),
    ...(ticket ? [] : ([["Preferred callback", e.preferredTime || "Not specified"]] as [string, string][])),
    ["Source", e.source === "voice" ? "Voice call with Koya" : "Callback form on the support page"],
    ...(e.repeatContact ? ([["Case opened", formatDate(e.repeatContact.openedAt)]] as [string, string][]) : []),
    [e.repeatContact ? "Contacted again" : "Logged", when],
    ...(e.conversationId ? ([["Conversation", e.conversationId]] as [string, string][]) : []),
  ];

  const rowHtml = rows
    .map(
      ([label, value], i) => `
        <tr>
          <td style="padding:12px 0;${i ? `border-top:1px solid ${BRAND.border};` : ""}width:38%;font-size:13px;color:${BRAND.muted};vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:12px 0;${i ? `border-top:1px solid ${BRAND.border};` : ""}font-size:14px;color:${BRAND.text};vertical-align:top;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.background};font-family:${BRAND.font};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(`${kind}: ${e.reason}`.slice(0, 140))}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.background};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:${BRAND.navy};padding:22px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:18px;font-weight:600;letter-spacing:-0.01em;color:#ffffff;">RelayPay</td>
                  <td align="right" style="font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#5cc6dc;">Support team</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px;">
              <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.accent};">[ ${escapeHtml(kind)} ]</p>
              <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.01em;color:${BRAND.text};">${escapeHtml(heading)}</h1>
              <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(intro)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.accentSoft};border-left:3px solid ${BRAND.accent};border-radius:6px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.accent};">${summaryLabel}</p>
                    <p style="margin:6px 0 0;font-size:14px;line-height:1.6;color:${BRAND.text};white-space:pre-wrap;">${escapeHtml(e.reason)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}
              </table>
            </td>
          </tr>
          ${
            e.account
              ? `<tr>
            <td style="padding:8px 32px 0;">
              ${sectionTitle("Account")}
              <p style="margin:0;font-size:14px;line-height:1.6;color:${BRAND.text};">${escapeHtml(`${e.account.plan} plan · account ${e.account.status} · verification ${e.account.kyc}`)}</p>
            </td>
          </tr>`
              : ""
          }
          ${
            e.checks?.length
              ? `<tr>
            <td style="padding:16px 32px 0;">
              ${sectionTitle("What Koya checked")}
              ${e.checks.map((c) => `<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:${BRAND.text};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(c)}</p>`).join("")}
            </td>
          </tr>`
              : ""
          }
          ${
            e.transcript?.length
              ? `<tr>
            <td style="padding:16px 32px 0;">
              ${sectionTitle("Conversation so far")}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BRAND.border};border-radius:6px;">
                ${e.transcript
                  .map(
                    (t, i) => `<tr>
                  <td style="padding:10px 14px;${i ? `border-top:1px solid ${BRAND.border};` : ""}width:64px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;vertical-align:top;color:${t.speaker === "Koya" ? BRAND.accent : BRAND.muted};">${t.speaker}</td>
                  <td style="padding:10px 14px 10px 0;${i ? `border-top:1px solid ${BRAND.border};` : ""}font-size:13px;line-height:1.6;color:${BRAND.text};">${escapeHtml(t.text)}</td>
                </tr>`,
                  )
                  .join("")}
              </table>
            </td>
          </tr>`
              : ""
          }
          ${
            e.followUp
              ? `<tr>
            <td style="padding:8px 32px 0;">
              <p style="margin:0;padding:14px 16px;border:1px solid ${BRAND.border};border-radius:6px;font-size:13px;line-height:1.6;color:${BRAND.muted};"><strong style="color:${BRAND.text};font-weight:600;">Promised to the customer:</strong> ${escapeHtml(e.followUp)}</p>
            </td>
          </tr>`
              : ""
          }
          <tr>
            <td style="padding:28px 32px 32px;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">Sent automatically by Koya, RelayPay's voice support assistant.${e.userEmail ? ` Reply to the customer directly at <span style="color:${BRAND.text};">${escapeHtml(e.userEmail)}</span>.` : ""} Don't forward this email outside the support team.</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:${BRAND.muted};">RelayPay · Support operations</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${kind}: ${e.reference}`,
    "",
    intro,
    "",
    `${summaryLabel}: ${e.reason}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(e.account ? ["", `Account: ${e.account.plan} plan · account ${e.account.status} · verification ${e.account.kyc}`] : []),
    ...(e.checks?.length ? ["", "What Koya checked:", ...e.checks.map((c) => `- ${c}`)] : []),
    ...(e.transcript?.length ? ["", "Conversation so far:", ...e.transcript.map((t) => `${t.speaker}: ${t.text}`)] : []),
    ...(e.followUp ? ["", `Promised to the customer: ${e.followUp}`] : []),
    "",
    "Sent automatically by Koya, RelayPay's voice support assistant.",
  ].join("\n");

  return { subject, html, text };
}

/** Sends one email through Resend. Throws on failure; callers decide whether that matters. */
export async function sendEmail(config: EmailConfig, msg: { subject: string; html: string; text: string; replyTo?: string }): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: config.from,
      to: [config.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? "request failed"}`);
  return body.id ?? "";
}

/** Renders and sends the support-team notification for an escalation or ticket. */
export async function notifySupportTeam(config: EmailConfig | null, e: EscalationEmail): Promise<string | null> {
  if (!config) return null;
  return sendEmail(config, { ...renderEscalationEmail(e), ...(e.userEmail ? { replyTo: e.userEmail } : {}) });
}
