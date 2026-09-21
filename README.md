# Clawback

**Your deposit. Your money.**

Clawback reads your landlord's security-deposit deduction statement, checks each
charge against official housing guidance for your state, and drafts a dispute
letter that cites its sources — so you can push back with evidence instead of
guesswork.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![Convex](https://img.shields.io/badge/Convex-1.45-ee0000)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8)

---

## The problem

Your landlord keeps part of your deposit and sends an itemized list of
deductions. You have a limited window to respond, no idea whether "carpet
replacement" counts as normal wear and tear where you live, and no way to argue
the point without sounding like you're bluffing.

Doing this properly means finding the actual rule for your jurisdiction,
matching it to each charge, and writing a letter that sounds like it knows what
it's talking about. That's hours of work at the exact moment you're moving out.

## What Clawback does

1. **You create a case.** Clawback provisions a **private email inbox for that
   case** — `case-xxxxx@agentmail.to`. Mail arriving there can only belong to
   that case, so nothing has to be guessed.
2. **You forward the landlord's statement** to that address.
3. **It reads the statement.** Every deduction is extracted into structured data
   (description, amount, category) and validated before it's stored.
4. **It finds the actual rules.** For each deduction it searches for official
   housing guidance in your jurisdiction and keeps only sources that classify as
   an authority. Retrieved passages are stored, so every later claim can be
   traced back to something real.
5. **It assesses each charge** against those passages — potentially disputable,
   likely valid, or needs more information — and says what's missing when it
   can't tell.
6. **It drafts the dispute letter.** Every challenge is attributed to the source
   it came from, phrased as a request for review rather than an accusation.
7. **You approve it.** Nothing is ever sent without you. Clicking send delivers
   it from your case's address, and any reply comes straight back into the case.

## What it deliberately will not do

These are enforced by tests, not by good intentions:

- **Never says money was "returned" or "recovered."** The app knows the deposit
  wasn't deducted; it cannot know the landlord handed it back. The third figure
  is labelled *not withheld*, and *potentially disputable* never becomes
  *recovered*.
- **Never sends anything on its own.** Approval is a gate. An approved letter
  still waits for you to press send.
- **Never invents a source, statute, citation, or deadline.** Every claim must
  trace to a stored source passage. A draft that names no real source is
  rejected rather than saved.
- **Never promises an outcome.** No success scores, no win probabilities, no
  legal conclusions — it reports what the retrieved guidance indicates.
- **Never fabricates a figure it doesn't have.** Fields the backend doesn't
  store render *Not recorded* rather than plausible filler.

## How it's built

| | |
|---|---|
| **Frontend** | Next.js 16 (App Router, Turbopack), React 19, Tailwind v4 |
| **Backend** | Convex 1.45 — queries, mutations, scheduled actions, HTTP actions, realtime subscriptions |
| **Auth** | Convex Auth — password (name + email + password) and email magic link |
| **OpenAI** | Extraction, assessment, letter drafting, and reading the landlord's reply into structured fields |
| **Firecrawl** | Retrieving official housing sources and classifying which are authorities |
| **AgentMail** | A real inbox per case, inbound delivery by webhook, and outbound sending |

Provider calls are all server-side. The browser only ever talks to Convex —
never directly to OpenAI, Firecrawl, or AgentMail.

### The pipeline

```
 landlord's statement
        │
        ▼
 AgentMail inbox (one per case) ──webhook──▶ Convex http action
        │                                        │  Svix signature verified
        │                                        ▼
        │                              OpenAI extraction ──▶ deductions
        │                                        │
        │                                        ▼
        │                              Firecrawl research ──▶ official sources
        │                                        │
        │                                        ▼
        │                              OpenAI assessment ──▶ per-charge findings
        │                                        │
        │                                        ▼
        │                              totals summed from stored records
        │                                        │
        │                                        ▼
        │                              OpenAI drafts letter ──▶ validated
        │                                        │
        │                                        ▼
        └──────────────────────────────▶ you approve ──▶ you send
```

Two queries run in parallel during research — a natural-language question and a
short keyword query — because a prose question alone measured **zero government
hosts** against the real provider. Results are deduped by URL.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env.local` already points at a Convex deployment. If you need to link one:

```bash
npx convex dev       # ⚠️ rewrites .env.local — back it up first
```

### Two places hold configuration

| Where | Variables | How to set |
| --- | --- | --- |
| Next.js | `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` | written into `.env.local` by `npx convex dev` |
| Convex functions | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `FIRECRAWL_API_KEY`, `FIRECRAWL_API_BASE_URL`, `AGENTMAIL_API_KEY`, `AGENTMAIL_API_BASE_URL`, `AGENTMAIL_WEBHOOK_SECRET`, `AGENTMAIL_DOMAIN`, `AUTH_EMAIL_TRANSPORT`, `AUTH_EMAIL_INBOX` | `npx convex env set NAME "value"` |

Variables in `.env.local` are **not** visible to Convex functions — that's the
most common reason a key "isn't working".

See [`.env.example`](./.env.example) for the annotated list.

### The AgentMail webhook

Point a webhook at your deployment's HTTP-actions origin:

```
https://<your-deployment>.convex.site/agentmail/webhook
```

Subscribe it to `message.received`, then put the signing secret in
`AGENTMAIL_WEBHOOK_SECRET`. Without it the endpoint fails closed with `503`. For
local testing, tunnel the site port (`NEXT_PUBLIC_CONVEX_SITE_URL`) with
something like ngrok.

### Other commands

```bash
npm run stack        # Convex dev + provider mocks + Next (needed for verify:e2e)
npm run seed         # seed a demo case
npx convex dev --once   # push backend changes — wait for "Convex functions ready!"
```

## Verification

A green mock suite is not evidence an integration works, so this project keeps
several suites and is explicit about what each one proves.

```bash
npm run verify       # 397 checks — pipeline, prompts, validation, money maths
npm run verify:ui    # 245 checks — server-renders the real components
npm run verify:auth  #  12 checks — runs against the live cloud deployment
npm run verify:e2e   # 270 checks (+2 SKIP) — needs `npm run stack` first
npm run verify:live  #  21 checks — hits the real OpenAI, Firecrawl, AgentMail
npx tsc --noEmit     # types
npm run lint         # eslint
```

## Layout

```
app/                 routes — landing, case, evidence, intelligence,
                     letter, timeline, signup, signin, and the older
                     /cases workspace where cases are created
components/clarity/  the main UI, wired to Convex
convex/              backend: pipeline modules plus pure policy modules
scripts/             verification suites and provider mocks
hackathon.md         the build log
```

## Proof it runs end to end

One real case on the live deployment: a Texas deposit of **$1,500** with
**$1,000** itemized across 4 charges. Clawback provisioned an inbox, received
the statement, extracted the deductions, retrieved **7 official Texas sources**
(including the state Attorney General's renter's-rights guidance), assessed
**4 of 4** charges, identified **$450 potentially disputable**, drafted a letter
attributing each challenge to its source, and sent it after approval.

## Known limitations

- **"Sent" means handed to the provider.** The webhook ignores every event that
  isn't `message.received`, so bounces are never seen. Delivery to the
  landlord's mailbox can't be confirmed from inside the app.
- **AgentMail's plan allows 3 inboxes** and every case provisions one, so the
  fourth case can't get an address. The case row is still created and usable.
- **Realtime hasn't been exercised in a browser here** — the development
  sandbox blocks WebSockets. The wiring is covered by render checks.
- **No real inbound landlord reply has been observed yet:** inbound is
  webhook-only and needs a public HTTPS URL.
- One email can end up with two accounts if you use both sign-in methods, since
  Convex Auth keys accounts by provider.

---

Built for the **Convex All Gas Hackathon**. The day-by-day build log, including
the defects found only by running against the real providers, is in
[`hackathon.md`](./hackathon.md).
