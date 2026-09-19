# The brief's 10 manual checks — what is actually verified

The brief closes with *"Also manually verify: 1. Existing cases still load … 10. No fake
UI states."* A browser walkthrough is impossible in this environment (WebSockets are
blocked, and the browser tool does not support Windows), so each item is mapped below to
the **machine check that actually covers it**, with the real check names and the e2e
section that proves it.

Read the verdict column as the claim being made — nothing here is asserted from memory.

| # | Check | Verdict |
|---|---|---|
| 1 | Existing cases still load | **Verified** |
| 2 | New cases still work | **Verified** |
| 3 | Deductions still come from Convex | **Verified** |
| 4 | Financial totals remain backend-derived | **Verified** |
| 5 | Evidence is real | **Verified** |
| 6 | Letter approval works | **Verified** |
| 7 | Sending unchanged | **Verified** |
| 8 | Landlord responses appear | **Verified** |
| 9 | Realtime updates work | **NOT verified locally** — see below |
| 10 | No fake UI states | **Verified** |

---

### 1. Existing cases still load

`verify:ui` renders the real `CaseOverview` and asserts the page is built from the case
row it was handed — *"the case page shows the deposit the case row holds"*, *"…shows the
deductions the case row holds"*, *"…shows the case's own jurisdiction"*, *"…shows the real
statement sender"*, *"…shows the real attachment"*, *"…itemises every stored deduction"*,
and *"a missing case does not claim a status"*.

`verify:e2e` §1 *User + case* creates a user and a case against the live backend and reads
them back.

### 2. New cases still work

`verify:e2e` §1 → §3 *Delivery + idempotency* → §4 *Extraction* → §7 *Case totals and
status* walks a brand-new case through the whole pipeline against a real Convex
deployment with mock providers: the case is created, mail arrives, deductions are
extracted, totals and status are written.

### 3. Deductions still come from Convex

The render harness keys its fixtures by the **Convex function name** (`fn.__name`), and
returns `undefined` for anything not stubbed — so a component that requested a different
or renamed function would render its loading state and fail its checks. All 245 pass,
including *"every deduction description is listed"* and *"the case page itemises every
stored deduction"*.

Independently, `verify:e2e` §4 and §17 *Source association* read the deductions back out
of the live backend through the API.

### 4. Financial totals remain backend-derived

- `verify` — *"the prompt carries the precomputed disputable amount"*: the letter is
  handed the already-computed figure rather than being asked to add anything up.
- `verify:ui` — *"the figures are disclosed as server-computed"*, *"the case page derives
  the share from the stored figures"*, *"the never-withheld figure is deposit less
  deductions"*.
- `verify:e2e` §15 — *Financial figures come from the case, not the model*.
- The deposit decomposition I added is pure arithmetic over the stored figures
  (`depositAmount`, `totalDeductions`, `potentiallyDisputableAmount`) — it introduces no
  new source of truth, and an over-claim case (`totalDeductions 2400 > depositAmount
  1500`) is a negative test in the harness.

### 5. Evidence is real

`verify:ui`, 7 checks: *"the real stored URL is linked"*, *"the second real stored URL is
linked"*, *"no fabricated URL is present"*, *"the relevant passage is quoted"*, *"no
fabricated source URL is present"*, *"a deduction with no stored source does not fabricate
a passage"*. The no-fabrication check asserts the rendered HTML contains neither
`example.com` nor `localhost`.

`verify:e2e` §5 *Research* and §17 *Source association* prove the sources come from the
research step and are attached to the right deduction.

### 6. Letter approval works

`verify:e2e` §19 *Case workflow up to approval*, §20 *Human approval (and nothing is
sent)*, §21 *An approved letter is immutable*, §22 *New draft after approval*, §24 *Letter
timeline*.

`verify:ui`: *"the awaiting state says approving does not send"*, *"an approved letter
offers no Edit"*, *"…no Regenerate"*, *"…no Approve"*, *"the approved letter explains it is
locked"*, *"an approved letter offers a new draft"*.

### 7. Sending unchanged

`verify:e2e` §27 *Outbound: addressing and pre-send validation*, §28 *Outbound: sending an
approved dispute*, §29 *Outbound: duplicate sends are refused*, §33 *Outbound: a revised
dispute, send failure and safe retry*.

`verify:ui`: *"a draft never offers to send"*, *"an approved letter never auto-sends"*,
*"nothing claims it has already been sent"*, *"the panel says the letter is only sent on
confirmation"*.

The only UI change in this area is **additive**: the communication log can now render the
message as stored at send time. No send path, mutation or idempotency key was touched.

### 8. Landlord responses appear

`verify:e2e` §30 *Inbound: the landlord's reply lands on the right case*, §31 *Inbound:
duplicate webhooks*, §32 *Response analysis*, §36 *A reply with no readable text, and
reading the same reply twice*.

`verify:ui`: *"the inbound reply is listed"*, *"the reply shows it was received and read"*,
*"the landlord's own words are shown verbatim"*, *"the reading is labelled as a reading"*,
*"the reading shows the offered amount"*, *"a flag the reply does not support is not
shown"*.

### 9. Realtime updates work — NOT verified locally

**This one cannot be verified in this environment, and I am not claiming it.** Convex
realtime runs over a WebSocket, which this sandbox blocks; the render harness exists
precisely because of that, and it *stubs* `convex/react` rather than connecting.

What **is** verified:

- The components still request the same named Convex functions — the stub returns
  `undefined` for an unstubbed name, so a renamed or dropped binding would show up as a
  failing render check. None do.
- The live backend serves those functions — `verify:e2e` exercises them 270 times.
- **No Convex binding was added, removed or altered by the UI work.** The UI task touched
  seven component files; every edit is listed in `UI-RECREATION-REPORT.md`, and none of
  them is a `useQuery` / `useMutation` / `useAction` call. (The binding changes visible in
  `git diff components/` — the removal of `users.ensureDemo`, the added `userId`
  arguments — belong to the **earlier auth migration**.)

So the *wiring* is verified and the *transport* is not. Confirming the socket delivers
live updates needs a real browser, which this environment cannot provide.

### 10. No fake UI states

15 checks in `verify:ui` are honesty checks of exactly this kind:

*"no letter document is shown while generating"*, *"a failed statement does not claim
success"*, *"an in-flight statement does not claim deductions were found"*, *"a case with
no mail does not fabricate a statement"*, *"the timeline does not claim a dispute is ready
when no letter exists"*, *"a partly reviewed case does not claim every deduction was
assessed"*, *"a deduction with no stored source does not fabricate a passage"*, *"a missing
case does not claim a status"*, *"it does not invent a message"*, *"the shell does not
claim the cases are visible to other accounts"*.

The two increments added in this task were both held to this standard: the deposit bar
names its third segment **"not withheld"** rather than "returned" (the app cannot know the
money was handed back), and a paragraph is only made interactive when its own text names
the evidence — with a negative control proving the count check fails if every paragraph is
linked.

---

## Reproducing

```
npm run verify        # 388 — offline policy, prompts, validation, maths, send contract
npm run verify:ui     # 245 — renders the real components; this is the UI evidence
npm run mocks         # :4590-4592 — required by the two suites below
npm run test:backend  # local Convex on :3210/:3211, then:
npm run verify:e2e    # 270 (+2 SKIP)
npm run verify:auth   # 12 — against the cloud deployment
```

`verify:e2e` and `verify:auth` need the mocks and the local backend running; they were
last run green before the orphaned dev stack was stopped (see the report's remaining
issues).
