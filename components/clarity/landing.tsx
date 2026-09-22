"use client";

import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";

import { useCurrentUser } from "@/components/current-user";
import { FlowField } from "./flow-field";

/**
 * The landing hero.
 *
 * The bar at the top is the product name and nothing else: centred, large, no
 * mark beside it. It previously carried the logo on the left and a session link
 * on the right, which split attention away from the name on the one page whose
 * entire job is to say what this is.
 *
 * The name animates in one letter at a time — see `wordmark-letter` in
 * `globals.css`. That is the only motion added to this page; the hero itself
 * already has the flow field behind it and does not need a second thing moving.
 *
 * "Get started" goes to the case list rather than straight into a case — a
 * renter who has already made one should see the ones they have, instead of
 * being dropped into whichever happened to be newest.
 */

/**
 * The wordmark, and the gap between each letter's entrance.
 *
 * Exported so the render harness can assert the stagger without hard-coding a
 * copy of the word — the two drifting apart is exactly how a test stops testing.
 */
export const WORDMARK = "Clawback";
export const LETTER_STAGGER_MS = 55;

export function LandingHero() {
  const { isSignedIn } = useCurrentUser();

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black">
      <FlowField className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.75)_100%)]" />

      <header className="absolute inset-x-0 top-0 z-20">
        <div className="flex items-center justify-center px-6 pt-8">
          {/*
            One element per letter so the name assembles rather than appearing.

            The letters are `aria-hidden` and the wrapper carries the label,
            because eight bare sibling letters are read out one at a time by
            some screen readers — which is worse than not animating at all.
          */}
          <span
            role="img"
            aria-label={WORDMARK}
            className="text-[80px] font-semibold leading-none tracking-[-0.04em] text-white"
          >
            {WORDMARK.split("").map((letter, index) => (
              <span
                key={`${letter}${index}`}
                aria-hidden="true"
                className="wordmark-letter"
                style={{ animationDelay: `${index * LETTER_STAGGER_MS}ms` }}
              >
                {letter}
              </span>
            ))}
          </span>
        </div>
      </header>

      <div className="relative z-10 flex max-w-3xl translate-y-12 flex-col items-center px-6 text-center">
        <p className="text-[12px] font-medium uppercase tracking-[0.28em] text-white/60">
          Security-deposit dispute analysis
        </p>
        <h1 className="mt-6 text-[50px] font-semibold leading-[1.02] tracking-[-0.04em] text-white sm:text-[76px]">
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
            href={isSignedIn ? "/cases" : "/signup"}
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
      </div>
    </section>
  );
}
