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
- The case disputable total can lag the last assessment by one pass
