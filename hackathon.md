# Hackathon Build Log

## 2026-09-11 — Milestone 1: Foundation + Case Management

- Initialized the Git repository.
- Created a Next.js App Router project with TypeScript, Tailwind CSS, ESLint, and npm.
- Initialized shadcn/ui with the default configuration.
- Installed Convex, Lucide React, `clsx`, `tailwind-merge`, and `class-variance-authority`.
- Created a local Convex deployment with `npx convex dev --once`.
- Added blank environment variable placeholders for OpenAI, Firecrawl, and AgentMail.
- Built dashboard with metrics, case list, and new-case form.
- Implemented case creation with timeline events and realtime Convex queries.
- Verified: TypeScript ✓, ESLint ✓, Production build ✓, Routes all 200 ✓

## 2026-09-12/13 — Milestone 2: Real Email Ingestion + AI Extraction + Case Intelligence

### Implemented

**AgentMail Integration** (`convex/agentmail.ts`)
- Inbox creation per case with deterministic local-part routing
- Webhook message normalization and schema validation
- Message body fetching for truncated payloads
- Sender/recipient address parsing (multiple formats)
- Attachment metadata preservation
- Error redaction to prevent API key leaks

**OpenAI Structured Extraction** (`convex/openai.ts`)
- Structured JSON responses with strict schema validation
- Fallback to JSON mode for gateways without `json_schema` support
- Timeout handling (60s)
- Safe error messages (no API keys exposed)
- Compatible with OpenAI-compatible gateways (Anthropic, local models, etc.)

**Email Processing Pipeline** (`convex/emails.ts`)
- Inbound email ingestion with idempotency via external message ID
- Email processing states: RECEIVED → PROCESSING → PROCESSED/FAILED
- Automatic case association via inbox routing
- Unassociated email handling (marked for review, not randomly attached)
- Webhook scheduler for async OpenAI extraction
- Transactional mutations ensure no half-written states

**Deposit Statement Extraction** (`convex/extraction.ts`)
- Zod schema validation (both parsing and stringification)
- Deduction categories: ORDINARY_WEAR, TENANT_DAMAGE, FEE, UNKNOWN
- Preserves landlord's exact wording (no translation/reinterpretation)
- Handles ambiguous/unquantified deductions (null amounts allowed)
- Prevents hallucination (no invented amounts or legal conclusions)
- System prompt enforces scope: extract only, never judge legality

**Convex Schema & Functions**
- Updated `emails` table with direction, processing status, provider, attachment metadata
- Updated `cases` table with inboxId, inboxStatus, inboxError fields
- `deductions` table: description, amount, category, sourceEmailId
- Case status transitions: RECEIVED → ANALYZING on successful extraction
- Timeline events created for each real action (email received, analysis started/completed)
- Authorization enforced: queries scoped by userId

**UI Components** (`components/`)
- `case-deductions.tsx`: Display extracted deductions with categories, itemized totals, unquantified count
- `case-finances.tsx`: Financial summary (Deposit / Total Deductions / Potentially Disputable)
- `case-email-address.tsx`: Show case-specific inbox address for forwarding statements
- `case-statement.tsx`: List received emails with processing status and error messages
- `deduction-category-badge.tsx`: Category color-coding (visual guidance only, no legal claim)
- Updated `case-overview.tsx`: Realtime deductions, financial updates, processing state indicators
- Updated `dashboard.tsx`: Real metrics from Convex queries

**Error Handling**
- Webhook signature verification (Svix) (`convex/svix.ts`)
- Malformed email rejection with safe logging (`convex/errors.ts`)
- Failed extraction recorded on email instead of silently swallowed
- Duplicate message detection (idempotency via external message ID)
- Missing/invalid case handling (email marked needsReview)

**Security**
- API keys stay server-side (no browser exposure)
- Browser → Convex/backend → OpenAI/AgentMail (never direct)
- Authorization checks on every query/mutation
- Error messages safe for user display (no secrets, no stack traces)

**Verification** (`scripts/verify-pipeline.ts`)
- Extraction schema validation (canonical statement, edge cases)
- Webhook payload normalization tests
- Prompt validation (confirms legal scope guards)
- JSON Schema strict structured-output compatibility
- Runs offline (no API calls required)

### Environment Variables Required

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4-turbo (or gpt-5, etc.)
OPENAI_BASE_URL=https://api.openai.com/v1 (or compatible endpoint)

AGENTMAIL_API_KEY=key_...
AGENTMAIL_DOMAIN=agentmail.to (optional, for custom domain)
AGENTMAIL_API_BASE_URL=https://api.agentmail.to/v0 (optional)

CONVEX_DEPLOYMENT=anon:...
NEXT_PUBLIC_CONVEX_URL=https://... (or http://127.0.0.1:3210 for local dev)
```

### Testing & Verification

- TypeScript: ✓ (no errors)
- ESLint: ✓ (16 pre-existing generated-file warnings, 0 code errors)
- Production build: ✓ (all routes compile)
- Extraction schema: ✓ (offline validation passes canonical + edge cases)
- Idempotency: ✓ (duplicate webhook retries produce no duplicate data)

### What NOT Implemented (Per Spec)

- Firecrawl legal research
- Legal validity determination  
- Evidence matching
- Dispute scoring
- Dispute letter generation
- Landlord response intelligence
- Vector database / RAG
- Background job framework
- Fake AI activity or fake legal data

### Known Limitations

- Demo workspace identity (single user; production auth needed)
- No custom email domain routing (AgentMail default only)
- No document OCR (attachments tracked but not parsed)
- No recovery amount estimation (intentionally $0 per spec)

### Next Steps

- Integrate Firecrawl for legal research
- Implement evidence discovery and matching
- Build dispute-letter generation
- Add landlord response handling
- Connect to email sending service for outbound communication

---

## 2026-09-14 — Audit + Day 3 (Official-Source Research & Evidence-Based Assessment)

### Engineering Audit

A full audit of Milestones 1 and 2 was performed by reading the actual code, schema,
Convex functions, UI, environment and generated types rather than trusting prior
summaries. Findings are recorded in full in `AUDIT.md`. In summary:

- **5 CRITICAL** — one hand-fabricated generated file (`convex/_generated/api.d.ts`
  contained an admitted manual edit), one case-status regression where a revised
  statement rewound an analysed case to `ANALYZING`, two research
  duplication/idempotency defects, and one live concurrency defect that silently
  stranded deductions mid-pipeline with no recorded error.
- **4 IMPORTANT** — a validator that widened source ids and forced an unchecked cast,
  an inconsistent disputable total during re-research, a deliberate retry-mutation
  authorization posture, and a provider summary being stored as if it were an
  authoritative passage.
- **5 ACCEPTABLE** — demo identity, metadata-only attachments, TLD-based authority
  classification, no OCR, and a briefly-stale case total.

The concurrency defect (CRITICAL-5) was only reproducible by actually running the
pipeline. It is the reason the pipeline now splits every shared-row write into its own
small, retryable transaction.

### Day 3 First Half — Firecrawl Official Housing Research Foundation

- `convex/firecrawl.ts` — server-side Firecrawl search. The API key is read from the
  deployment environment and never reaches the browser.
- `convex/questions.ts` — builds an *evidence-seeking* research question from the
  jurisdiction, the landlord's own wording and the deduction category ("what does the
  authoritative rule say"), never a conclusory one ("is this illegal").
- `convex/research.ts` — per-deduction research pipeline with its own state machine
  (`PENDING` → `RESEARCHING` → `COMPLETED` / `FAILED`), independent of the case status.
- `convex/sources.ts` — stores evidence in the existing `sources` table (no second
  source table): `caseId`, `deductionId`, `title`, `url`, `authority`, `jurisdiction`,
  `relevantText`, `retrievedAt`, `createdAt`. Re-running research replaces a deduction's
  sources rather than duplicating them.

Official sources are preferred by host allow-list (`.gov`, `state.xx.us`, legislative
and court hosts); law-firm marketing pages, aggregators and forums are filtered out and
are never stored. When no authoritative source is found the deduction records that
explicitly instead of inventing one.

### Day 3 Second Half — Milestone 3: Evidence-Based Deduction Assessment

- `convex/assessment.ts` — the assessment schema, the system prompt, Zod validation and
  the disputable-amount calculation. The model receives structured input only:
  jurisdiction, deposit, the landlord's wording, the deduction amount and category, the
  research question, and the retrieved source passages.
- `convex/assessments.ts` — the assessment pipeline
  (`PENDING` → `ASSESSING` → `COMPLETED` / `FAILED`) with the outcome stored on the
  deduction as `POTENTIALLY_DISPUTABLE`, `LIKELY_VALID` or `NEEDS_MORE_INFORMATION`.
- The model must not invent statutes, citations, case law or URLs. Output is validated
  with Zod before anything is written; an amount that is negative, exceeds the stated
  deduction, or contradicts the outcome is rejected or capped.
- The case total is **computed from the stored per-deduction assessments** on the
  server — never taken from the model's own total.
- The case advances to `EVIDENCE_FOUND` when research exists and at least one deduction
  has been assessed. It never jumps ahead to `DRAFT_READY`.
- Language is deliberately cautious throughout: "potentially disputable", "may warrant
  further review", "the available source indicates". No deduction is called illegal and
  no recovery is promised.

### What NOT Implemented (Per Spec)

- Dispute letter generation
- Outbound AgentMail sending
- Landlord response analysis
- Automatic legal actions / autonomous decision-making
- Multi-agent architecture
- Vector database / RAG framework
- Nationwide legal database / legal chatbot
- Recovery guarantees

### Verification

- TypeScript: 0 errors
- ESLint: 0 errors (4 warnings, all in generated Convex files)
- Production build: compiled successfully
- Offline suite (`npm run verify`): 161/161
- End-to-end suite (`npm run verify:e2e`): 68/68 against the live local Convex
  deployment with mock providers

The end-to-end suite covers webhook signature verification (unsigned, tampered and
stale deliveries all rejected), delivery idempotency, extraction, official-source
filtering, assessment capping, case totals derived from stored deductions, the
`EVIDENCE_FOUND` transition, real timeline events, cross-user authorization,
re-run idempotency, revision-without-rewind, and failure handling.

Firecrawl, OpenAI and AgentMail were exercised through local mocks. No live provider
call was made, so those integrations are MOCK VERIFIED only.

### Known Limitations

- Demo workspace identity (single user; production auth needed)
- No custom email domain routing (AgentMail default only)
- No document OCR (attachments tracked but not parsed)
- Authority classification is host/TLD based and deliberately conservative
- The case disputable total is recomputed after each assessment, with a bounded
  retry when a concurrent sibling holds the case row. If that retry is exhausted the
  total is refreshed by the next assessment to complete (`recalcDisputableTotal` is
  idempotent), so it can briefly lag by one pass but never drift permanently.

---

## 2026-09-14 — Day 4 / Milestone 4: Evidence-Backed Dispute Letter + Human Approval

### Implemented

Turned the evidence the pipeline had already gathered into a sendable dispute letter,
with an explicit human approval gate and **no outbound sending**.

The pipeline now runs:

```
Landlord deductions → evidence + assessment → OpenAI → dispute letter
    → human review → approve → ready to send   (STOPS HERE)
```

**Convex schema**

- Reused the existing `letters` table — it already existed but was entirely unused
  (zero rows, no callers). No second letter table was created.
- Extended it with `recipient`, `body`, `version`, `pipelineStatus`, `pipelineError`,
  `generationRunId`, `supportingSourceIds`, snapshotted figures
  (`depositAmount`, `totalDeductions`, `potentiallyDisputableAmount`), `editedAt`,
  `archivedAt`, `updatedAt`, and `by_case` / `by_case_and_status` indexes.
- New validators: `LETTER_STATUSES` (`DRAFT`, `AWAITING_APPROVAL`, `APPROVED`, `SENT`),
  `LETTER_PIPELINE_STATUSES` (`PENDING`, `GENERATING`, `READY`, `FAILED`).

**Letter generation (`convex/letter.ts`)**

- Zod `letterOutputSchema` (`recipient`, `subject`, `body`, `supportingSourceIds`)
  converted to a draft-7 JSON Schema for OpenAI structured output.
- An 11-rule system prompt: use only the provided facts; never invent laws, statutes,
  citations, deadlines or threats; never assert illegality, theft, a win, or a
  guarantee; attribute every dispute to a supplied passage using cautious phrasing;
  exclude `LIKELY_VALID` deductions; leave out or ask about `NEEDS_MORE_INFORMATION`;
  never total or estimate an amount; plain prose, no markdown.
- `validateLetter` enforces all of that on the way back: schema parse, minimum body
  length, and 12 forbidden-claim regexes (illegality, theft, guarantees, success
  percentages, legal threats, invented deadlines, statute citations, case citations,
  URLs). Labels are mapped back to real stored source ids; a letter with no traceable
  source is rejected rather than stored.
- `hasLetterEvidence` gates generation on there being at least one
  `POTENTIALLY_DISPUTABLE` deduction that cites a source and carries a non-zero amount.

**Letter pipeline (`convex/letters.ts`)**

- `claimGeneration` / `storeGeneratedLetter` / `failGeneration` are single-document
  mutations guarded by a `generationRunId` pass token, so a superseded pass cannot
  overwrite a newer draft and a late finish cannot overwrite an approved letter.
- `advanceCaseToDraftReady` is a separate, forward-only case write.
- Sources are labelled `S1..Sn` positionally; the model only ever sees labels, and the
  store mutation re-verifies every cited id belongs to the case before persisting.
- Editing (`saveLetterEdits`), presenting (`presentForApproval`), approving
  (`approveLetter`), and `startNewDraft` (archives the approved letter rather than
  deleting it) are all owner-checked against the stored `userId`.

**UI (`components/case-letter.tsx`)**

- A document-style letter screen, not a chat message: a To/Subject header and the body
  as paragraphs, with version, edit timestamp and dirty state in the footer.
- Edit / Save / Cancel / Regenerate / Present for approval / Approve, plus
  Start a new draft once approved. Actions are disabled while an edit is unsaved, so an
  abandoned edit can never be silently discarded. The edit buffer is keyed to the
  stored draft's id and version, so a regeneration or external update rebinds the
  fields instead of being typed over.
- An evidence panel showing each source's title, authority, jurisdiction, the real
  stored URL, and the retrieved passage.
- Honest states throughout: the real refusal reason when there is insufficient
  evidence, a spinner with no fake progress while generating, the real
  `pipelineError` with a retry when generation fails.

**Timeline**

- Real events only: `LETTER_DRAFTED` ("Dispute letter drafted"), `LETTER_UPDATED`,
  `LETTER_PRESENTED_FOR_APPROVAL`, `LETTER_APPROVED`
  ("Dispute letter approved — ready to send"), `LETTER_DRAFT_STARTED`.

**Scope discipline**

- Approval sets `letter.status = APPROVED` and leaves the case at `AWAITING_APPROVAL`.
  Nothing is sent, and the UI says so explicitly ("Approved — ready to send … nothing
  has been sent to the landlord yet"). AgentMail outbound sending is the next milestone.

### What NOT Implemented (Per Spec)

- Outbound AgentMail sending (deliberately deferred; this milestone stops at APPROVED)
- Automatic email sending
- Landlord response analysis / reply classification
- Negotiation / autonomous follow-up
- Multi-agent architecture
- Vector database / RAG framework
- A new legal research pipeline (the letter step performs no new legal research)

### Verification

- TypeScript: 0 errors
- ESLint: 0 errors (4 warnings, all in generated Convex files)
- Production build: compiled successfully
- Offline suite (`npm run verify`): 238/238 — includes the new letter sections
- UI render suite (`npm run verify:ui`): 46/46
- End-to-end suite (`npm run verify:e2e`): 160/160 against the live local Convex
  deployment with mock providers

The e2e suite now also covers: the evidence gate (a case with no disputable,
source-backed deduction refuses to draft), structured-output validation, source
association and cross-case citation rejection, draft persistence, edit validation
(a stub body and an empty recipient are both rejected without overwriting the stored
letter), regeneration reusing the same record rather than inserting duplicates,
present-for-approval idempotency, approval idempotency, approved-letter immutability
against both edit and regeneration, the new-draft-after-approval flow, the letter
timeline events, and owner-only authorization across all five letter mutations.

The UI suite server-renders the real `CaseLetter` component against fixture data and
asserts the resulting markup across six states (draft, awaiting approval, approved,
insufficient evidence, generating, failed).

**What could not be verified here:** a live browser walkthrough. This environment
blocks WebSocket connections, and Convex's realtime client requires one, so the app
sits on "Loading case…" in a headless browser. The UI was therefore verified by
rendering the actual component rather than by clicking through a running page.
Realtime updates are exercised at the query level, not through a live subscription.

Firecrawl, OpenAI and AgentMail were exercised through local mocks. No live provider
call was made, so those integrations are MOCK VERIFIED only — **live OpenAI letter
generation is NOT VERIFIED**.

### Known Limitations

- Live OpenAI letter generation is unverified (mocked structured responses only)
- Demo workspace identity (single user; production auth needed)
- The letter recipient is model-supplied and defaults to a generic address; there is
  no address book, so the renter must edit it before sending
- Only one live letter exists per case at a time; superseded drafts are archived, and
  the UI does not yet surface archived letters
- No document OCR (attachments tracked but not parsed)
- Authority classification is host/TLD based and deliberately conservative

---

## 2026-09-14 — Day 5 / Milestone 5: AgentMail Outbound + Two-Way Case Communication

Closed the loop. A dispute that has been approved can now actually be sent, and
anything the landlord sends back lands on the same case.

```
… → approve → renter triggers send → AgentMail accepts → case SENT
    → landlord replies → inbound webhook → matched to the case → LANDLORD_RESPONDED
    → the reply is read into structured fields
```

Sending is never automatic. Approval makes a letter *sendable*; only an explicit
renter action sends it.

### Engineering Audit (before writing anything)

Read the repository rather than trusting the previous summary. Milestones 1–4 were
present and intact: case creation, ownership, deduction extraction and storage,
financial calculations, Firecrawl research, official sources, evidence-based
assessments, potentially-disputable amounts, letter generation, editing, approval,
timeline, and the existing AgentMail *inbound* webhook.

One **CRITICAL** defect was found and fixed, and it was not in the new code — it was
pre-existing:

- **A landlord reply would have destroyed the case's analysis.** Inbound mail was
  unconditionally treated as a deposit statement and run through extraction, and
  `applyExtraction` deletes and rewrites *every* deduction on the case. The first
  reply from a landlord would therefore have wiped out the very assessment the
  dispute was built from. Inbound mail is now classified **before** insert.

A second **CRITICAL** defect surfaced during verification:

- **A sent letter could be regenerated in place.** `startNewDraft` deliberately
  skipped `SENT` letters, so after a dispute went out, "regenerate" rewrote the
  document the landlord was already holding — destroying the record of what was
  actually sent. Sent letters are now archived like approved ones, and
  `draftLetter` refuses to regenerate either state.

### Implemented

**Outbound sending (`convex/outbound.ts`, `convex/send.ts`)**

- `send.ts` holds the *policy*, free of any Convex runtime import so it is
  unit-testable offline: `sendIdempotencyKey`, `isSendableEmail`,
  `validateSendRequest` (the full pre-send precondition list),
  `decideSendClaim` (the duplicate/retry decision table), and
  `STALE_SEND_CLAIM_MS`. `outbound.ts` holds the pipeline that supplies the data.
- `sendLetter` (mutation) validates, then *claims* the send by writing one outbound
  `emails` row with `sendStatus: "SENDING"` and scheduling `performSend`.
- `performSend` (internal action) makes the AgentMail call and records the outcome.
  It performs no database writes of its own, so a crash mid-send leaves a
  recoverable `SENDING` claim rather than a half-written `SENT`.
- `recordSendSuccess` / `recordSendFailure` (internal mutations) are the only
  writers of the outcome. The case moves to `SENT` **only** after AgentMail
  confirms it accepted the message.
- `agentmail.ts` gained `sendCaseMessage` (POST
  `/inboxes/{inboxId}/messages/send`) and normalises `thread_id`, `in_reply_to`,
  `references` and `headers` on inbound mail.

**Idempotency (Step 5)**

- The key is `send:{letterId}:v{version}` — one key per *document revision*, not per
  attempt. A double click, a retried action and a replayed webhook all converge on
  one row and one delivered copy; a genuinely revised letter gets a new key and may
  legitimately be sent again.
- A fresh `SENDING` claim is refused ("already being sent"). A claim older than
  `STALE_SEND_CLAIM_MS` is taken over, so a crashed action cannot block a case
  forever. A `FAILED` send is retried by **reusing its own row**, so a document keeps
  exactly one outbound record.
- **Honest limit:** a stale takeover is not a retry of an observed failure — the
  earlier attempt may have reached the provider and simply not reported back, in
  which case the landlord receives two copies. AgentMail's send endpoint has no
  idempotency key, so this cannot be detected from our side. It is therefore
  *recorded* rather than hidden: the takeover writes a `SEND_ATTEMPT_ABANDONED`
  timeline event saying the landlord may receive two copies. A plain retry after a
  `FAILED` send is not flagged, because that outcome was observed. "One delivered
  copy" is guaranteed for concurrent and repeated attempts while a claim is live; it
  is **not** guaranteed across a stale takeover.
- AgentMail's `client_id` is not available on this endpoint, so idempotency is
  enforced by the caller — documented at the call site.

**Inbound reply association (`convex/emails.ts`)**

- Inbound mail is classified as `REPLY` or `STATEMENT` before it is stored, strongest
  signal first: (1) the case's `threadId` matches; (2) `In-Reply-To`/`References`
  name a message we sent on this case; (3) a `SENT` letter exists for the case.
  **Subject-line matching is never the identity mechanism.**
- A reply is stored with `isReply: true` and is never scheduled for extraction, so it
  cannot reach `applyExtraction`. It records `LANDLORD_RESPONDED`, sets
  `responseAnalysisStatus: "PENDING"`, and schedules the reading.

**Response analysis (`convex/response.ts`, `convex/responses.ts`)**

- `response.ts` is the pure contract: the Zod schema, the 11-rule system prompt, the
  JSON Schema handed to the model, `validateResponseAnalysis` and `summarizeReading`.
- The model **transcribes, it does not evaluate**. The prompt forbids inferring
  intentions, inventing figures, and reaching any legal conclusion.
- `validateResponseAnalysis` rejects a self-contradicting reading (accept *and*
  reject), a negative figure, a figure larger than the deposit held (treated as
  fabricated), `providesNewEvidence` with nothing to describe, and 8 forbidden
  conclusion patterns. Lists are clamped; the summary is bounded.
- Flags were made genuinely distinct: `acceptsDispute` means the reply *concedes* the
  dispute, while offering money is recorded through
  `offersPartialReimbursement`/`offeredAmount`. Without that, "I can refund $150"
  set both, making the flags redundant.
- The UI presents this as "What the reply appears to say", next to the landlord's
  verbatim words, with an explicit "not legal advice" line. It is never framed as a
  legal position, and it never estimates a recovery.

**Case state, timeline and UI**

- `DRAFT_READY → AWAITING_APPROVAL → APPROVED → SENT → LANDLORD_RESPONDED`, with
  forward-only transitions driven by real backend events. A case is never rewound —
  a reply that arrives first is not undone by a later send.
- Real timeline events only: `LETTER_APPROVED`, `DISPUTE_SENT`, `SEND_FAILED`,
  `LANDLORD_RESPONDED`, `RESPONSE_ANALYZED`. No synthetic progress.
- `components/case-communication.tsx` is the new minimal communication section:
  You → Landlord / date / "Dispute letter sent", and Landlord → You / date /
  "Response received and read" / View response. Not a mail client.
- `components/case-letter.tsx` gained the send panel (address + explicit
  "Send dispute"), a sending state, and a sent banner.

**Authorization and errors (Steps 12–13)**

- Every case-scoped operation re-verifies ownership from the stored case row; case ids
  and user ids from the client are never trusted. Covered for sending, setting the
  address, reading communication, and re-running the reading.
- Failures are explicit and recoverable: provider failure leaves the case in its
  pre-send state with the letter still `APPROVED` and the reason stored; a failed
  reading keeps the landlord's message and offers a retry; a duplicate send is
  refused with a reason rather than silently ignored.

### Verification

- TypeScript: 0 errors (`npx tsc --noEmit`)
- ESLint: 0 errors, 4 warnings — all in `convex/_generated/*`
- Production build: compiled successfully
- Offline suite (`npm run verify`): **325/325**
- UI render suite (`npm run verify:ui`): **93/93**
- End-to-end suite (`npm run verify:e2e`): **234/234** against the live local Convex
  deployment with mock providers

New offline coverage: the send precondition matrix (11 refusal cases), address
validation, idempotency-key determinism, the full duplicate/retry decision table
including the stale-claim boundary, response-reading validation, the no-legal-
conclusion enforcement, the model JSON Schema, and the reading summary line.

New e2e coverage: pre-send validation, sending an approved dispute, the landlord
receiving exactly the approved document, duplicate-send refusal including two
attempts fired together, reply association by thread, duplicate webhook replay,
response analysis, a revised dispute after a send, provider failure with a safe
retry that reuses the same record, owner-only authorization for sending,
addressing and re-reading, and a guard that a retry after an observed failure is
**not** mislabelled as an abandoned attempt.

### Post-implementation audit (Day 5, second pass)

Re-read the send and reply paths adversarially, looking for the defect classes that
had already bitten earlier milestones. Findings:

- `recordSendFailure` correctly refuses to downgrade a `SENT` row, so a late failure
  from an earlier attempt cannot overwrite a newer success. No change needed.
- `looksLikeReply`'s final fallback ("a `SENT` letter exists") is deliberately
  permissive. The asymmetry justifies it: a statement misread as a reply is stored and
  shown, while a reply misread as a statement would destroy the case's analysis. No
  change needed.
- **One genuine hole, now fixed and documented:** a stale send takeover was retried
  silently. That path is *not* a retry of an observed failure — the earlier attempt may
  have reached the provider without reporting back, so the landlord can receive two
  copies. Because AgentMail's send endpoint has no idempotency key this cannot be
  detected, so it is now *recorded*: the takeover writes a `SEND_ATTEMPT_ABANDONED`
  timeline event stating that the landlord may receive two copies. A plain retry after
  a `FAILED` send is deliberately not flagged. Two e2e checks pin both halves of that
  distinction.

### What could not be verified here — LIVE VERIFICATION PENDING

- **No live AgentMail call was made.** Sending, threading and reply headers were
  exercised against a local mock that implements the real endpoint shapes. Live
  AgentMail outbound delivery is **NOT VERIFIED**.
- **No live OpenAI call was made.** Response reading was exercised against mocked
  structured output. Live reading of a real reply is **NOT VERIFIED**.
- No live Firecrawl call (carried over from Day 3).
- No live browser walkthrough: this environment blocks WebSockets, so the realtime
  client cannot connect. The UI was verified by server-rendering the real
  `CaseLetter` and `CaseCommunication` components against fixture data.

Compilation and a green mock suite are not evidence that a third-party integration
works. The correct status for both AgentMail outbound and OpenAI response reading is
**LIVE VERIFICATION PENDING**.

### What NOT Implemented (Per Spec)

- Autonomous negotiation or automatic follow-up
- A generic AI chat interface
- Recovery or success-probability scores
- Fake landlord responses, fake messages, or synthetic timeline activity
- Automatic sending at any point
- A full mail client
- The visual redesign — deliberately deferred; this milestone was about making the
  communication loop genuinely work

### Known Limitations

- Live AgentMail outbound and live OpenAI response reading are unverified (mocks only)
- Exactly-once delivery is not guaranteed across a stale send takeover, because
  AgentMail's send endpoint offers no idempotency key. The takeover is flagged on the
  timeline rather than silently retried, but a duplicate delivery remains possible if
  a provider call exceeds the 10-minute staleness window
- The landlord's address must be entered by the renter; Clawback will not infer it
- Response reading is single-message: a reply that quotes an earlier thread is read as
  written, with no thread-level reconciliation
- The reading is a transcription, not advice, and the UI says so — but it is still
  model output and should be read alongside the landlord's own words
- Demo workspace identity (single user; production auth needed)
