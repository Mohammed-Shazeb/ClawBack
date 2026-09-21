# Convex All Gas Hackathon — submission status

Read 2026-09-21. **Submissions close 2026-09-22 12:00 PT = 2026-09-22 19:00 UTC =
2026-09-23 00:30 IST.** Roughly **29 hours** remain.

---

## 1. Submission checklist

| Requirement | Status | What is needed |
|---|---|---|
| **Public repo** | ❌ **Not done** | There is **no git remote at all**. 8 commits exist locally on `master`, none pushed. No `gh` CLI on this machine — create the repo on GitHub and give me the remote URL. |
| **`hackathon.md` at root** | ✅ **Done** (just fixed) | Existed but stopped at 2026-09-14. Now extended to cover 09-17 → 09-21 (live verification, UI rebuild, auth, the new main UI, both production defects). This is the file judges read. |
| **Live URL on `convex.site` / `chatgpt.site`** | ❌ **Not done — the biggest gap** | No hosting config of any kind exists. See §3. |
| **Three-minute video** | ❌ **Not done** | I cannot generate video. You must record it. |
| **Register on Luma** | ⬜ Unknown | You. |
| **Social post (X/LinkedIn)** | ⬜ Unknown | You. |
| **Submit on vibeapps.dev** | ⬜ Unknown | You, after the above. |

"Everyday app, not developer tool" ✅ — this is for renters, not developers.

---

## 2. Judging criteria

| Criterion | Assessment |
|---|---|
| **Creativity / usefulness** | ✅ Strong. A renter facing a withheld deposit gets an evidenced dispute letter. |
| **Convex depth** | ✅ Mostly. Real queries, mutations, scheduled actions, HTTP actions, file-scoped transactions, auth. ⚠️ **No Convex Component is registered** (no `convex/convex.config.ts`). Installing static hosting to publish would add one. |
| **Sponsor stack does real work** | ✅ All three. **OpenAI** extracts, assesses, drafts and reads replies. **Firecrawl** retrieves real official sources. **AgentMail** provisions a real inbox per case, receives by webhook, and sends. |
| **Live URL** | ❌ The blocking gap. "No localhost demos." |
| **Social proof** | ⬜ You. |
| **Video demo** | ⬜ You. |

---

## 3. The live URL: what it takes

The app is Next.js 16. Convex static hosting serves **static files only**, so the path is
`output: 'export'` → upload. I checked this Next version's docs rather than assuming:

- ✅ Static export is supported.
- ❌ **"Dynamic Routes without `generateStaticParams()`" is explicitly unsupported.**

`app/cases/[caseId]/page.tsx` is exactly that. It is the legacy workspace deep-link; the new
main UI (`/case`, `/evidence`, `/intelligence`, `/letter`, `/timeline`) has **no dynamic
segments** and would export cleanly.

So publishing requires one of:

1. **Convert the case deep-link to a query param** (`/cases?caseId=…`, read client-side) —
   keeps the feature, touches the links that point at it.
2. **Drop the deep-link from the exported build** — fastest; `/cases` and `/cases/new` still
   work, but opening a specific case by URL 404s.
3. Accept `/cases/[caseId]` 404s and make the new UI the only surface.

Plus: install `@convex-dev/static-hosting`, run its setup, build the export, upload, and
confirm Convex Auth still resolves (its domain is `CONVEX_SITE_URL`, which should be the same
host). **Caveat:** `npm run build` dies at its cleanup step on this sandbox's bulk-delete
guard (it still writes complete output; `git clean -xfdq` clears `.next`). Export writes to
`out/`, which may avoid it entirely.

This is a couple of hours of work with real risk, and it makes the app **public** — so I want
your go-ahead before starting.

---

## 4. The app, start to end

**Stack.** Next.js 16 (App Router, Turbopack) + Convex 1.45, TypeScript, Tailwind v4. Main UI
in `components/clarity/`; the older `/cases` workspace still exists and is where case
creation lives.

**1. Account.** `/signup` — name, email, password (Convex Auth Password provider). Magic link
still available at `/signin`. Identity is derived from the session in `convex/caller.ts`; **no
client-supplied `userId` is trusted anywhere** — 24 public functions go through it, and a
source scan fails the build if a new one doesn't.

**2. Create a case.** Jurisdiction, deposit, total deductions. Convex provisions a **private
AgentMail inbox per case** (`case-<tail>@agentmail.to`), so mail arriving there can only
belong to that case.

**3. Statement arrives.** The renter forwards the landlord's deduction statement to that
address. AgentMail POSTs to the webhook (`convex/http.ts`): HMAC signature verified, payload
validated, routed by `inbox_id`, body fetched if truncated.

**4. Extraction.** OpenAI reads the statement into structured deductions (description,
amount, category), validated with Zod before anything is stored.

**5. Research.** For each deduction, **two Firecrawl queries run in parallel** — a
natural-language question and a short keyword query — because the prose question alone
measured **zero government hosts** on a real California deduction. Results are classified for
official authority and deduped by URL. Retrieved passages are stored as `sources`.

**6. Assessment.** OpenAI assesses each deduction against the retrieved passages only,
producing an outcome (potentially disputable / likely valid / needs more information), a
potentially disputable amount, the reasoning, and what information is missing. External
content is treated as untrusted input, never instructions.

**7. Money.** Totals are summed from the stored per-deduction assessments — model-supplied
totals are never trusted.

**8. Letter.** OpenAI drafts the dispute letter from the assessed deductions and source
passages. Every claim must be attributed to a stored source. The draft is validated: schema,
length, no unsupported legal claims, no invented deadlines or statute cites, and **at least
one real stored source**. If it fails, nothing is saved and the reason is shown.

**9. Approval is a gate, not a send.** `approveLetter` marks the letter `APPROVED`; the case
stays `AWAITING_APPROVAL`. Approved and sent letters are immutable — the only forward path is
`startNewDraft`, which archives.

**10. Sending.** The renter clicks Send. AgentMail sends from the case inbox; the thread id is
recorded so a reply lands on the right case. Idempotency key is per document revision
(`send:{letterId}:v{version}`), so a double click or replayed webhook converges on one row.

**11. Reply.** Inbound classification is **biased toward "reply"** after a dispute is sent — a
statement misread as a reply is merely stored, whereas a reply misread as a statement would
run extraction again and destroy the analysis. Replies are read into structured fields.

**12. Timeline + realtime.** Every step is recorded as a timeline event and the UI updates
live through Convex queries.

**Honesty rules the UI enforces:** `deposit − deductions` is labelled **"not withheld"**,
never "returned" (the app cannot know money was handed back); "potentially disputable" is
never "recovered"; fields the backend doesn't store render "Not recorded" rather than
plausible filler.

**Data model:** `cases`, `deductions`, `sources`, `evidence`, `letters`, `emails`,
`timelineEvents`, `users`, plus Convex Auth's tables.

---

## 5. One real case, run end to end

Texas, $1,500 deposit, $1,000 itemized across 4 deductions. Private inbox provisioned →
statement received → 4 deductions extracted → **7 official Texas sources** retrieved
(including the Attorney General's renter's-rights guidance) → **4/4 assessed** →
**$450 potentially disputable** → letter drafted with each claim attributed to its source →
approved → sent.

---

## 6. Verification

```
verify       397/397      pipeline, prompts, validation, maths, letter, send contract
verify:ui    245/245      server-renders the real components
verify:e2e   270/270 (+2 SKIP)   live local deployment with mocks
verify:auth   12/12       against the cloud deployment
verify:live   21/21       real OpenAI, Firecrawl, AgentMail
tsc clean · eslint 0 errors
```

---

## 7. Known limitations (say these plainly if asked)

- **"Sent" means handed to the provider, not delivered.** The webhook ignores every event
  that isn't `message.received`, so bounces are never seen. There is no delivery feedback.
- **Realtime is unverified in this sandbox** (WebSockets are blocked). The wiring is proven by
  render checks; the transport has not been exercised in a browser here.
- **No real inbound landlord reply has been observed** — inbound is webhook-only and needs a
  public HTTPS URL. Publishing fixes that too.
- **AgentMail plan allows 3 inboxes**; every case provisions one, so case #4 fails
  provisioning with `403 Inbox limit exceeded`. The case row survives and is usable.
- **One email can hold two user rows** if a renter uses both sign-in methods (Convex Auth keys
  accounts by provider + address).
- **No sign-out** in the new UI yet.
- The configured OpenAI model is a free tier that needs a manual daily check-in; a 402 blocks
  the live path. That's an account condition, not an app defect.
