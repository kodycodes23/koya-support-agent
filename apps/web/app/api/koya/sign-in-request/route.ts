import { db } from "../../../lib/db";

/**
 * During a guest voice call the page asks here whether Koya has asked the caller to sign in
 * (request_sign_in). Answers only yes or no for a call id, nothing about the conversation.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return Response.json({ requested: false });
  try {
    const { data: convo } = await db().from("conversations").select("id, verified_customer_id").eq("vapi_call_id", callId).maybeSingle();
    if (!convo || convo.verified_customer_id) return Response.json({ requested: false });
    const { count } = await db()
      .from("conversation_events")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", convo.id)
      .eq("event_type", "sign_in_requested");
    return Response.json({ requested: (count ?? 0) > 0 }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ requested: false });
  }
}
