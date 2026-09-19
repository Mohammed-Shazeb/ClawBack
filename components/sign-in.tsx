"use client";

import { FormEvent, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Mail, ShieldCheck } from "lucide-react";

import { AppShell } from "./app-shell";
import { Panel } from "./ui/primitives";

/**
 * Sign-in, by emailed code.
 *
 * Two steps, and the second one is the point: the first call only *asks* for a
 * code, so it can be repeated freely without proving anything. Nothing about the
 * caller is believed until the second call carries a code that matches the
 * address — the provider's own `authorize` checks that the verifying call
 * presents the same address that started it, so a code leaked for one address
 * cannot be redeemed against another.
 *
 * The code is entered rather than the link followed, for a practical reason: the
 * link opens a browser, and the session has to end up in *this* one. The message
 * carries both, so either works — but the code path is the one that always does.
 */
export function SignIn() {
  const { signIn } = useAuthActions();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      if (!awaitingCode) {
        await signIn("email", { email });
        setAwaitingCode(true);
      } else {
        await signIn("email", { email, code });
        // On success the session lands and this component unmounts — the gate
        // above swaps it for the workspace. Nothing to do here.
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That did not work. Check the code and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex max-w-md flex-col justify-center px-5 py-16 sm:px-8">
        <span className="flex size-10 items-center justify-center rounded-md bg-accent text-white">
          <ShieldCheck size={19} aria-hidden="true" />
        </span>

        <h1 className="mt-5 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink">
          {awaitingCode ? "Enter your code" : "Sign in to Clawback"}
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-secondary">
          {awaitingCode
            ? `We sent a six-digit code to ${email}. It expires in one hour.`
            : "Your cases belong to your account. Sign in with your email address to open them."}
        </p>

        <Panel as="div" className="mt-7 px-5 py-5">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label
                htmlFor="sign-in-email"
                className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted"
              >
                Email address
              </label>
              <input
                id="sign-in-email"
                type="email"
                name="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                // Locked once a code is outstanding: the provider requires the
                // verifying call to carry the same address, so letting it change
                // here would only produce a confusing failure.
                readOnly={awaitingCode}
                className="mt-2 h-10 w-full rounded-md border border-line bg-surface px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent read-only:bg-surface-muted read-only:text-ink-secondary"
              />
            </div>

            {awaitingCode ? (
              <div>
                <label
                  htmlFor="sign-in-code"
                  className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted"
                >
                  Code from the email
                </label>
                <input
                  id="sign-in-code"
                  name="code"
                  required
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="tabular mt-2 h-10 w-full rounded-md border border-line bg-surface px-3 text-[15px] tracking-[0.2em] text-ink outline-none transition-colors focus:border-accent"
                />
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Mail size={15} aria-hidden="true" />
              {busy
                ? awaitingCode
                  ? "Verifying…"
                  : "Sending…"
                : awaitingCode
                  ? "Verify and sign in"
                  : "Email me a sign-in code"}
            </button>
          </form>

          {error ? (
            <p className="mt-4 rounded-md border border-danger-line bg-danger-soft px-3.5 py-3 text-xs leading-5 text-danger">
              {error}
            </p>
          ) : null}

          {awaitingCode ? (
            <button
              type="button"
              onClick={() => {
                setAwaitingCode(false);
                setCode("");
                setError(null);
              }}
              className="mt-4 text-xs font-medium text-ink-secondary underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              Use a different address
            </button>
          ) : null}
        </Panel>

        <p className="mt-5 text-[11px] leading-5 text-ink-muted">
          Clawback never asks for your landlord&apos;s details or your bank login. It reads the
          deposit statement you send it and drafts a dispute you approve before anything leaves.
        </p>
      </div>
    </AppShell>
  );
}
