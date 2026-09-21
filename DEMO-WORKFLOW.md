# Demo workflow — what to click, and what happens

Plain actions only, no narration. Follow it top to bottom and the whole product
demonstrates itself.

Sample statement to use: [`SAMPLE-DEPOSIT-STATEMENT.txt`](./SAMPLE-DEPOSIT-STATEMENT.txt)

---

## Before you press record

1. `npm run dev` → wait for **Ready** → open **http://localhost:3000**
2. **Use a private/incognito window.** There's no sign-out in the new UI yet, and
   you want the sign-up step on camera.
3. Have three things open: the app, your Gmail, and the sample statement file.
4. Create a **new** case for the recording — your existing case is already sent
   and can't be re-run.

---

## The run

**1. Open the app.**
→ The black landing page: *"Your deposit. Your money."*

**2. Click Get started.**
→ Because nobody is signed in, you're taken to **sign-up**, not into a case.

**3. Fill in name, email, password → Create account.**
→ You land on the case screen, which honestly says **"No case yet"**.

**4. Click Create a case.**
→ A form: jurisdiction, deposit, total deductions.

**5. Enter `Texas`, `1500`, `1000` → create.**
→ The case is made and Clawback gives it a **private email address**:
`case-xxxxx@agentmail.to`. Click **Copy**.

**6. In Gmail, send a new email to that address. Subject: "Security Deposit Statement". Paste the whole sample statement as the body → Send.**
→ Nothing happens in the app for a few seconds. This is the moment to let it
breathe on camera.

**7. Watch the case fill in by itself — no refresh.**
→ Over roughly 30–60 seconds the timeline advances on its own:
*Statement received → Deductions identified → Jurisdiction confirmed →
Official sources retrieved → Evidence connected → Deductions assessed*.

**8. Click Case overview.**
→ The money appears:
- Security deposit **$1,500.00**
- Total deductions **$1,000.00**
- Not withheld **$500.00**
- **$450.00 potentially disputable**
- **4 / 4** deductions assessed

**9. Scroll to the deductions list.**
→ Four charges, each tagged differently — this is the best part of the demo:
- Carpet replacement $300 — **Potentially disputable**
- Cleaning fee $150 — **Potentially disputable**
- Wall repainting $350 — **Needs more information**
- Broken cabinet handle $200 — **Likely valid**

**10. Click Carpet replacement.**
→ It expands to show: the question asked of the official sources, the finding in
plain language, **What would help**, and **Source 01** — the real Texas Attorney
General passage with an *Open the source* link.

**11. Click Evidence.**
→ The retrieved official sources, each with its authority and jurisdiction.

**12. Click Dispute letter.**
→ The drafted letter. Every challenge names the guidance it came from.

**13. Click Approve.**
→ Status becomes approved, and **nothing is sent**. Worth pausing on.

**14. Click Send dispute → confirm.**
→ It moves to **You → Landlord** with the timestamp, plus **What was sent** —
the permanent, uneditable record of what the landlord received.

**15. Click Timeline.**
→ The entire investigation in the order it happened, with timestamps. Good
closing shot.

**16. *(Optional)*** Reply to the case address from Gmail as if you were the
landlord.
→ Within about a minute it appears under **Communication**, attached to the
case.

---

## Beats worth pointing at

- **"Not withheld"**, not "returned" — the app can't know money was handed back,
  so it doesn't claim it.
- **"Potentially disputable"**, never "you'll get this back".
- **Approve ≠ send.** Two separate human actions.
- The deduction tagged **Needs more information** — it says what's missing
  rather than guessing.

---

## Things that will trip you up

- **Don't reuse a sent case.** Letters are immutable once sent.
- **Your AgentMail plan allows 3 inboxes.** Each case takes one. If a new case
  can't get an address, free a slot in AgentMail and retry setup.
- **Don't refresh during the pipeline.** Wait for *Deductions assessed*.
- **If a step stalls**, check the Convex logs — provider calls are real and can
  be slow, and the free-tier model occasionally needs a check-in.
- **Use incognito** so the sign-up step appears.
