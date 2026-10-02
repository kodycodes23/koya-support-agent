import { getSession } from "../../lib/session";
import { getCallIdentityToken } from "../../lib/call-identity";
import { z } from "zod";

/**
 * Website chat → Koya's agent server. The browser never sees the agent server's address or secret:
 * this route adds them, plus the signed-in customer's identity token when there is a session, and
 * streams Koya's reply straight back (OpenAI-style server-sent events).
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  sessionId: z.uuid(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(60),
});

// Per-IP limit: the chat is public, so cap how fast one visitor can send.
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const agentUrl = (process.env.KOYA_AGENT_URL || "http://localhost:8080").replace(/\/+$/, "");
  const secret = process.env.VAPI_LLM_SECRET;
  if (!secret) return Response.json({ error: "Chat isn't configured on this server." }, { status: 503 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return Response.json({ error: "You're sending messages too quickly. Please wait a moment." }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That message couldn't be sent." }, { status: 400 });

  const identityToken = (await getSession()) ? await getCallIdentityToken() : null;
  const upstream = await fetch(`${agentUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "koya",
      stream: true,
      messages: parsed.data.messages,
      metadata: { chatSessionId: parsed.data.sessionId, ...(identityToken ? { identityToken } : {}) },
    }),
    signal: request.signal,
  }).catch((err: unknown) => {
    console.error(JSON.stringify({ level: "error", msg: "chat upstream failed", error: (err as Error).message }));
    return null;
  });
  if (!upstream?.ok || !upstream.body) {
    return Response.json({ error: "Koya isn't available right now. Please try again in a moment." }, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
