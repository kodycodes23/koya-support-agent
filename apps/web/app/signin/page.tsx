import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../lib/session";
import { LoginForm } from "../login-form";

export const metadata: Metadata = {
  title: "Sign in · RelayPay",
  description: "Sign in to your RelayPay business account.",
};

function FlowLines() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 600 800" preserveAspectRatio="none" fill="none" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => {
        const x = 180 + i * 48;
        return (
          <path
            key={i}
            d={`M${x - 120} 820 C ${x - 60} 620, ${x + 60} 520, ${x + 10} 360 S ${x + 80} 90, ${x + 220} -20`}
            stroke="#5cc6dc"
            strokeOpacity={0.1 + i * 0.03}
            strokeWidth="1.4"
          />
        );
      })}
    </svg>
  );
}

export default async function LoginPage({ searchParams }: PageProps<"/signin">) {
  if (await getSession()) redirect("/dashboard");
  const idleSignOut = (await searchParams)["signed-out"] === "idle";

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="dot-grid relative hidden overflow-hidden bg-navy text-on-navy lg:block">
        <FlowLines />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link href="/" className="flex items-center gap-2.5" aria-label="RelayPay home">
            <Image src="/relaypay-mark.svg" alt="" width={34} height={34} priority />
            <span className="text-lg font-semibold tracking-tight">RelayPay</span>
          </Link>
          <div>
            <h1 className="text-5xl font-semibold uppercase leading-[0.95] tracking-tight">
              Move money
              <br />
              across
              <br />
              borders
            </h1>
            <p className="mt-6 text-sm uppercase tracking-[0.35em] text-on-navy-muted">
              Payments · invoices · <span className="border-b-2 border-accent-on-navy pb-1 text-on-navy">payouts</span>
            </p>
            <p className="mt-8 max-w-sm text-sm leading-6 text-on-navy-muted">
              One dashboard for international payments, multi-currency invoices and contractor payouts, with Koya on hand when you
              need support.
            </p>
          </div>
          <p className="text-xs text-on-navy-muted">© {new Date().getFullYear()} RelayPay</p>
        </div>
      </section>

      {/* Sign-in form */}
      <main className="relative flex items-center justify-center px-4 py-16 sm:px-6">
        <Link href="/" className="absolute left-4 top-5 flex items-center gap-2.5 sm:left-6 lg:hidden" aria-label="RelayPay home">
          <Image src="/relaypay-mark.svg" alt="" width={30} height={30} priority />
          <Image src="/relaypay-wordmark.svg" alt="RelayPay" width={104} height={14} priority />
        </Link>
        <div className="w-full max-w-sm">
          <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">
            <span aria-hidden className="opacity-60">[</span>Business account<span aria-hidden className="opacity-60">]</span>
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-text">Sign in</h2>
          <p className="mt-2 text-sm text-muted">Use the email address on your account.</p>
          {idleSignOut && (
            <p className="mt-6 rounded-md bg-accent-soft px-3 py-2 text-sm text-brand" role="status">
              You were signed out after 10 minutes of inactivity. Sign in again to continue.
            </p>
          )}

          <div className="mt-8">
            <LoginForm />
          </div>

          <p className="mt-4 text-center text-sm text-muted">
            Not a customer yet?{" "}
            <Link href="/support" className="font-medium text-accent hover:underline">
              Talk to Koya as a guest
            </Link>
          </p>

          <div className="mt-6 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-border" />
            RelayPay staff
            <span className="h-px flex-1 bg-border" />
          </div>
          <Link
            href="/admin/login"
            className="mt-4 flex h-11 w-full items-center justify-center rounded-md border border-border bg-surface text-sm font-medium text-text hover:border-accent hover:text-accent"
          >
            Sign in as admin
          </Link>

        </div>
      </main>
    </div>
  );
}
