# Clawback — Days 7–9 Final Report

Final hardening, live integration verification, premium UI and demo polish.

Scope note: this was a **finish-and-harden** pass, not a rewrite. The Convex
schema, the backend pipeline, the provider integrations and the working
functionality are unchanged except where a genuine defect required a change.

One exception, added after the fact and called out so it is not missed:
**authentication was replaced.** The client-supplied `userId` is gone, the caller
is derived from a session token on the server, and a real sign-in flow replaces
the demo identity. That is a security fix rather than polish, and it is described
in full under Authentication — including the two places where it is deliberately
*not* verified.

Eight defects were found and fixed. Two of them (bugs 7 and 8) were found only
when the live OpenAI path started working, and they are the ones that matter most:
the app's structured-output contract silently depended on the provider honouring
`response_format`, and the response-analysis prompt had no rule for the partial
settlement that is the ordinary outcome of a deposit negotiation. Neither could
have been found by a mocked suite, because a mock is written by the same person
who wrote the expectation. One defect (bug 1) was in the test mock rather than the
application.

---

## Engineering

### Bugs found and fixed

**1. The statement-extraction contract was broken in the mock (the real cause of
the reported extraction failure).**

`npm run seed` failed with:

```
email: INBOUND FAILED "The statement could not be read as structured data."
```

Traced through the actual data rather than the symptom:

- the webhook was accepted and stored correctly;
- the app sent the correct prompt to the model (`Subject: …\n\nSecurity deposit:
  $1,500\nCarpet replacement: $450\n…`), confirmed by inspecting the recorded
  request;
- `scripts/mock-providers.mjs` `categoryFor()` fell back to the string
  `"OTHER"`.

`convex/validators.ts` defines the legal categories as
`ORDINARY_WEAR | TENANT_DAMAGE | FEE | UNKNOWN`. `"OTHER"` is not among them, so
`parseDepositStatement` correctly rejected the response and the whole statement
failed. **The application was right and the mock was wrong** — it refused to
persist a deduction with an unrecognised category, which is exactly the
validation-before-persistence rule the project requires.

Why it had gone unnoticed: every record in the e2e fixture
(`Painting`, `Carpet replacement`, `Broken cabinet`, `Administrative fee`)
happens to match a known pattern, so the fallback was never reached. The seed's
`Cleaning: $100` was the first line to fall through.

Fix, in the mock only:

- the fallback is now `UNKNOWN`, the app's own "not enough information" value;
- the classification patterns now mirror `EXTRACTION_SYSTEM_PROMPT` (fee /
  tenant damage / ordinary wear) instead of four ad-hoc regexes;
- `assertCategory()` throws if the mock ever emits a value outside the enum, so
  this fails loudly at the source instead of silently downstream.

No application code was changed to make anything pass, and no test was weakened
or deleted.

**2. The palette failed WCAG AA for text.**

`--cb-ink-muted: #8b939c` measured **2.63–3.11:1** against every surface while
carrying real content — the uppercase micro-labels (`POTENTIALLY DISPUTABLE`),
timestamps, hints and the disclaimers. That passes only as "large text" and is
used almost entirely at 10–11px. Changed to `#636c77`, which measures
**4.51–5.33:1** on all four surfaces. Every other token already passed
comfortably (ink 15.1–17.8, secondary 5.2–6.1, accent 8.0, attention 6.3,
danger 6.4).

**3. The case table was clipped rather than scrollable on narrow screens.**

The table sits inside a `Panel` with `overflow-hidden`, so on a phone the
remaining columns were cut off at the panel edge with no way to reach them. Added
an `overflow-x-auto` wrapper, and shortened the `Potentially disputable` header
to `Disputable` below `sm` (the full label is ~160px at 10px uppercase tracking
and does not fit beside the case reference).

**4. Two defects in the new live-verification harness (self-inflicted, found by
running it).**

- The AgentMail probe reported *both* `ok` and `FAIL` for the same check: the
  body was read eagerly inside the check's detail argument, which consumed the
  stream so the later `json()` call threw "Body has already been read" — which
  then looked like an auth failure when the credential had in fact been
  accepted. The body is now read exactly once, up front.
- A provider *account* problem was reported as an app-level failure. A 402
  ("this model requires a subscription") and a 429 ("1 request per minute") say
  nothing about the validation boundary. These are now classified separately,
  reported as `skip` with the real reason, and a 429 is retried once after the
  delay the provider itself names.

**5. Dead motion CSS.** `cb-rise` / `.animate-rise` were referenced nowhere.
Removed.

**6. Every screen hung forever, with a misleading message, when the backend was
down.**

Reported from use: the New Case page showed a permanent
`Your workspace is still loading. Try again in a moment.` and would not submit.
The cause was that the Convex deployment was not running (`curl
http://127.0.0.1:3210/version` → `os error 10061`, connection refused). Next.js
was still serving, so the page rendered and looked healthy.

The reason it presented as an endless spinner rather than an error is a real
defect: `components/demo-user.ts` (since replaced by `components/current-user.ts`,
which keeps the same timeout) relied on `.catch()` to surface a connection
problem, but **a Convex mutation against an unreachable deployment does not
reject** — the client queues it against a socket that never connects, so the
promise never settles. `userId` and `error` both stayed null forever, and no
timeout existed to break the wait.

Fixed with an 8-second reachability timeout that replaces the indefinite wait
with an actionable message naming the two commands needed to start the stack. A
slow-but-successful response clears the warning it raced, and the effect is
cancellation-safe.

The generalisation is worth carrying forward: **`useMutation` / `useQuery`
against a dead Convex deployment hang rather than reject**, so any UI that gates
on a Convex result needs its own timeout to fail diagnosably.

**7. The structured-output contract silently depended on the provider honouring
`response_format`.**

Found by the first successful live run (below): the real model returned a letter
as `{"letter": "Dear Landlord, …", "supportingSourceIds": ["S1","S2"]}` for a
schema that asks for `recipient`, `subject`, `body`. The letter *content* was
excellent — cautious, attributed to the retrieved passages, asking for exactly
the $850 the backend computed, citing no statute — but it failed
`letterOutputSchema` and the whole step was discarded.

The cause is not the model and not the schema. The app sends
`response_format: {type: "json_schema", json_schema: {strict: true, schema}}`,
and the configured gateway answers **`200 OK` while ignoring the schema
entirely**. Probed directly:

```
=== A. json_schema strict (what the app sent) -> HTTP 200 ===
top-level keys: letter, supportingSourceIds
schema-valid: no — recipient, subject, body

=== B. json_object + schema spelled out in the prompt -> HTTP 200 ===
top-level keys: recipient, subject, body, supportingSourceIds
schema-valid: YES
```

The app already had a fallback for gateways that do not implement `json_schema`,
but it keyed off an HTTP **400** — and this gateway reports success. So a working
model looked like a broken one, and the fallback never fired.

The fix is the generalisation rather than a special case: **the JSON Schema is
now carried in the prompt on every call, not only in the 400 fallback.** A
provider that honours `response_format` still gets strict enforcement; a provider
that ignores it still gets the schema. Cost: a few hundred tokens per call.
Nothing about validation-before-persistence changed — this only makes the model
more likely to produce something valid, and a response that still does not match
is still refused.

**8. The response-analysis prompt had no rule for a partial settlement, so the
most likely real reply could not be read at all.**

The second live failure was the same shape. For a reply that says

> I will refund $450 for the carpet replacement… I am not going to refund the
> painting or the cleaning charges

the real model returned `acceptsDispute: true` **and** `rejectsDispute: true`,
and `validateResponseAnalysis` discarded the reading — correctly, because it
refuses a reply that both accepts and refuses the dispute.

The validator was right and the prompt was wrong. Its rules said only
"acceptsDispute: the reply concedes the dispute" and "rejectsDispute: the reply
refuses the dispute", with nothing about the mixed case — which is not an edge
case but the ordinary outcome of a negotiation, and the case the product is built
around. The prompt now states that both flags describe the dispute **as a whole**,
that a reply conceding some charges while refusing others is **neither**, that
both flags must then be false, that the concession is recorded through
`offersPartialReimbursement`, and that setting both flags is never allowed.

The rule was chosen to match the existing validator rather than to loosen it, and
a check was added for the reading it produces: a partial settlement must be
**storable** as an offer with its figure, claiming neither verdict. That guards
against a prompt that asks for something the validator would still reject.

### Tests passing

| Suite | Result | What it covers |
| --- | --- | --- |
| `npx tsc --noEmit` | clean | whole repo, including `scripts/` |
| `npx eslint .` | 0 errors, 5 warnings | 4 warnings are unused `eslint-disable` directives inside `convex/_generated/*` (generated code); the 5th is a pre-existing anonymous-default-export warning in `convex/auth.config.ts` |
| `npm run build` | compiles, typechecks, generates all routes | Next.js 16.3.4 production build — see the note below on the environment's cleanup guard |
| `npm run verify` | **388/388** | schema, prompts, validation, maths, letter, send contract, response analysis, WCAG AA contrast, **and the caller-identity decision + a source scan that no public function trusts a `userId` argument** |
| `npm run verify:ui` | **201/201** | server-renders the real `CaseOverview` / `CaseLetter` / `CaseCommunication` / `CaseDeductions` / `CaseFinances` / `CaseInvestigation` / `CaseStatement`, **plus all three states of the sign-in gate** |
| `npm run verify:e2e` | **270/270** | live local deployment + mocks. **2 further checks report SKIP, not pass** — see the note under Authentication |
| `npm run verify:auth` | **12/12** | the authenticated path against a real deployment that honours tokens |
| `npm run verify:live` | **5/5, 4 skipped** (blocked account) · 21/21 when checked in | real providers (see Integrations) |
| `npm run seed` | works | drives the real pipeline to $1,500 / $1,000 / $850 |

New coverage added this pass:

- **e2e section 35 — the extraction category contract.** Delivers a statement
  containing a charge the classifier cannot place (`Miscellaneous charge: $75`)
  and asserts the email is `PROCESSED` and the category is `UNKNOWN`.
  **Proved meaningful**, not just green: restoring `return "OTHER"` made exactly
  those 4 checks fail with the real error (`The statement could not be read as
  structured data.`) while the other 235 still passed. 234 → 239 checks.
- **e2e section 36 — a reply with no readable text, and reading a reply twice.**
  Delivers a landlord reply whose body is whitespace only and asserts it is
  accepted as a reply, stored, refused as unreadable for the real reason, that no
  reading is invented, that the case is not rewound and the deductions are not
  touched, and that an earlier reading survives it. Then asserts that re-reading a
  reply that already has a reading is refused with `This reply has already been
  read`, that the refusal changes nothing, and that a genuinely failed reply *can*
  be retried. **Proved meaningful**: removing the empty-body guard from
  `analyzeLandlordResponse` failed 13 of these checks — the empty reply came back
  `COMPLETED`, i.e. the model invented a reading from nothing, and a prompt was
  appended to the provider log. 239 → 261 checks.
- **e2e section 4 — the JSON Schema really is carried in the prompt.** Asserts
  against the prompt the mock actually recorded that the schema instruction is
  present and matches the schema the app validates against, so the fix for bug 7
  cannot silently regress. 261 → 264 checks.
- **`verify` — 26 WCAG AA contrast checks** that parse `app/globals.css` and
  compute the ratios, so a palette regression fails the build rather than
  shipping. 325 → 351 checks.
- **`verify` — 8 checks on the response prompt with no message at all**, so a
  bodyless reply cannot be handed a row of blank or `undefined` headers if it ever
  reaches the builder. 351 → 359 checks.
- **`verify` — 7 checks on the partial settlement** (bug 8): the prompt must scope
  both verdict flags to the dispute as a whole, must say a partial concession is
  neither verdict and must forbid setting both — and the reading that rule
  produces must be *storable* as an offer of $450 claiming neither verdict, so the
  prompt cannot ask for something the validator still refuses. 359 → 366 checks.
- **`verify:ui` — the case page itself.** Renders `CaseOverview` with a real case
  and asserts the deposit, the deductions, the status, the statement sender and
  attachment, the inbound address and every stored deduction come from the
  fixture, plus that the money block's share is *derived* from the two stored
  figures (45% of $1,000 from a $450 disputable total) — the assertion that fails
  if a total is ever hardcoded rather than read from the backend. The existing
  `cases:get → null` checks were paired with this positive render, because on
  their own they would also pass for a page that renders nothing. 149 → 167.
- **`verify:live`** — a new, deliberately separate harness for the real
  providers (below).

### The reported E2E financial discrepancy

**It does not reproduce, and it is resolved for the correct reason.** The suite
passes 264/264, including the checks that guard exactly this:

- `the disputable total never exceeds the total deductions`
- `the disputable total still equals the stored assessments`
- `the disputable total survives the reply`
- `the letter snapshots the case disputable total`
- `a case with no findings keeps a zero disputable total`
- `a LIKELY_VALID deduction contributes 0`
- `the disputable amount is capped at the stated deduction (mock claimed 9999)`

The cause was a **test race, not an application bug**: the case total is
recomputed in its own transaction after each assessment, so a check that read the
case row immediately after the deductions were stored could observe the previous
figure. The fix was to add convergence waits *before* the totals assertions
(wait for the specific post-condition) rather than to change any expectation or
loosen any bound. No assertion was weakened.

The invariant itself is enforced in the backend and was verified directly:
`validateAssessment` clamps with
`Math.min(output.potentiallyDisputableAmount, options.deductionAmount ?? 0)`, and
`computePotentiallyDisputableAmount` reduces
`Math.max(0, Math.min(d.potentiallyDisputableAmount ?? 0, d.amount ?? 0))`. The
mock deliberately claims `9999` for a $300 deduction to prove the cap is real,
and the stored result is 300.

### Remaining technical issues

- ~~**The production build cannot exit cleanly in this environment, though it
  builds.**~~ — **no longer reproducing.** During this pass `npm run build`
  completed *and exited 0*, twice in a row, including finalization:
  `✓ Compiled successfully`, `✓ Generating static pages (6/6)`, the full route
  table, no `SAFE_DELETE_BULK_CONFIRM_REQUIRED`. The earlier failure was in the
  build's own cache cleanup (55 files deleted against a guard threshold of 50),
  not in compilation. The condition is evidently not stable across runs, so the
  guidance stands either way: **judge the build by its artifacts**, and stop a
  running `next dev` first, since it holds `.next` open.
- **`curl -o /dev/null` exits 23 in this Git Bash**, silently short-circuiting any
  `&&` chain after it — and making a `for` loop with `|| echo down` print "down"
  on a 200. Environment quirk, worth knowing.
- ~~`users.get` and `users.createOrGet` are currently unreferenced and
  unauthenticated~~ — **resolved.** `users.get(userId)`, which returned any row
  for any id, has been deleted and replaced by `users.current` (no argument, the
  caller's own row). `users.createOrGet` and `users.ensureDemo` survive because
  the e2e harness and seeder need them, but both now refuse unless the deployment
  sets `ALLOW_DEMO_IDENTITY=true`.
- The stack script reports readiness per service, but it cannot tell whether
  Convex pushed the *current* code beyond matching the "functions ready" line —
  if a push fails after that line, the script would not notice.
- **An orphaned Convex backend blocks the next one.** `npx convex dev --once`
  refuses while port 3210 is held, and the orphan keeps answering queries while
  serving stale code. Recovering means stopping the process on 3210 and starting
  a fresh `npx convex dev`. This cost a false negative during this pass.

### Developer-experience fixes made alongside

Two things made this pass harder than it needed to be, and both are now fixed.

**`npm run verify:e2e` no longer buffers its output.** It used to collect every
check and print them only at the end, so a run whose mock had died sat silent for
minutes and was indistinguishable from a hang — a 4m50s run was invalid for
exactly this reason. Checks now stream as they run, and `waitFor` announces what
it is waiting for (and says so again after five seconds). Verified: 85 lines on
screen 12 seconds into a run, where previously there were 4.

**`npm run stack` starts the whole local stack in one command** —
`npx convex dev`, the mock providers and `next dev` — with prefixed, colour-coded
output and a readiness line per service, including Convex's own "functions ready"
(the only proof the deployment received the current code). It skips any service
whose port is already in use, and if a child exits unexpectedly it says so and
shuts the rest down rather than leaving a half-dead stack.

It also fixes a real Windows defect: with `shell: true` the handle held is
`cmd.exe`, not the server, so a plain `kill()` terminates the shell and can leave
`convex dev` / `next dev` running and detached — which is precisely how these
services get orphaned. Shutdown now walks the process tree with `taskkill /T` on
Windows. Dependency-free, as the brief requires.

Verified by starting all three from cold: `✓ mocks` (4590/4591/4592),
`✓ next` (http://localhost:3000), `✓ convex` ("deployment is up and has the
current functions"), after which `users:ensureDemo` resolved and
`GET /cases/new` returned 200.

**The offline UI harness now bundles to CommonJS.** Extending it to the whole
case page pulled in `next/link`, which is CJS and dynamically requires
`react/jsx-runtime` — impossible to express in an ESM bundle. Rather than stub
Next's `Link` and lose fidelity, the bundle format changed, so the markup the
harness asserts is the markup Next itself produces. Only `next/navigation` is
stubbed (there is no App Router context in a plain Node process; the real
`usePathname` returns null and `AppShell` throws on `pathname.startsWith(...)`),
and `convex/react` gained the `useAction` hook the case page needs.

One consequence worth knowing when reading a run: a **successful** `waitFor`
adds no check, so a failing run reports two more checks than a green one — the
totals differ by the number of timed-out waits.

---

## Integrations

### OpenAI — **LIVE VERIFIED, but gated by a daily account check-in**

**Current status at the time of writing: blocked upstream, 4 checks skipped.** The
gateway returns

```
402 — {"type":"billing_error","message":"Daily check-in required to use free
models. Please visit https://apinex.bond/airdrop?tab=quests to check in."}
```

This is an **account-level requirement on a free tier**, not an app defect — the
app never receives a response to validate, so the run reports the four OpenAI
checks as `skip` with `this says nothing about the app`. It is also a *daily*
gate, so the live path is available only on days the account has been checked in.
Re-run `npm run verify:live` after checking in to reproduce the result below.

The configured gateway (`https://api.apinex.bond/v1`, model `free/gpt-5.6-luna`)
has served the model, and on that occasion `npm run verify:live` ran the real
prompts, the real JSON Schemas and the real validators end to end. Every OpenAI
check passed:

```
ok   a real statement survives the extraction schema
ok   the real model reads the deposit amount
ok   the real model finds every itemized deduction
ok   every category the real model returns is one the app accepts
ok   the real model does not judge the deductions
ok   a real assessment survives evidence-backed validation
ok   a real assessment never exceeds the stated deduction
ok   a non-disputable outcome contributes exactly zero
ok   the cited source ids are real stored ids, not model-invented labels
ok   a real letter survives the claim and evidence checks
ok   the real letter asks for the figure the backend computed
ok   the real letter rests on a real stored source
ok   the real letter makes no statute or case-law citation
ok   a real landlord reply survives response validation
ok   the reply is read as an offer of $450, not as invented text
ok   an offer of money is not also recorded as a refusal of the whole dispute
```

That is the point of this harness: the mocked suites cannot tell you whether a
real model still satisfies the boundary that guards persistence, because a mock
is written by the same person who wrote the expectation.

**It immediately found two real defects** — bugs 7 and 8 above — neither of which
any mocked suite could have caught. Both are fixed, and the run above is the
result. Nothing was weakened to make them pass: bug 7 was fixed by making the
app's contract independent of the provider, and bug 8 by making the prompt match
the validator that was already right.

Historical note, because it is why this section previously read PENDING, and
again reads blocked: an earlier attempt returned
`402 — "This model is currently available only with a subscription."` That block
lifted, the checks passed 16/16, and the account has since begun requiring a
**daily check-in** for free models. Nothing in the app changed across any of
these transitions — the two defects below were found *because* it started
working, and the current block is purely an account condition.

**Stated plainly:** this is one model, on one gateway, over a handful of runs, on
days the account is checked in. It demonstrates that the validation boundary
holds for real model output; it is not a statistical claim about model
reliability, and a different model may fail validation more often. When it does,
the failure is safe — the response is refused and the step reports why rather
than storing something unvalidated.

### AgentMail — **partially verified; send/reply pending**

**Verified live (read-only):**

- `ok the AgentMail credential is accepted` — the real API accepted the key.
- `ok the AgentMail inbox list has the documented shape`.

**Not verified: a real outbound send and a real inbound reply.** Both require a
real recipient address, which this harness must not invent, and a real send is an
irreversible external side effect. The outbound and reply paths are verified
against the mock provider (which threads conversations, reuses threads and
rejects `fail@` recipients), including idempotency, retry-after-failure,
stale-claim takeover, and reply classification — but that is **mocked**, not
live, and is reported as such.

To close this: run one real send to a mailbox you control, reply from it, and
confirm the reply lands on the case.

### Firecrawl — **LIVE VERIFIED**

- `ok live search returned at least one result`
- `ok the official-source filter keeps government hosts`
- `ok no law-firm or forum host is classified as official`

Real search results came back and `classifyAuthority` correctly separated
government hosts from SEO/blog/forum pages.

### Mocked versus live is kept explicit

The mocked suites (`verify`, `verify:ui`, `verify:e2e`) are separate from
`verify:live`, which is the only thing that touches the network. `verify:live`
prints `LIVE INTEGRATION VERIFICATION` and `This is not the mocked suite` at the
top, and exits non-zero only on a genuine validation failure — a blocked account
is reported as `skip`, never as a pass. Current state: **5/5 executed, 4
skipped** — the four OpenAI checks, blocked by the daily check-in above. On a day
the account is checked in the same command reports **21/21, 0 skipped**. The only
thing it deliberately does not do is send real mail.

### A note on the local backend

`npx convex dev --once` refuses while a local backend holds port 3210, and an
orphaned backend answers queries normally while serving **stale code** — which is
exactly how the first attempt at the bug-7 fix appeared to fail. The run was only
trustworthy after a fresh `npx convex dev` printed `Convex functions ready!`. Two
e2e checks failed against the stale backend and passed against the fresh one, with
no code change in between; that is the whole reason this is called out.

---

## Authentication

**Current state: implemented, and the authenticated path is verified against a
real deployment.** The earlier draft of this report said no authentication
rewrite was attempted; that is no longer true, and this section replaces it.

### What the server does now

The caller's identity is **derived from the session token**, never accepted from
the client. `convex/caller.ts` holds the decision; 24 public functions across 9
modules call it, and a source scan in `npm run verify` fails the build if any
public function with a `userId` argument does not.

- `identity.subject` is `userId|sessionId`, not a bare id — splitting it is the
  difference between a session that works and one that silently never matches.
  The split, the precedence and the refusal reasons are pure functions, so they
  are tested offline (11 checks) rather than only through a live deployment.
- **The branch order is the security property.** A session returns immediately,
  so on the authenticated path the `userId` argument is never read at all. This
  is asserted directly: a token minted for an *empty* user that claims the id of
  a user owning cases returns **0 cases**, while the same claim without a session
  returns that user's cases. Those two answers differ, which is what makes the
  check able to fail.
- `userId` is still accepted as an argument, but only as the *demo* identity, and
  only when the deployment sets `ALLOW_DEMO_IDENTITY=true`. It is off unless the
  value is exactly `"true"` — `"1"`, `"yes"`, `"TRUE"` and `"true "` all leave it
  off, and all seven cases are checked. A deployment that has not opted in cannot
  be made to mint users.
- `users.get(userId)` — which returned any row for any id — is gone, replaced by
  `users.current`, which takes no argument and returns the caller's own row or
  `null`. There is deliberately no way to ask for someone else's row.

`users.ensureDemo` and `users.createOrGet` are **kept, not deleted**, because the
local e2e harness and `npm run seed` use them to fabricate the second user the
cross-user refusal tests need. They are the reason the demo gate exists at all:
the function survives, the anonymous path does not.

### What the client does now

`components/demo-user.ts` is deleted. In its place:

- `ConvexAuthProvider` replaces `ConvexProvider`, so the session token is
  attached to every request.
- `useCurrentUser` reports `isLoading`, `isSignedIn` and `userId` as **three
  separate answers**, because conflating them is how a signed-out visitor ends up
  staring at a skeleton forever.
- `WorkspaceGate` wraps every screen that shows case data. Children render only
  once a user exists, so the unreachable-backend message, the loading state and
  the sign-in prompt are handled once rather than four times.
- `SignIn` is a two-step emailed-code form. The code field does not exist until a
  code has been requested — asserted in the offline harness, because a form that
  shows the code input up front invites a visitor to type a code for an address
  they have not proved they control.
- `CaseOverview` now takes `userId` as a **prop** rather than resolving it
  itself. That keeps the identity decision in one place and makes the whole case
  screen renderable offline, which is how the UI harness verifies it.
- The shell previously read *"Cases here are shared by everyone using this
  deployment"*. That was true of one shared demo row and is a **false claim** now
  that cases belong to an account, so it was replaced with the signed-in address
  and a sign-out action. Two checks guard it from coming back.

### How this is verified, and what is *not*

`npm run verify:auth` proves the authenticated path against a deployment that
genuinely accepts tokens. It mints a real RS256 token with the deployment's own
`JWT_PRIVATE_KEY` and the same claims Convex Auth emits, so it is
indistinguishable from a token a real sign-in would produce.

**The authenticated path cannot be verified on a local backend, by construction.**
Convex fetches the auth provider configuration from the site host before it will
trust a token, and that request never reaches the local router — a fresh local
deployment 404s too, and a temporary catch-all route confirmed the discovery
request never arrives. Every token is therefore rejected with
`AuthProviderDiscoveryFailed` before any function runs.

This matters because **the first version of the e2e auth checks passed
vacuously**. They tested `response.status !== "error"`, but the rejection Convex
returns has no `status` field, so an unrecognised response read as a success. The
two checks now report `SKIP` with the reason and are **excluded from the total** —
`270/270 (2 not verified on a local backend)` — so the number cannot be misread
as "the authenticated path is verified". A check that cannot fail is not a check;
a check that cannot run must not be counted as one.

### Before real users

1. **`ALLOW_DEMO_IDENTITY` must be unset in production.** While it is set, any
   caller can act as any user id. It is set on the cloud dev deployment today.
2. **`AUTH_EMAIL_TRANSPORT=log` must become `agentmail`** (plus
   `AUTH_EMAIL_INBOX`) on the cloud deployment, or sign-in mail is written to the
   Convex logs instead of being delivered.
3. **`SITE_URL` is `http://localhost:3000`.** It is the issuer and audience the
   auth tokens are minted against, so a deployed origin must be set or sessions
   will not validate against the real host.
4. **The `AGENTMAIL_WEBHOOK_SECRET` on the cloud deployment is a real secret, not
   the harness's test value** — checked during this pass, and *not* the
   `whsec_bW9ja3NlY3JldGZvcnRlc3Rpbmc` the local suites use. It still needs a
   deliberate rotation policy, but the earlier note claiming it was the test
   secret was wrong.
5. There is no Next.js SSR auth integration (`ConvexAuthNextjsProvider`). The
   pages are statically prerendered and the session resolves on the client, so the
   first paint is the loading state. That is correct but not optimal; it would
   need cookie-based server auth to improve.
6. Rate limiting is whatever Convex Auth's own `authRateLimits` table provides —
   no additional throttle was added on the sign-in endpoint.
7. The live OpenAI path depends on a **manual daily account check-in**. Nothing in
   the app can compensate; a real deployment should use a paid model.

Nothing in the UI or this report claims more than the above.

---

## UI

### Screens redesigned

1. **Case Overview** — the money block leads. `Potentially disputable` is
   visually dominant (3.25–3.75rem, tabular), with the deposit and the landlord's
   claim as the context it sits against, plus a restrained share bar. The
   disclaimer is explicit that the figure is *not* money recovered.
2. **Document ingest** — the statement panel reports the real backend
   progression (received → reading → N deductions → failed with the real reason
   and a retry). It never claims deductions were found while the statement is
   still being read, and a case with no mail fabricates nothing.
3. **Financial count-up** — the headline figure counts up once when it is first
   revealed, and the true value is rendered on first paint so the server-rendered
   HTML is correct and a reduced-motion user sees the final number immediately.
   Nothing else on the page animates its number.
4. **Intelligence timeline** — reports auditable actions and outcomes only
   ("Official sources retrieved", "Evidence connected", "Deductions assessed",
   "Dispute sent"). It never exposes internal reasoning.
5. **Evidence investigation** — one deduction at a time, revealing the chain:
   landlord claim → official source → Clawback finding → the evidence it rests
   on. A finding with no source is stated as such rather than implied.
6. **Evidence source panel** — title, authority, jurisdiction, the quoted
   passage and a link to the original. With exactly one source the passage opens
   by default, because the quoted text is the reason the finding can be trusted
   and hiding it behind a click works against "why is Clawback saying this?".
7. **Dispute letter workspace** — the document with the supporting evidence
   beside it. Selecting a piece of evidence highlights only the paragraphs that
   genuinely name that deduction or authority; if nothing matches, nothing is
   highlighted. Edit → Save → Present for approval → Approve → Send are separate,
   deliberate steps, and an approved or sent letter is locked.
8. **Communication** — the AgentMail loop reads as part of the case, not as a
   separate mail client.
9. **Micro-interactions** — restrained by design: two animations total
   (`.animate-fade`, `.animate-sweep`), plus CSS transitions on hover, focus and
   disclosure. No blobs, gradients, cursor-following, parallax, particles or
   shimmer. Motion communicates state, and all of it collapses under
   `prefers-reduced-motion`.

### Design-system changes

- **Colour tokens** (`--cb-page/surface/surface-muted/surface-sunken/line/
  line-strong/ink/ink-secondary/ink-muted/accent/accent-strong/accent-soft/
  accent-line/attention/…/danger/…/shadow-*/radius`) — all raw hex lives in
  `app/globals.css` and nowhere else.
- Fixed a **build-breaking** gap: the shadcn bridge set `--ring` in `:root` and
  used `@apply outline-ring/50`, but never declared `--color-ring` (or the other
  shadcn colours) in `@theme inline`, so the build failed outright and several
  classes (`bg-muted`, `border-input`, `ring-ring`, …) resolved to nothing.
- **`--cb-ink-muted` darkened for WCAG AA** (see Engineering).
- Removed dead motion CSS.

### Responsive and accessibility

- Desktop is the reference: containers use `px-5 sm:px-8 lg:px-10`, two-column
  grids collapse at `lg`/`xl`, and the case table progressively drops columns
  (`hidden sm:table-cell` / `md:` / `lg:`) rather than squeezing them.
- Tablet and mobile: the sidebar becomes a horizontal nav strip, the money block
  stacks, the letter/evidence pair stacks, and the table scrolls horizontally
  instead of being clipped.
- Accessibility: a single consistent `:focus-visible` outline on every
  interactive element; `.tabular` for aligned figures; decorative icons marked
  `aria-hidden`; form fields wrapped in `<label>`; the letter body textarea
  labelled; errors in `role="alert"`; `aria-expanded` on disclosure controls;
  `aria-current="page"` on the active nav item; `sr-only` loading announcements;
  and a full `prefers-reduced-motion` block.
- **Contrast is now enforced by test** rather than by eye.

What the static responsive pass actually found, so the claim is checkable:

- **Zero hardcoded pixel widths** in `components/` or `app/` — no `w-[Npx]`,
  `min-w-[Npx]` or `max-w-[Npx]`. Every width is a percentage, a `max-w-*` scale
  value or intrinsic, so nothing can pin the layout wider than a 375px viewport.
- **Exactly two grids apply at every width, and both are deliberate.** The money
  pair in `case-finances` is 2-up on small screens and stacks at `lg`
  (`lg:grid-cols-1 lg:divide-x-0`) because that is where it moves into a sidebar
  column; the dashboard counters are 2-up with the third spanning
  (`col-span-2`). Both hold small, bounded content.
- **The two elements that can legitimately overflow horizontally each own a
  scroll container** — the case table and the mobile nav strip are both inside
  `overflow-x-auto`, so they scroll rather than clip.
- `flex-wrap` appears on 17 rows across 10 components, so label/value and
  button rows reflow instead of pushing the page wide.
- **One latent edge, not exercised by the demo data:** the 2-up money pair leaves
  each figure roughly 120px of content width at 375px in `text-2xl`. The seeded
  $1,500 / $1,000 fit comfortably; a five-figure amount *with cents* would wrap to
  a second line. Left as-is rather than restyling a deliberate money-first
  choice — worth a glance if real deposits ever exceed $10,000.

**Honest limitation:** the environment blocks WebSockets, so Convex realtime does
not work here, and `agent-browser` does not support Windows. The UI was therefore
verified by server-rendering the real components (167 checks) and by static
analysis of the responsive/accessibility properties — **not** by a click-through
in a real browser. A manual pass on real devices at 375 / 768 / 1440px remains
worth doing before a live demo.

---

## Verification — the 10-step pass

Run in full, in order, after all changes. Steps 1–10 are the pass the brief asked
for; the unnumbered rows are the supporting suites it depends on.

| # | Check | Result |
| --- | --- | --- |
| 1 | TypeScript (`npx tsc --noEmit`) | clean |
| 2 | ESLint (`npx eslint .`) | 0 errors, 5 expected warnings (4 generated-file, 1 pre-existing) |
| 3 | Production build (`npm run build`) | compiles, typechecks and generates all 6 routes; **exited 0** including finalization on both runs this pass |
| 4 | UI checks (`npm run verify:ui`) | 201/201 |
| 5 | E2E (`npm run verify:e2e`) | 270/270, plus 2 reported SKIP and excluded from the total |
| 6 | Financial calculation tests | in `verify` + `verify:e2e` (cap, zero-contribution, sum-from-assessments, no-rewind) |
| 7 | State transition tests | in `verify` (all five forward-only gate lists) + `verify:e2e` (no rewind across revision, reply, retry, new draft) |
| 8 | Authorization tests | in `verify` (the identity decision, the demo-mode string check, and a source scan of every public function) + `verify:e2e` (intruder blocked on 10+ case-scoped operations) + **`verify:auth` against a real deployment (12/12)** |
| 9 | AgentMail tests | mocked in `verify:e2e` (idempotency, retry, takeover, threading, reply classification); credential live-verified; real send/reply not exercised |
| 10 | OpenAI validation tests | in `verify` (388 offline checks) **and live — 16/16 against the real model** |
| — | Offline pipeline (`npm run verify`) | 388/388 |
| — | Authenticated path (`npm run verify:auth`) | 12/12 against the cloud deployment |
| — | Live providers (`npm run verify:live`) | 5/5, 4 skipped (OpenAI blocked upstream); 21/21 when the account is checked in |
| — | Demo seed (`npm run seed`) | $1,500 / $1,000 / $850, status `EVIDENCE_FOUND` |

**The known E2E discrepancy is resolved for the correct reason** — a test race
fixed with convergence waits, not a weakened assertion. See Engineering.

**Live verification is only trustworthy against a fresh backend push.** The first
attempt at the bug-7 fix appeared to fail: two new e2e checks failed while the
live harness passed. The cause was an orphaned Convex backend holding port 3210
and serving stale code — the same trap recorded earlier in this project. After
`npx convex dev` printed `Convex functions ready!`, the same two checks passed
with no code change. Recorded here because a verification run that silently tests
old code is worse than no run.

---

## Do not change

The brief asked for an explicit list of things a future contributor must not
"tidy up". Every entry below is load-bearing, and every one was established by a
defect found during this work — none is stylistic preference.

| Invariant | Why it must survive |
| --- | --- |
| **`convex/_generated/*` is never hand-edited** | It is the contract the client and the types resolve against. A fabricated `api.d.ts` was once committed (`4cfe100`) and typechecked against nothing real. |
| **The policy/pipeline split** | `send.ts`, `response.ts` and `letter.ts` may only `import type` from `_generated`, and nothing in `verify-pipeline.ts` may import a pipeline module. Adding one runtime import drags `_generated/server` into the harness and silently stops 366 offline checks from running. |
| **The forward-only status gates** | A case must never rewind from `EVIDENCE_FOUND`. Patching status from any path that can run *after* analysis re-opens a rewind that the reply, retry and new-draft paths all rely on. |
| **One document per claim** | Bookkeeping on a row shared by concurrent siblings — the `cases` row, or a total recomputed across all `deductions` — exhausts Convex's retries and aborts the item with no error, leaving the UI showing a fake pending state. |
| **Run tokens on long work** | `researchRunId` / `assessmentRunId` / `generationRunId` are stamped at claim and re-checked at store, so a superseded pass cannot overwrite a newer result. |
| **Nothing is persisted before it is validated** | Every provider response goes through Zod and then a domain check. Model-supplied totals are never trusted: case totals are summed from stored per-deduction assessments, and the letter is handed the figure the app already computed. |
| **The JSON Schema stays in the prompt** (`schemaInstruction`) | `response_format` is a request, not a guarantee. The configured gateway answers `200 OK` to `json_schema` / `strict: true` and **ignores the schema**, so removing this silently rejects good output. This is bug 7. |
| **The empty-body guard runs before the model call** | Without `!claim.body.trim()` the model invents a reading from nothing and marks it `COMPLETED`, corrupting the record. Removing it fails 13 e2e checks. This is bug 8's sibling. |
| **The classifier stays biased toward "reply"** | After a dispute is sent, every later inbound message is treated as a reply. A statement misread as a reply is stored and shown; a reply misread as a statement runs `applyExtraction` and destroys the case's analysis. The asymmetry is the point — do not "tighten" it. |
| **The idempotency key shape, `send:{letterId}:v{version}`** | Per *document revision*, not per attempt. A double click, a retry and a replayed webhook must converge on one row and one delivered copy, while a revised letter needs a new key. A failed send retries by reusing its own row. |
| **Approved and sent letters are immutable** | A document that has left the building must never be regenerated or edited in place — that destroys the record of what the landlord received. `draftLetter` refuses both `APPROVED` and `SENT`; the only forward path is `startNewDraft`, which archives rather than deletes. |
| **Approval is a gate, not a send** | `approveLetter` marks the letter approved and leaves the case at `AWAITING_APPROVAL`. Sending stays renter-triggered. |
| **A reading that accepts *and* rejects is discarded** | The validator is right. If the model starts emitting both flags, fix the **prompt**, never the validator — loosening it admits contradictory readings into the database permanently. A mixed reply sets both flags false and records `offersPartialReimbursement`. |
| **`cases:get` returns `null` for a missing case** | Deliberately unlike the `Unauthorized` thrown for someone else's case, and the UI renders the two differently. Collapsing them loses the distinction between "this is gone" and "this is not yours". |
| **The branch order in `decideCaller`** | A session must return *before* the claimed id is read. The order is the security property, not style: it is what makes it impossible for a token to claim someone else's id. Swapping the branches still compiles and still returns a user — it just silently hands any caller any account. |
| **`ALLOW_DEMO_IDENTITY` is off unless exactly `"true"`** | This variable is the only thing standing between the app and "anyone can act as any user". `"1"`, `"yes"` and `"TRUE"` must stay false. If it were ever read as truthy, every deployment would accept anonymous ids again. |
| **The two identity checks stay honest about SKIP** | The e2e auth checks cannot run on a local backend. They must report `SKIP` and stay *out* of the total; folding them back into "passed" restores the vacuous pass that hid this for a full pass. |
| **`userId` is never compared against a client-supplied value** | `args.userId !== callerId` is the shape of the old IDOR. The source scan in `verify` fails the build on it, and the scan must keep covering every `query`/`mutation`/`action` export. |
| **Money in the UI is derived, never hardcoded** | The UI fixtures compute their totals from their line items, which is exactly what lets "the case page derives the share from the stored figures" fail when someone hardcodes a figure. |
| **`NEXT_PUBLIC_CONVEX_URL` is the only public environment variable** | No credential may reach the browser. Live keys stay in `.env.local`; the Convex deployment is pointed at the mocks separately. |
| **Fetched source content is data, never instructions** | Firecrawl results are untrusted input and are never treated as directives to the pipeline. |
| **The environment's bulk-delete guard is left alone** | It is what blocks `next build` finalization here (55 deletions against a threshold of 50). It is a safety control, not an obstacle to route around — judge the build by its artifacts instead. |

---

## Remaining Risks

1. **Authentication is demo-only.** Every visitor resolves to one shared user and
   every case is visible to everyone on the deployment. This is the single
   biggest gap to any real use. Not production-ready for multiple users.
2. **AgentMail send and reply are mock-verified only.** Threading, idempotency and
   reply classification are well covered against a mock that behaves like the
   provider, but no real email has been sent or received.
3. **The live OpenAI result is one model on one gateway.** It shows the validation
   boundary holds for real model output; it is not a statistical claim about
   reliability. A different model may fail validation more often — safely, since a
   rejected response is refused and reported rather than stored.
4. **The configured gateway does not implement `response_format`.** It returns
   `200 OK` and ignores the schema. The app now carries the schema in the prompt,
   which fixes it for this gateway and for any other that ignores
   `response_format`; a provider that ignored *both* would still fail, and would
   still fail safely. The extra schema text costs a few hundred tokens per call.
5. **Exactly-once delivery is not guaranteed across a stale-claim takeover.** If a
   `SENDING` claim times out and is taken over, the earlier attempt may have
   reached AgentMail without reporting back, so the landlord can receive two
   copies. AgentMail's send endpoint has no idempotency key to close this. The
   takeover writes a `SEND_ATTEMPT_ABANDONED` timeline event naming the risk
   rather than hiding it.
6. **One e2e assertion depends on the mock's bounded prompt log.** Section 36
   proves that reading an empty reply costs no model call by asserting the
   OpenAI mock's last-ten-prompts log is unchanged across the section. That is
   sound only while no other scheduled work appends a prompt in the same window;
   a late-firing action from an earlier section would fail it spuriously. It
   reports the newest prompt's opening words when it fails, so a spurious failure
   is distinguishable from a real one at a glance.
7. **No real-browser walkthrough.** WebSockets are blocked and `agent-browser`
   does not run on Windows, so responsive behaviour and realtime updates were
   verified statically, not by interaction.
8. **Legal caution is a prompt-level and validation-level guard, not legal
   review.** The letter validator rejects statute and case-law citations and
   unsupported claims, and the UI never promises recovery — but the product's
   findings are "potentially disputable", and no lawyer has reviewed the output.

### What is not claimed

- Not production-ready: **AgentMail's real outbound send and real inbound reply
  are still unexercised**, and the deployment-hygiene items listed under
  Authentication (demo mode off, a real auth mail transport, `SITE_URL` pointed at
  the deployed origin) must be done first.
- **The live OpenAI path is currently blocked by the account**, not by the app —
  a daily check-in is required for free models. The 16/16 result below was
  obtained on a day the account was checked in, and is not reproducible right now.
- The authenticated path is verified against a **real deployment**
  (`npm run verify:auth`, 12/12) — but **not on a local backend**, and not at all
  by `verify:e2e`, whose two token checks report `SKIP`. That limitation is a
  property of Convex's auth discovery on the local host, not a gap that a longer
  wait or a retry would close.
- No amount is ever described as recovered. The figure is "$850 potentially
  disputable", computed on the server from stored per-deduction assessments.
- The mocked suites are not evidence of live provider behaviour. The live result
  is stated separately, with its own counts, and is the only thing that reflects
  the real providers.
