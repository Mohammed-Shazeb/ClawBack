"use client";

import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";

import { useCurrentUser } from "@/components/current-user";
import { FlowField } from "./flow-field";

/**
 * The landing hero, ported unchanged apart from where "Get started" points.
 *
 * A visitor who is not signed in is sent to sign-up rather than into a case
 * screen they cannot load: everything past this point belongs to an account.
 */
export function LandingHero() {
  const { isSignedIn } = useCurrentUser();

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black">
      <FlowField className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.75)_100%)]" />

      <div className="relative z-10 flex max-w-3xl flex-col items-center px-6 text-center">
        <p className="text-[12px] font-medium uppercase tracking-[0.28em] text-white/60">
          Security-deposit dispute analysis
        </p>
        <h1 className="mt-6 text-[52px] font-semibold leading-[1.02] tracking-[-0.04em] text-white sm:text-[76px]">
          Your deposit.
          <br />
          Your money.
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-white/60">
          Clawback reads your landlord&apos;s deduction statement, checks it against
          authoritative housing rules, and shows you exactly what&apos;s worth
          disputing — with the evidence to back it up.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={isSignedIn ? "/case" : "/signup"}
            className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[13.5px] font-medium text-black transition-transform duration-200 hover:scale-[1.03]"
          >
            Get started
            <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/letter"
            className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 text-[13.5px] font-medium text-white/85 transition-colors hover:border-white/60 hover:text-white"
          >
            <FileText className="size-4" />
            See a dispute letter
          </Link>
        </div>

        {isSignedIn ? null : (
          <p className="mt-6 text-[13.5px] text-white/50">
            Already have an account?{" "}
            <Link
              href="/signin"
              className="font-medium text-white/85 underline-offset-4 transition-colors hover:text-white hover:underline"
            >
              Log in
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
