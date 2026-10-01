/**
 * Creates or updates the Koya assistant in Vapi so it uses this backend as its "Custom LLM".
 *   pnpm vapi:sync            create/update
 *   pnpm vapi:sync --dry-run  print what would be sent
 *
 * Idempotent: the credential and assistant are found by name and updated in place.
 * Field names follow Vapi's OpenAPI spec (https://api.vapi.ai/api-json):
 *   - model.provider "custom-llm": Vapi uses model.url as an OpenAI baseURL and POSTs {url}/chat/completions
 *   - Authorization for the custom LLM must come from a "custom-llm" credential (sent as a Bearer token)
 *   - server.url receives the server messages listed in serverMessages
 */
import { z } from "zod";
import { loadEnvFiles, optionalString, parseEnv } from "@koya/shared";

loadEnvFiles();
const env = parseEnv(
  z.object({
    VAPI_API_KEY: z.string().min(10, "VAPI_API_KEY (Vapi private key) is required"),
    PUBLIC_AGENT_URL: z
      .url()
      .refine((u) => u.startsWith("https://") && !u.includes("YOUR-SUBDOMAIN"), "PUBLIC_AGENT_URL must be your public https URL (e.g. the ngrok URL)")
      .transform((u) => u.replace(/\/+$/, "")),
    VAPI_LLM_SECRET: z.string().min(16, "VAPI_LLM_SECRET is required"),
    VAPI_WEBHOOK_SECRET: z.string().min(16, "VAPI_WEBHOOK_SECRET is required"),
    VAPI_VOICE_ID: optionalString,
  }),
);

const API = "https://api.vapi.ai";
const ASSISTANT_NAME = "Koya - RelayPay Support";
const CREDENTIAL_NAME = "koya-agent-server";
const dryRun = process.argv.includes("--dry-run");

async function vapi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.VAPI_API_KEY}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vapi ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface Named {
  id: string;
  name?: string;
  provider?: string;
}

async function checkBackend() {
  try {
    const res = await fetch(`${env.PUBLIC_AGENT_URL}/health`, { signal: AbortSignal.timeout(8000) });
    const body = (await res.json()) as { ok?: boolean; model?: string };
    console.log(`✓ backend reachable at ${env.PUBLIC_AGENT_URL} (model ${body.model ?? "?"})`);
  } catch (err) {
    console.warn(`! ${env.PUBLIC_AGENT_URL}/health is not reachable (${(err as Error).message}). Vapi calls will fail until the agent server and tunnel are running.`);
  }
}

async function upsertCredential(): Promise<string> {
  const existing = (await vapi<Named[]>("GET", "/credential")).find((c) => c.provider === "custom-llm" && c.name === CREDENTIAL_NAME);
  if (existing) {
    await vapi("PATCH", `/credential/${existing.id}`, { apiKey: env.VAPI_LLM_SECRET });
    console.log(`✓ updated custom-llm credential ${existing.id}`);
    return existing.id;
  }
  const created = await vapi<Named>("POST", "/credential", { provider: "custom-llm", name: CREDENTIAL_NAME, apiKey: env.VAPI_LLM_SECRET });
  console.log(`✓ created custom-llm credential ${created.id}`);
  return created.id;
}

function assistantBody(credentialId: string) {
  return {
    name: ASSISTANT_NAME,
    firstMessage: "Hi, you're through to RelayPay support. I'm Koya. How can I help you today?",
    model: {
      provider: "custom-llm",
      url: env.PUBLIC_AGENT_URL, // Vapi appends /chat/completions
      model: "koya",
      metadataSendMode: "variable", // includes the `call` object, which keys our conversation records
      timeoutSeconds: 30,
    },
    // Send text to TTS in small chunks so Koya starts speaking on the first short phrase.
    voice: { provider: "vapi", voiceId: env.VAPI_VOICE_ID ?? "Clara", chunkPlan: { enabled: true, minCharacters: 15 } },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
      // Formats spoken emails and references ("agorua dot kody at gmail dot com" → agorua.kody@gmail.com).
      smartFormat: true,
      // Uncommon words the caller is likely to say; improves recognition of these specific terms.
      keyterm: ["RelayPay", "Koya", "LagosLedger", "NairobiOps", "AccraStack", "CapeCloud", "KigaliWorks", "payout", "KYC", "TXN", "PAY"],
    },
    // End-of-turn detection. A fixed silence timer cut callers off mid-spelling (every pause became
    // a new turn), so use Vapi's model-based detection for English and wait longer whenever Koya has
    // just asked for something people spell or read out slowly.
    startSpeakingPlan: {
      waitSeconds: 0.4,
      smartEndpointingPlan: { provider: "livekit" },
      customEndpointingRules: [
        {
          type: "assistant",
          regex: "(email|e-mail|spell|reference|customer id|transaction id|payout id)",
          regexOptions: [{ type: "ignore-case", enabled: true }],
          timeoutSeconds: 2.5,
        },
        {
          // The caller is mid-way through spelling or reading out an address or reference.
          type: "customer",
          regex: "(\\b(at|dot)\\s*$|\\b[a-z]\\s*$|\\d\\s*$)",
          regexOptions: [{ type: "ignore-case", enabled: true }],
          timeoutSeconds: 2,
        },
      ],
    },
    server: {
      url: `${env.PUBLIC_AGENT_URL}/vapi/webhook`,
      headers: { "x-vapi-secret": env.VAPI_WEBHOOK_SECRET },
      timeoutSeconds: 20,
    },
    serverMessages: ["status-update", "end-of-call-report"],
    credentialIds: [credentialId],
    maxDurationSeconds: 900,
  };
}

async function main() {
  await checkBackend();
  if (dryRun) {
    const redacted = assistantBody("<credential-id>");
    redacted.server.headers["x-vapi-secret"] = "<redacted>";
    console.log(JSON.stringify(redacted, null, 2));
    return;
  }
  const credentialId = await upsertCredential();
  const body = assistantBody(credentialId);
  const existing = (await vapi<Named[]>("GET", "/assistant")).find((a) => a.name === ASSISTANT_NAME);
  const assistant = existing
    ? await vapi<Named>("PATCH", `/assistant/${existing.id}`, body)
    : await vapi<Named>("POST", "/assistant", body);
  console.log(`✓ ${existing ? "updated" : "created"} assistant "${ASSISTANT_NAME}"`);
  console.log(`\nAssistant ID: ${assistant.id}`);
  console.log(`\nNext: put these in apps/web/.env.local, then restart the web app:`);
  console.log(`  NEXT_PUBLIC_VAPI_PUBLIC_KEY=<your Vapi public key>`);
  console.log(`  NEXT_PUBLIC_VAPI_ASSISTANT_ID=${assistant.id}`);
}

main().catch((err: unknown) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
