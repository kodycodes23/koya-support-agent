import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "../../lib/admin-session";
import { AdminLoginForm } from "./admin-login-form";

export const metadata: Metadata = {
  title: "Admin sign in · RelayPay",
  description: "Sign in to the RelayPay support admin.",
};

export default async function AdminLoginPage() {
  if (await getAdminSession()) redirect("/admin");
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="RelayPay home">
          <Image src="/relaypay-mark.svg" alt="" width={28} height={28} priority />
          <Image src="/relaypay-wordmark.svg" alt="RelayPay" width={98} height={13} priority />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">
            <span aria-hidden className="opacity-60">[</span>Support admin<span aria-hidden className="opacity-60">]</span>
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-text">Admin sign in</h1>
          <p className="mt-2 text-sm text-muted">Review escalations and support tickets.</p>
          <div className="mt-6">
            <AdminLoginForm />
          </div>
          <p className="mt-6 text-center text-sm text-muted">
            <Link href="/signin" className="font-medium text-accent hover:underline">
              Back to customer sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
