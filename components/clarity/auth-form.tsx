"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Mail } from "lucide-react";

import { useCurrentUser } from "@/components/current-user";
import { LogoMark } from "@/components/logo";
import { SignIn as MagicLinkSignIn } from "@/components/sign-in";

type Mode = "signup" | "signin" | "code";

/**
 * Account access for the main UI.
 *
 * Sign-up collects a name, an email and a password, and hands all three to the
 * `password` provider in one call — the name is stored on the user row, so the
 * account is not an anonymous entry that only later learns who owns it.
 *
 * The emailed-code flow is kept and reachable from here. It is the way back in
 * for someone who has forgotten a password, and it is the flow that proves
 * control of the address.
 */
export function AuthForm({ initialMode = "signup" }: { initialMode?: Mode }) {
  const { signIn } = useAuthActions();
  const { isSignedIn, isLoading: authLoading } = useCurrentUser();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in: the form has nothing left to do.
  useEffect(() => {
    if (!authLoading && isSignedIn) router.replace("/case");
  }, [authLoading, isSignedIn, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      if (mode === "signup") {
        await signIn("password", { email, password, name, flow: "signUp" });
      } else {
        await signIn("password", { email, password, flow: "signIn" });
      }
      router.replace("/case");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That did not work. Check your details and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (mode === "code") return <MagicLinkSignIn />;

  const signingUp = mode === "signup";

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-5 py-16 sm:px-8">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <LogoMark className="size-5" />
      </span>

      <h1 className="mt-5 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-foreground">
        {signingUp ? "Create your account" : "Sign in to Clawback"}
      </h1>
      <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
        {signingUp
          ? "Your cases belong to your account. Create it with your name, email and a password."
          : "Welcome back. Enter your email and password."}
      </p>

      <form
        onSubmit={submit}
        className="mt-7 rounded-xl border border-border bg-card px-5 py-5 shadow-flat"
      >
        <div className="space-y-4">
          {signingUp ? (
            <div>
              <label
                htmlFor="auth-name"
                className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Name
              </label>
              <input
                id="auth-name"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors focus:border-accent"
              />
            </div>
          ) : null}

          <div>
            <label
              htmlFor="auth-email"
              className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors focus:border-accent"
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              name="password"
              autoComplete={signingUp ? "new-password" : "current-password"}
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors focus:border-accent"
            />
            {signingUp ? (
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                At least 8 characters.
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Mail size={15} aria-hidden="true" />
            {busy
              ? signingUp
                ? "Creating account…"
                : "Signing in…"
              : signingUp
                ? "Create account"
                : "Sign in"}
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-xs leading-5 text-destructive">
            {error}
          </p>
        ) : null}
      </form>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
        <button
          type="button"
          onClick={() => {
            setMode(signingUp ? "signin" : "signup");
            setError(null);
          }}
          className="font-medium text-accent underline-offset-2 transition-colors hover:underline"
        >
          {signingUp ? "I already have an account" : "Create an account"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("code");
            setError(null);
          }}
          className="font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Email me a code instead
        </button>
      </div>

      <p className="mt-5 text-[11px] leading-5 text-muted-foreground">
        Clawback never asks for your landlord&apos;s details or your bank login.{" "}
        <Link href="/" className="underline-offset-2 hover:underline">
          Back to start
        </Link>
      </p>
    </div>
  );
}
