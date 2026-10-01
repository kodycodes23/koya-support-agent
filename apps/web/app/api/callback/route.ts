import { emailConfigFromEnv, notifySupportTeam } from "@koya/shared/email";
import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { getSession } from "../../lib/session";
import { z } from "zod";

/**
 * "Prefer a callback?" form → a row in `escalations`, the same table Koya writes to
 * during calls. Runs on the server only; the service-role key never reaches the browser.
 */
export const runtime = "nodejs";

const TOPICS = { payments: "payment", account: "account", other: "other" } as const;

const DETAILS_MIN = 10;
const DETAILS_MAX = 500;

const bodySchema = z
  .object({
    name: z.string().trim().min(2, "Please enter your name.").max(120),
    email: z.email("Please enter a valid email address.").max(200),
    topic: z.enum(["payments", "account", "other"]),
    // Required for "Something else": the topic alone tells the specialist nothing.
    details: z.string().trim().max(DETAILS_MAX, `Please keep the description under ${DETAILS_MAX} characters.`).optional(),
    preferredTime: z.string().trim().max(120).optional(),
    // Honeypot: hidden from people, often filled in by bots.
    company: z.string().max(500).optional(),
  })
  .refine((b) => b.topic !== "other" || (b.details?.length ?? 0) >= DETAILS_MIN, {
    message: "Please tell us a little more about the problem (at least 10 characters).",
    path: ["details"],
  });

// Simple per-IP limit so the public form can't be used to flood the table.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  // Only signed-in customers can request a callback (the form lives on the sign-in-only /support page).
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Please sign in to request a callback." }, { status: 401 });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ error: "Callback requests are not configured on this server." }, { status: 503 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return Response.json({ error: "Too many requests. Please try again in a few minutes." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Please check the form." }, { status: 400 });
  }
  const { name, email, topic, details, preferredTime, company } = parsed.data;
  if (company) return Response.json({ ok: true, reference: null }); // quietly drop bot submissions

  const firstName = name.split(/\s+/)[0];
  const followUp = preferredTime
    ? `A RelayPay specialist will call ${firstName} back around ${preferredTime} and follow up by email.`
    : `A RelayPay specialist will follow up with ${firstName} by email.`;

  const db = createClient(new URL(url).origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from("escalations")
    .insert({
      user_name: name,
      user_email: email.toLowerCase(),
      category: TOPICS[topic],
      customer_id: session.customerId,
      reason: details ? `Callback requested from the support page: ${details}` : "Callback requested from the support page.",
      call_booked: Boolean(preferredTime),
      preferred_time: preferredTime || null,
      follow_up_summary: followUp,
    })
    .select("escalation_ref")
    .single();

  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "callback insert failed", error: error.message }));
    return Response.json({ error: "We couldn't save your request. Please try again." }, { status: 500 });
  }

  // Email the support team once the response has been sent; a failure never affects the request.
  const reference = data.escalation_ref as string;
  after(async () => {
    try {
      const { data: customer } = await db.from("customers").select("company_name").eq("customer_id", session.customerId).maybeSingle();
      const id = await notifySupportTeam(emailConfigFromEnv(), {
        reference,
        source: "callback-form",
        category: TOPICS[topic],
        reason: details || "Callback requested from the support page.",
        userName: name,
        userEmail: email.toLowerCase(),
        customerId: session.customerId,
        company: (customer?.company_name as string | undefined) ?? null,
        preferredTime: preferredTime || null,
        followUp,
      });
      console.log(JSON.stringify({ level: id === null ? "warn" : "info", msg: id === null ? "RESEND_API_KEY not set: support-team email skipped" : "support team emailed", reference, emailId: id }));
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "support-team email failed (request is still recorded)", reference, error: (err as Error).message }));
    }
  });
  return Response.json({ ok: true, reference: data.escalation_ref as string, message: followUp });
}
