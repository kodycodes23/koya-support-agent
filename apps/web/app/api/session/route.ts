import { refreshSession } from "../../lib/session";

/**
 * Keep-alive from `IdleTimeout` while the customer is active: slides the session's idle expiry.
 * A Route Handler rather than a Server Action, because setting a cookie in a Server Action
 * re-renders the current page.
 */
export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return new Response(null, { status: (await refreshSession()) ? 204 : 401 });
}
