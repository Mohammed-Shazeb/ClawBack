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
