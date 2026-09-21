# Demo script — what to do, and what you'll see

Read this while you record. Every step is **Do this → you'll see this**, in the
order it happens. The whole thing is about two and a half minutes of clicking
plus one wait.

---

## Before you press record

1. `npm run dev` — the app should already be open at **http://localhost:3000**.
2. Open [`SAMPLE-DEPOSIT-STATEMENT.txt`](./SAMPLE-DEPOSIT-STATEMENT.txt) in a
   text editor — you'll paste it in step 5.
3. Have your email open in another tab (you'll send one message).

**Use the account you already have.** `/case` shows your *newest* case, so a case
you create during the video is the one that appears. No need for a throwaway
account.

---

## The walkthrough

### 1. Open the app — the hero

**Do:** show http://localhost:3000.

**You'll see:** *"Your deposit. Your money."* with two buttons, and **Log in**
underneath for people who already have an account.

**Say:** a landlord kept $1,000 of a $1,500 deposit. Here's what Clawback does
with it.

---

### 2. Get started → sign up

**Do:** click **Get started**.

**You'll see:** the sign-up screen — because nothing past this point works
without an account.

**Do:** enter name, email, password → **Create account**.

**You'll see:** you land on the case screen showing *"No case yet — start your
first deposit review."*

**Say:** cases belong to an account, so an unauthenticated visitor is sent here
first.

---

### 3. Create the case

**Do:** click **Create a case**. Fill in:

- Jurisdiction: **Texas**
- Security deposit: **1500**
- Total deductions: **1000**

**You'll see:** the case is created, and Clawback opens **a private email address
just for this case** — something like `case-rsyhv18epa60@agentmail.to`. There's
a Copy button next to it.

**Say:** every case gets its own inbox, so anything sent there can only belong
to this case. Nothing has to be guessed.

**Do:** click **Copy**.

---

### 4. Send the landlord's statement to it

**Do:** in your email, compose a message **to that case address** and paste in
the sample statement. Send it.

**Say:** this is the message a renter forwards — the itemized list the landlord
sent them.

---

### 5. Watch it work — the timeline

**Do:** go to **Timeline**.

**You'll see steps light up over roughly 30–60 seconds**, in order:

1. **Statement received** — mail arrived at the case address
2. **Deductions identified** — 4 charges read out of the statement
3. **Jurisdiction confirmed** — assessed against Texas
4. **Official sources retrieved** — 7 sources from housing authorities
5. **Evidence connected** — sources tied to specific charges
6. **Deductions assessed** — 4 of 4
7. **Dispute prepared** — a letter has been drafted

**Say:** this is the part that used to take an evening.

---

### 6. The money — case overview

**Do:** click **Case overview**.

**You'll see:**

- **$450.00 — potentially disputable**
- Security deposit **$1,500.00**
- Total deductions **$1,000.00**
- **Not withheld $500.00**
- Deductions reviewed **4 / 4**

**Say — this is the line worth saying out loud:** it says *not withheld*, not
*returned*. The app knows the deposit wasn't deducted; it can't know the
landlord actually handed it back, so it doesn't claim that. And "potentially
disputable" is not money recovered.

---

### 7. The evidence behind it

**Do:** click **Evidence**.

**You'll see:** the official sources — the Texas Attorney General's renter's
rights guidance among them — with the passage the finding rests on, and a link
to open the real source.

**Do:** expand **Carpet replacement**.

**Say:** the rule, then the finding, then what would help. Nothing here is
invented; every claim points at something real.

---

### 8. Per-charge findings

**Do:** click **Intelligence**.

**You'll see:**

- Carpet replacement **$300 — potentially disputable**
- Cleaning fee **$150 — potentially disputable**
- Wall repainting — **needs more information**
- Broken cabinet handle **$200 — likely valid**

**Say:** it disputes two, asks for documents on a third, and leaves the one the
landlord is probably entitled to alone. That's the honesty part.

---

### 9. The letter

**Do:** click **Dispute letter**.

**You'll see:** the drafted letter, citing the Texas guidance for each challenged
charge, written as a request for review rather than an accusation.

**Do:** click **Approve & continue**.

**Say:** approving does **not** send anything. Nothing leaves without pressing
send.

---

### 10. Send it

> **Heads-up:** sending lives in the full case workspace, not in the top nav.

**Do:** go to **/cases** and open your case, then the **Communication** tab →
**Send dispute**.

**You'll see:** the message is sent from the case address, and a permanent record
of exactly what was sent appears underneath — it can't be edited afterwards.

**Do:** press send **once**.

---

### 11. Back to the timeline

**Do:** click **Timeline** again.

**You'll see:** **Approved by you** and **Dispute sent to landlord** now filled
in, with **Landlord responded** still waiting.

**Say:** when the landlord replies, it lands back on this case automatically.

---

## If something is slow

Research and assessment take about 20–40 seconds. If the timeline stalls, give
it a moment before touching anything — and **don't click "Try again"** on the
letter, because that produces a second draft.

## Don't click these

- **Try again** on the letter screen
- **Send** more than once
- Anything that re-provisions the case email address

## Rough timing

| Section | Time |
| --- | --- |
| Hero + sign-up | 0:20 |
| Create case + send statement | 0:35 |
| Timeline waiting | 0:45 |
| Money + evidence + findings | 0:50 |
| Letter + send + close | 0:30 |
| **Total** | **~3:00** |
