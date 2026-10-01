"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "./db";
import { adminCredentials, createAdminSession, deleteAdminSession, getAdminSession, sameSecret } from "./admin-session";

export interface AdminLoginState {
  error?: string;
  username?: string;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > MAX_ATTEMPTS;
}

export async function adminLogin(_prev: AdminLoginState, formData: FormData): Promise<AdminLoginState> {
  const username = String(formData.get("username") ?? "").trim().slice(0, 100);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  if (!username || !password) return { error: "Enter the admin username and password.", username };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (throttled(ip)) return { error: "Too many sign-in attempts. Please wait a few minutes and try again.", username };

  const creds = adminCredentials();
  if (!creds) return { error: "Admin sign-in isn't set up on this server (ADMIN_PASSWORD is missing).", username };
  // Both checks always run, so timing doesn't reveal which one failed.
  const ok = [sameSecret(username.toLowerCase(), creds.username.toLowerCase()), sameSecret(password, creds.password)].every(Boolean);
  if (!ok) return { error: "Username or password is incorrect.", username };

  await createAdminSession(creds.username);
  redirect("/admin");
}

export async function adminLogout(): Promise<void> {
  await deleteAdminSession();
  redirect("/admin/login");
}

const statusSchema = z.object({
  kind: z.enum(["escalation", "ticket"]),
  id: z.uuid(),
  status: z.enum(["open", "pending", "closed"]),
  back: z.string().regex(/^\/admin(\?[\w=&%.-]*)?$/).catch("/admin"),
});

/** Sets a case's status. Server actions are public endpoints, so the admin session is checked here. */
export async function setCaseStatus(formData: FormData): Promise<void> {
  const admin = await getAdminSession();
  if (!admin) redirect("/admin/login");
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin?error=invalid");
  const { kind, id, status, back } = parsed.data;

  const table = kind === "escalation" ? "escalations" : "support_tickets";
  const refColumn = kind === "escalation" ? "escalation_ref" : "ticket_ref";
  const { data, error } = await db().from(table).update({ status }).eq("id", id).select(`${refColumn}, conversation_id`).maybeSingle();
  const withParam = (key: string, value: string) => `${back}${back.includes("?") ? "&" : "?"}${key}=${value}`;
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "case status update failed", table, error: error.message, code: error.code }));
    // 23514: check constraint. "pending" needs migration 20261001000005.
    redirect(withParam("error", error.code === "23514" ? "pending-migration" : "update-failed"));
  }
  if (data) {
    const ref = data[refColumn as keyof typeof data] as string;
    await db()
      .from("conversation_events")
      .insert({
        conversation_id: data.conversation_id ?? null,
        event_type: "case_status_changed",
        summary: `${ref} marked ${status} by ${admin.username}`,
        metadata: { ref, status, by: admin.username },
      })
      .then(({ error: e }) => e && console.error(JSON.stringify({ level: "warn", msg: "status audit event failed", error: e.message })));
  }
  revalidatePath("/admin");
  redirect(back);
}
