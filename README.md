# Clawback

Security deposit recovery for renters. Clawback receives a landlord's deposit
statement by email, reads the deductions out of it, and keeps the case — and its
evidence trail — in one place.

## What works today (Milestone 2)

```
Landlord's email  ->  AgentMail inbox  ->  Convex  ->  OpenAI extraction  ->  case totals  ->  realtime UI
```

- Each case gets its own AgentMail inbox, so an inbound message can only belong
  to one case. Messages that match no case are stored for review, never guessed
  into a case.
- The statement text is read into structured deductions (description, amount,
  category) with a Zod-validated structured output call.
- Deductions and case totals are written to Convex; the case UI updates live
  over Convex subscriptions.
- Webhook deliveries are verified (Svix signature) and idempotent on the
  provider message id.

**Not built yet, on purpose:** legal research, citations, dispute scoring,
evidence matching, letter drafting, sending, and any claim that a deduction is
unlawful or recoverable. `potentiallyDisputableAmount` stays `0` until legal
analysis exists. Attachment files are stored as metadata only and are not read.

## Setup

```bash
npm install
npx convex dev          # links/creates a deployment and writes .env.local
npm run dev             # http://localhost:3000
```

### Environment variables

See [`.env.example`](./.env.example) for the full list. Two places matter:

| Where | Variables | How to set |
| --- | --- | --- |
| Next.js | `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` | written into `.env.local` by `npx convex dev` |
| Convex functions | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET`, `AGENTMAIL_API_BASE_URL`, `AGENTMAIL_DOMAIN` | `npx convex env set NAME "value"` |

Variables in `.env.local` are **not** visible to Convex functions. Keys stay on
the server: the browser only ever talks to Convex, never to OpenAI or AgentMail.

### AgentMail webhook

Point an AgentMail webhook at the deployment's HTTP actions origin:

```
https://<your-deployment>.convex.site/agentmail/webhook
```

Subscribe it to `message.received`, then copy the endpoint's signing secret into
`AGENTMAIL_WEBHOOK_SECRET` (`npx convex env set`). Without that secret the
endpoint fails closed with `503`.

For a local end-to-end test, tunnel the local site port (`NEXT_PUBLIC_CONVEX_SITE_URL`,
usually `http://127.0.0.1:3211`) with a tool such as `ngrok` and register that
URL with AgentMail.

## Checks

```bash
npm run verify          # extraction schema + webhook signature checks
npx tsc --noEmit        # types
npm run lint            # eslint
npm run build           # production build
```
