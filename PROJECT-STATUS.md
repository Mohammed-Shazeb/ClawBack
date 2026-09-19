# Clawback — Project Status

**Date:** 19 September 2026
**Repository:** `D:\ClawBack` · Next.js 16.3.4 (App Router, Turbopack) + Convex 1.45.0
**Deployment:** Convex cloud dev `dev:charming-kudu-951` (team `shazeb`, project `clawback`)

This document is the single source of truth for what this project is, what works,
what does not, what remains, and what is deliberately not claimed. Everything here
was verified on the date above; where something could not be verified, it says so
rather than implying success.

---

## 1. The short answer

**Clawback works.** The full pipeline runs end to end — a deposit statement arrives
by email, is read, researched, assessed, drafted into a dispute letter, approved by
the renter, sent, and the landlord's reply is read back into structured fields — and
it is verified by **876 automated checks** (892 when the live provider run is
unblocked), plus live calls to real providers.

**It is not production-ready, and it does not claim to be.** Three things stand
between it and real users, and none of them is a code defect:

1. `ALLOW_DEMO_IDENTITY=true` is set on the deployment — while it is set, **any
   caller can act as any user id**. This is the one genuinely dangerous item.
2. Sign-in mail is written to the Convex logs (`AUTH_EMAIL_TRANSPORT=log`) instead
   of being delivered.
3. The live OpenAI path is **blocked by the account right now** (a daily check-in
   is required for free-tier models), so the live model checks are currently skipped.

Two integrations have never been exercised for real and remain **LIVE VERIFICATION
PENDING**: AgentMail's actual outbound send and its actual inbound reply.

---

## 2. What the product is

A renter receives an itemized security-deposit deduction statement. They forward it
to a per-case email address. Clawback:

1. **Reads** the statement into structured deductions (OpenAI, validated by Zod).
2. **Researches** each deduction against official housing sources (Firecrawl),
   filtering to government hosts only.
3. **Assesses** each deduction against the retrieved passages — `POTENTIALLY_DISPUTABLE`,
   `LIKELY_VALID` or `NEEDS_MORE_INFORMATION` — and computes a disputable amount.
4. **Drafts** a dispute letter citing the retrieved sources, under a prompt that
   forbids inventing statutes, citations or legal conclusions.
5. **Requires the renter to approve it.** Approval is a gate, never a send.
6. **Sends** only when the renter explicitly triggers it (AgentMail).
7. **Reads the landlord's reply** back into structured fields — offer, refusal,
   request for information, new evidence — and shows it next to their verbatim words.

The product language is deliberately cautious throughout: "potentially disputable",
"may warrant further review". **No amount is ever described as recovered**, and no
deduction is ever called illegal.

### Shape of the codebase

| | Count |
| --- | --- |
| Convex modules | 28 |
| Schema tables | 8 (6 belong to Convex Auth) |
| Public Convex functions | 27 |
| — of which derive the caller from a session | **24**, across 9 modules |
| Internal Convex functions | 33 |
| React components | 19 |
| Verification suites | 5 |

---

## 3. Status at a glance

| Area | Status | Evidence |
| --- | --- | --- |
| Deposit statement extraction | ✅ **Working, live-verified** | real model, validated by Zod |
| Official-source research | ✅ **Working, live-verified** | real Firecrawl, gov hosts only |
| Evidence-based assessment | ✅ **Working, live-verified** | real model, amount capped server-side |
| Dispute letter generation | ✅ **Working, live-verified** | real model, 12 forbidden-claim rules |
| Human approval gate | ✅ **Working** | e2e covers the gate, idempotency, and approved-letter immutability |
| Outbound send | ⚠️ **Mocked only** | real send never attempted |
| Inbound reply + threading | ⚠️ **Mocked only** | real reply never received |
| Reply reading | ✅ **Working, live-verified** | real model, contradiction rejected |
| Authentication | ✅ **Working, live-verified** | 12/12 against the cloud deployment |
| Realtime UI | ⚠️ **Query-level only** | this environment blocks WebSockets |
| Production readiness | ❌ **Not ready** | 3 blockers in §6.1 |
| Hosting | ❌ **None configured** | no deploy target exists |

---

## 4. What works, and how it is proven

### 4.1 The pipeline

Every stage below is covered by the offline suite (`npm run verify`, 388 checks) and
the end-to-end suite (`npm run verify:e2e`, 270 checks against a live local Convex
deployment with mock providers).

**Extraction.** The statement is read into deductions with categories
`ORDINARY_WEAR | TENANT_DAMAGE | FEE | UNKNOWN`. The landlord's exact wording is
preserved and the model is forbidden from judging legality. A mock that once emitted
`"OTHER"` — a value outside the enum — rejected the whole document and stranded the
case; the app was right and the mock was wrong.

**Research.** Firecrawl search, filtered by an allow-list of government hosts. Law-firm
marketing pages, aggregators and forums are never stored. When no authoritative source
is found, the deduction records that explicitly instead of inventing one. A real
finding: a long natural-language question returned **no government host at all**,
while a short keyword query over the same facts returned 10 including
`selfhelp.courts.ca.gov` — so `research.ts` now runs both in parallel and dedupes.

**Assessment.** The model receives structured input only and must cite retrieved
passages. An amount that is negative, exceeds the stated deduction, or contradicts the
outcome is rejected or capped. **The case total is computed on the server from stored
per-deduction assessments — the model's own total is never trusted.**

**Letter.** An 11-rule prompt plus `validateLetter`, which enforces 12 forbidden-claim
patterns (illegality, theft, guarantees, success percentages, legal threats, invented
deadlines, statute citations, case citations, URLs). A letter with no traceable stored
source is rejected rather than saved.

**Approval.** `approveLetter` marks the letter `APPROVED` and leaves the case at
`AWAITING_APPROVAL`. Nothing is sent. Approved letters are immutable; the only forward
path is `startNewDraft`, which archives rather than deletes.

**Send.** Idempotency key `send:{letterId}:v{version}` — per document *revision*, not
per attempt. A double click, a retry and a replayed webhook converge on one row. The
case moves to `SENT` **only** after AgentMail confirms acceptance.

**Reply.** Inbound mail is classified `REPLY` or `STATEMENT` *before* it is stored,
using thread id, `In-Reply-To`/`References`, then "a SENT letter exists". Subject-line
matching is never the identity mechanism. A reply is never run through extraction —
because `applyExtraction` deletes and rewrites every deduction, and a misclassified
reply would have destroyed the analysis the dispute was built from.

### 4.2 Authentication — the newest work

This was a genuine security fix, not polish. The vulnerability was one line:
`const callerId = args.userId`. Every downstream ownership check still passed review
and still had tests, and was still worthless — the caller supplied both sides of the
comparison.

**Now:** the caller's identity is derived from the session token on the server.
`convex/caller.ts` holds the decision as pure functions, 24 public functions call it,
and a source scan in `npm run verify` **fails the build** if any public function with a
`userId` argument does not.

Three properties are worth stating precisely, because each is easy to get wrong:

- **The branch order is the security property.** A session returns *before* the claimed
  id is read, so on the authenticated path the argument is never consulted. Swapping the
  branches still compiles and still returns a user — it just silently hands any caller
  any account.
- **`identity.subject` is `userId|sessionId`, not a bare id.** Taking it whole produces
  a value that never matches a row, and every authenticated request behaves as if the
  user does not exist.
- **`userId` survives only as the demo identity**, gated on `ALLOW_DEMO_IDENTITY` being
  exactly `"true"`. `"1"`, `"yes"`, `"TRUE"` and `"true "` all leave it off.

`users.get(userId)` — which returned any row for any id, an unauthenticated read of
every user — is gone, replaced by a session-scoped `users.current` that takes no
argument.

On the client, `ConvexAuthProvider` replaces `ConvexProvider`, and `useCurrentUser` +
`WorkspaceGate` + `SignIn` replace the deleted `components/demo-user.ts`. The shell no
longer claims "cases here are shared by everyone using this deployment" — that became a
false statement the moment cases belonged to an account.

**The property, proven against the real deployment:** a token minted for an *empty*
user that claims the id of a user owning 3 cases returns **0 cases**, while the same
claim without a session returns those cases. `npm run verify:auth` — 12/12.

### 4.3 Integrations

| Provider | Live status | Detail |
| --- | --- | --- |
| **Firecrawl** | ✅ **Verified** | real search returns results; government hosts kept, forums and law-firm pages rejected |
| **AgentMail** | ⚠️ **Partially verified** | credential accepted, 3 inboxes visible, response shapes documented. **A real send and a real reply are NOT exercised.** |
| **OpenAI** | ⚠️ **Verified on a checked-in day; blocked now** | 16/16 checks passed against the real model. Currently `402 — daily check-in required to use free models`. This is an account condition; the app never receives a response, so it says nothing about app correctness. |

The OpenAI live run is the highest-value test in the project, because **a mock is
written by the same person who wrote the expectation**. It found two defects no mocked
suite could have caught, within minutes: the app's structured-output contract silently
depended on the provider honouring `response_format` (the gateway answers `200 OK` and
ignores the schema), and the response-analysis prompt had no rule for a partial
settlement — which is the *ordinary* outcome of a deposit negotiation.

### 4.4 The verification battery

| Suite | Result | What it proves |
| --- | --- | --- |
| `npm run verify` | **388/388** | schema, prompts, validation, maths, letter, send contract, response analysis, WCAG AA contrast, the identity decision, and a source scan |
| `npm run verify:ui` | **201/201** | server-renders the real components, including all three states of the sign-in gate |
| `npm run verify:e2e` | **270/270** (+2 SKIP) | the whole pipeline against a live local deployment with mocks |
| `npm run verify:auth` | **12/12** | the authenticated path against a real deployment |
| `npm run verify:live` | **5/5** (4 skipped) | real providers; 21/21 when the account is checked in |
| `npx tsc --noEmit` | clean | whole repo |
| `npx eslint .` | 0 errors, 5 warnings | 4 are generated-file, 1 pre-existing |
| `npm run build` | exits 0 | all 6 routes generated |

**Every new guard was proven by breaking the thing it guards** — removing the gate's
sign-in branch failed exactly 4 UI checks and named the leaked marker; reverting a
handler to trust its argument failed the live check with *"got 3 — the argument is
still being trusted"*. A check that has never failed is decoration.

---

## 5. What does not work, or is not verified

These are stated plainly, because the failure mode of a status document is optimism.

1. **The live OpenAI path is blocked right now.** `402 — daily check-in required to
   use free models`. Not an app defect; not fixable in code. Re-run
   `npm run verify:live` after checking in.

2. **A real AgentMail send has never been made, and a real reply never received.**
   Both need a real recipient address, which the harness must not invent, and a send is
   an irreversible external side effect. Every outbound and reply path is verified
   against a mock — including idempotency, retry, stale-claim takeover and reply
   classification — but that is **mocked, not live**.

3. **Exactly-once delivery is not guaranteed across a stale send takeover.** A
   takeover is not a retry of an *observed* failure — the earlier attempt may have
   reached the provider without reporting back — so the landlord can receive two copies.
   AgentMail's send endpoint has no idempotency key, so this cannot be detected from our
   side. It is *recorded* (a `SEND_ATTEMPT_ABANDONED` timeline event) rather than
   hidden. One delivered copy is guaranteed for concurrent and repeated attempts while a
   claim is live; **not** across a takeover.

4. **The authenticated path cannot be verified on a local backend, by construction.**
   Convex fetches the auth provider configuration from the site host before trusting a
   token, and that request never reaches the local router. Every token is rejected with
   `AuthProviderDiscoveryFailed` before any function runs. The two e2e auth checks
   therefore report **SKIP** and are excluded from the total.

5. **No live browser walkthrough.** This environment blocks WebSockets, so Convex's
   realtime client cannot connect. The UI is verified by server-rendering the real
   components. **Realtime updates are exercised at the query level, not through a live
   subscription** — that is a real gap.

6. **No hosting configuration of any kind exists.** No deploy target, no domain, no
   `SITE_URL` pointing anywhere but `http://localhost:3000`.

7. **Attachments are tracked but never parsed.** No OCR, so a scanned statement is
   recorded as a filename and nothing more.

---

## 6. What remains

### 6.1 Blocking production — must be done, in this order

| # | Item | Why it matters |
| --- | --- | --- |
| 1 | **Unset `ALLOW_DEMO_IDENTITY`** on the deployment | While it is `true`, any caller can act as any user id. This is the single most serious item on this page. |
| 2 | **Set `AUTH_EMAIL_TRANSPORT=agentmail` + `AUTH_EMAIL_INBOX`** | Sign-in links currently go to the Convex logs. A logged sign-in link is a live credential sitting in a log file. |
| 3 | **Set `SITE_URL` to the deployed origin** | It is the issuer and audience auth tokens are minted against. `http://localhost:3000` will not validate against a real host. |
| 4 | **Use a paid OpenAI model** | The free tier requires a manual daily check-in; the live path cannot be relied on. |

### 6.2 Unverified integrations — to close these, in order

| # | Item | How to close it |
| --- | --- | --- |
| 5 | **A real outbound send** | Send one dispute to a mailbox you control. Confirm it arrives and the case moves to `SENT`. |
| 6 | **A real inbound reply** | Reply from that mailbox. Confirm it lands on the same case, is classified `REPLY`, and is read. Requires a **public HTTPS URL** for the webhook — there is no inbox-poll path, so inbound is webhook-only. |
| 7 | **Re-run `npm run verify:live`** on a checked-in day | Confirms the 16/16 OpenAI result still holds. |

### 6.3 Known limitations — accepted, not defects

- The landlord's address must be entered by the renter; Clawback will not infer it.
- Reply reading is single-message: a reply that quotes an earlier thread is read as
  written, with no thread-level reconciliation.
- The reading is a transcription, not advice — it is still model output and should be
  read alongside the landlord's own words. The UI says so.
- Authority classification is host/TLD based and deliberately conservative.
- The case disputable total can briefly lag by one assessment pass after a concurrent
  write, but never drifts permanently (`recalcDisputableTotal` is idempotent).
- Only one live letter exists per case; superseded drafts are archived but the UI does
  not yet surface archived letters.
- No custom email domain routing — AgentMail's default only.
- Rate limiting is whatever Convex Auth's own `authRateLimits` table provides; no
  additional throttle was added to the sign-in endpoint.
- There is no Next.js SSR auth integration. Pages are statically prerendered and the
  session resolves on the client, so the first paint is the loading state.

### 6.4 Housekeeping

- **72 files are uncommitted.** The last commit is `ffb1fe4`; all of Days 7–9 and the
  entire auth migration are working-tree only. This is the largest single risk to the
  work itself.
- `AUDIT.md` describes the state before the auth migration and is now partly historical.

---

## 7. What is explicitly NOT claimed

- **Not production-ready.** See §6.1.
- **Not multi-user-safe while `ALLOW_DEMO_IDENTITY=true`.**
- **No amount is ever described as recovered.** The headline figure is "$850 potentially
  disputable", computed on the server from stored per-deduction assessments. It is not
  money recovered, and it is not legal advice.
- **No legal conclusions.** No deduction is called illegal or unlawful; no statute or
  case law is cited; no outcome is promised.
- **The mocked suites are not evidence of live provider behaviour.** The live result is
  reported separately with its own counts.
- **The 16/16 OpenAI result is one model, on one gateway, over a handful of runs, on a
  day the account was checked in.** It demonstrates the validation boundary holds for
  real model output; it is not a statistical claim about model reliability.
- **Realtime is not verified through a live subscription.**
- **AgentMail outbound and inbound are mocked-only.**

---

## 8. Actual deployment state

Read from the deployment during this pass, not from memory:

```
CONVEX_DEPLOYMENT            dev:charming-kudu-951   (cloud, team shazeb)
OPENAI_BASE_URL              https://api.apinex.bond/v1
OPENAI_MODEL                 free/gpt-5.6-luna       ← free tier, daily check-in
FIRECRAWL_API_BASE_URL       https://api.firecrawl.dev/v1
AGENTMAIL_API_BASE_URL       https://api.agentmail.to/v0
AGENTMAIL_WEBHOOK_SECRET     whsec_Zje00U/rh…        ← a real secret, NOT the test value
ALLOW_DEMO_IDENTITY          true                    ← ⚠️ must be unset
AUTH_EMAIL_TRANSPORT         log                     ← ⚠️ must become agentmail
SITE_URL                     http://localhost:3000   ← ⚠️ wrong for any deployment
JWT_PRIVATE_KEY / JWKS       set                     ← RS256, valid
```

One correction worth noting: an earlier version of this report claimed the webhook
secret was still the harness's test value (`whsec_bW9ja3NlY3JldGZvcnRlc3Rpbmc`). It is
not. That item is closed; it still deserves a rotation policy, but it is not a leak.

---

## 9. How to run it

**The local stack** (three processes — never start a long-lived process with a shell
`&`, it is killed when the shell returns):

```bash
npx convex dev                    # leave running; hot-reloads
node scripts/mock-providers.mjs   # Firecrawl :4590 / OpenAI :4591 / AgentMail :4592
npm run dev                       # http://localhost:3000
# or: npm run stack
```

**The verification battery:**

```bash
npm run verify        # 388 offline checks — no network, no deployment
npm run verify:ui     # 201 checks — server-renders the real components
npm run verify:e2e    # 270 checks — needs the local backend + mocks
npm run verify:auth   #  12 checks — needs a deployment that honours tokens
npm run verify:live   #   5 checks — real providers, real credentials, real network
npx tsc --noEmit && npx eslint . && npm run build
```

**Signing in locally.** The local deployment has `AUTH_EMAIL_TRANSPORT=log`, so the
sign-in code is printed in the `npx convex dev` output. Set `ALLOW_DEMO_IDENTITY=true`
on the local deployment to keep the seeder and e2e harness working — that is what the
flag exists for.

---

## 10. Traps for the next person

Each of these cost real time to discover. None is stylistic preference.

1. **`convex/_generated/*` is never hand-edited.** It is the contract the client and
   the types resolve against. A fabricated `api.d.ts` was once committed (`4cfe100`).

2. **A push that fails typecheck leaves the previous code serving.** The backend keeps
   answering normally, so a deliberately broken file appears to behave correctly. Always
   wait for *"Convex functions ready!"* before trusting any result.

3. **An orphaned Convex backend serves stale code** while answering queries normally,
   and blocks the next one from starting on port 3210.

4. **A `waitFor` predicate that could already be true is not a wait.** Two e2e checks
   once passed for the wrong reason this way.

5. **A check that cannot fail is not a check, and a check that cannot *run* must not be
   counted as one that passed.** The first version of the e2e auth checks passed
   vacuously because they tested `response.status !== "error"`, and the rejection Convex
   returns has no `status` field. They now report SKIP and are excluded from the total.

6. **This environment blocks WebSockets**, so verify the UI by rendering the real
   component rather than by clicking through a page.

7. **`curl -o /dev/null` exits 23 in this Git Bash**, silently short-circuiting any `&&`
   chain after it.

8. **Convex calls against a dead deployment hang rather than reject** — `.catch()` never
   fires, which is why `useCurrentUser` carries an 8-second reachability timeout.

---

## 11. Bottom line

| Question | Answer |
| --- | --- |
| Does the product work? | **Yes** — the whole loop, verified by 876 automated checks plus live provider calls. |
| Is it secure? | **The code is. The deployment is not yet** — one flag (`ALLOW_DEMO_IDENTITY`) is the difference, and it is currently set. |
| Is it verified? | **Mostly.** Everything except a real AgentMail send, a real AgentMail reply, realtime over a live subscription, and — today — the live OpenAI path. |
| Is it production-ready? | **No.** Four config changes in §6.1, then two live integration runs in §6.2. |
| Is it committed? | **No** — 72 files are uncommitted. Do this first. |
| What is the biggest risk? | `ALLOW_DEMO_IDENTITY=true` on a deployment reachable from the internet. |
