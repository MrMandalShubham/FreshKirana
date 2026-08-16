# FreshKirana – Pre-Build Readiness Checklist

**Version:** 1.0 · **Date:** 2026-08-12
**Companion to:** `FreshKirana – Scalable Grocery Marketplace Documentation Set.md` (v2.2)

Everything here is **program work, not spec work** — the things that must happen outside the codebase for the build to reach launch. The specification is complete; this is what the specification cannot do for you.

**How to use:** fill in Owner and Due, review weekly. Sections A and F gate the start. Section B does not block the build but **will block launch** if left late. Section G is the "do not let this get cut in review" list.

---

## F. Do this first — two days, no code

> **Why this is section F but listed first:** R-1 (§8.2) is the riskiest assumption in the entire product, and it can be tested for the price of two days of fieldwork. Everything downstream is worth more if this passes and worth nothing if it fails.

**Visit 10 kirana stores in your intended launch area. Ask three questions.**

| # | Question | Good answer | Bad answer |
|---|---|---|---|
| 1 | *"If we send you orders on WhatsApp, will you accept them and reply?"* | "Yes, I already take orders that way" | "Call me instead" / "My son handles the phone" |
| 2 | *"Can you tell us reliably which items you're out of, before we send the order?"* | "Yes, for my main items" — even partial coverage is workable via §1.9.2 toggle mode | "I'll know when I go to the shelf" |
| 3 | *"What's your margin on a ₹600 grocery basket, and would you give up 10% of it for extra orders?"* | Margin ≥ 12% and open to commission | Margin < 10%, or flat refusal on commission |

**Decision rule**

| Result | Action |
|---|---|
| **7+ of 10 pass all three** | Proceed. Build as specified |
| **4–6 pass** | Proceed, but assume §1.9.2 *toggle* mode is the norm, not the upgrade path. Raise the expected OOS target in §1.3.3 and lean harder on substitutions |
| **< 4 pass** | **Stop and rethink before building.** The product must be redesigned around genuinely unknown inventory — or the vendor model changes (single chain, white-label, own inventory). This is a founder decision, not an engineering one |

- [ ] Field validation complete · Owner: ______ · Due: ______
- [ ] Result recorded and decision taken · Owner: ______ · Due: ______

---

## A. Day-0 blockers — decide before Phase 0 starts

| # | Item | Effort | Owner | Due | Done |
|---|---|---|---|---|---|
| A1 | ~~Backend language~~ — **CLOSED: TypeScript / NestJS** | — | — | 2026-08-12 | ✅ |
| A2 | ~~Cloud provider + region (OD-5)~~ — **CLOSED 2026-08-16: GCP, `asia-south1` (Mumbai)** | — | Shubham | 2026-08-16 | ✅ |

Both closed. What remains is not a decision but an action: run the one-time GCP bootstrap in [`infra/README.md`](../infra/README.md) — create the project, link billing, create the state bucket, `terraform apply`, then set three repository variables.

---

## B. Long-lead items — start now, or they block launch

None of these block writing code. All of them block go-live, and each has external queue time you do not control.

| # | Item | Lead time | Start by | Owner | Due | Done |
|---|---|---|---|---|---|---|
| B1 | **WhatsApp BSP onboarding + Meta business verification + template approval** (§2.12) — your entire vendor operating model depends on this | 4–8 weeks | Week 1 | | | ☐ |
| B2 | **TRAI DLT registration** (§2.12) — entity, sender ID, per-template. Mandatory for SMS in India | 3–6 weeks | Week 1 | | | ☐ |
| B3 | **Payment gateway selection + contracting (OD-2)** — must satisfy all six §2.10.2 criteria; **auth/capture with downward-adjusted capture is the binding one** (§1.7.1) | 3–6 weeks | Week 1 | | | ☐ |
| B4 | **Master catalog data sourcing** — see C1 | 8–12 weeks | Week 1 | | | ☐ |
| B5 | **Pilot vendor recruitment** — 15–25 stores in one pincode (§1.11 P1) | 6–10 weeks | Week 2 | | | ☐ |
| B6 | **CA + counsel review of §3.7 and §3.6** — tax, invoicing, DPDP | 4–6 weeks round trip | Week 3 | | | ☐ |
| B7 | **Launch city + pincode cluster (OD-6)** — *pulled forward from Phase 0*: it gates B5 and the regional-language seeding in §2.7.2 and §4.1 | 1 week | Week 1 | | | ☐ |

**B1 and B2 are the ones teams start too late.** If WhatsApp template approval slips, you have no vendor product at all.

---

## C. Work with no owner — real gaps in the plan, not the spec

### C1 — Master catalog seeding is a bigger job than it looks
§2.4.1 specifies the schema precisely and says nothing about where 10,000–20,000 master products come from — each needing brand, net quantity, UoM, EAN, images, **HSN code and GST rate**, and Legal Metrology declarations (§3.7.3).

**Options:** license a catalog dataset (fast, costs money, weak on regional brands) · GS1 India barcode registry plus manual enrichment · bootstrap from vendor barcode scans during onboarding (slow, most relevant).

**Recommendation: hybrid.** License or compile the top ~3,000 national SKUs, then let pilot vendors' scans build the regional long tail via the §2.4.1 product-request queue. Budget one full-time person for eight weeks.

**Note:** HSN and GST mapping cannot be crowdsourced — it goes to the CA (B6).

- [ ] Sourcing approach chosen · Owner: ______ · Due: ______
- [ ] Resource assigned · Owner: ______ · Due: ______

### C2 — No visual design exists
§4 is a **behavioural** specification, not a design. There are no wireframes, no visual language, no component library decision. Needed before Phase 1 frontend work.

- [ ] Designer engaged, or component-library decision made · Owner: ______ · Due: ______

### C3 — Legal documents
Vendor agreement (must encode RTO, chargeback and shrinkage liability per OD-10, since §2.11 allocates ledger entries against it) · customer T&C · privacy policy · refund and cancellation policy · grievance officer appointment. All are DPDP and Consumer-Rules prerequisites (§3.6, §3.7.3), not paperwork to finish later.

- [ ] Counsel engaged · Owner: ______ · Due: ______
- [ ] Vendor agreement drafted · Owner: ______ · Due: ______

### C4 — Entity, GST registration, and settlement banking
Including the settlement structure: a marketplace collecting funds on behalf of sellers generally must route through an authorised payment aggregator's escrow rather than its own current account. **Confirm the structure with your CA before designing around it** — it interacts directly with §2.11's ledger accounts and §2.11.2's settlement cycles.

- [ ] Entity and GST registration complete · Owner: ______ · Due: ______
- [ ] Settlement/escrow structure confirmed with CA · Owner: ______ · Due: ______

### C5 — Brand, domain, trademark
Is "FreshKirana" clear on trademark (classes 35 and 39) and is the domain available? Worth resolving before it appears on 20 vendor storefronts and a WhatsApp sender ID.

- [ ] Trademark search done · Owner: ______ · Due: ______
- [ ] Domain secured · Owner: ______ · Due: ______

---

## D. Decisions by phase

Full table with owners and rationale is §8.1 of the main document. Condensed status:

| ID | Decision | Status |
|---|---|---|
| OD-1 | Backend language | ✅ **Closed** — TypeScript / NestJS |
| OD-2 | Payment gateway | Open → B3 |
| OD-3 | WhatsApp BSP | Open → B1 |
| OD-4 | 3PL aggregator partner | Open, Phase 4 |
| OD-5 | Cloud provider and region | Open → **A2, blocking** |
| OD-6 | Launch city and pincode | Open → B7 |
| OD-7 | Commission rates by category | Open, Phase 3 |
| OD-8 | Store-credit legal structure | Open, Phase 3 → C3 |
| OD-9 | Current TCS/TDS rates and cadence | Open, Phase 3 → B6 |
| OD-10 | Vendor agreement liability terms | Open, Phase 3 → C3 |
| OD-11 | AI provider(s) | ✅ **Deferred** — routing pre-decided (§2.17.5) |

---

## E. Phase 0 definition of done (weeks 1–3)

- [ ] Monorepo created per §2.3 layout; `packages/contracts` established
- [ ] NestJS module skeleton for the 22 bounded contexts of §2.2
- [ ] **CI checks enforcing §2.1.1 boundary rules** — schema ownership, no cross-schema reads, no circular module dependencies. *Build these first; they are worthless retrofitted*
- [ ] PostgreSQL schema for `identity` / `user` / `vendor`, migrations, seed fixtures
- [ ] OTP auth, JWT + rotating refresh tokens, RBAC scaffolding with deny-by-default
- [ ] Terraform, CI/CD pipeline, staging environment live
- [ ] Observability baseline — structured logs, correlation IDs, metrics endpoint
- [ ] OpenAPI contract published for the first module set
- [ ] **Analytics event pipeline stub accepting events** (§5.3) — before any product feature ships

---

## G. Non-negotiables — cheap now, expensive or impossible later

These will each look skippable during implementation. They are not. Put them in the tickets explicitly so they survive code review.

| # | Item | Where | Why it cannot wait |
|---|---|---|---|
| **G1** | **Analytics events ship with every feature** — declaring events is a merge condition on frontend tickets | §5.1, §5.3 | **The only truly irreversible item in this plan.** Untracked launch months cannot be backfilled. No captured data means no AI, no funnel analysis, and no evidence for the §1.11 gates |
| **G2** | **Module boundary CI checks built in Phase 0** | §2.1.1 | Retrofitting boundaries onto a codebase that has already violated them is a rewrite. These checks are what make §2.1.2 extraction cheap |
| **G3** | **The three AI interfaces, with rule implementations behind them** | §2.17.2, §2.17.4 | ~Half a day. Will feel pointless ("why wrap a SQL query?"). It is the difference between adding AI as a config flag and adding it as a refactor |
| **G4** | **Idempotency keys on order, payment, refund and inventory endpoints** | §3.3 | Retrofitting idempotency after a double-charge incident is both harder and more expensive than the incident |
| **G5** | **Double-entry invariant asserted in tests and a nightly job** | §2.4.4, T-141 | A ledger that can go unbalanced silently is worse than no ledger — you will trust wrong numbers |
| **G6** | **"Your usual basket" ships in the MVP** | §0.3, §2.17.1 | It is a SQL query, not AI. If it is deferred, FreshKirana launches as a generic grocery marketplace with no differentiator |
| **G7** | **Substitutions and variable-weight capture ship in the MVP** | §1.7.1, §1.7.2 | Both are unavoidable within the first week of real orders. Shipping without them means cancellations and incorrect charges from day one |

---

## Summary

| Section | Items | Blocking the build? |
|---|---|---|
| F — Field validation | 2 | **Should gate the decision to build at all** |
| A — Day-0 blockers | 1 remaining | **Yes** |
| B — Long-lead | 7 | No, but blocks launch |
| C — Unowned work | 5 areas | Blocks Phase 1 (C2) and launch (C1, C3, C4) |
| D — Phased decisions | 9 open | No |
| E — Phase 0 DoD | 9 | — |
| G — Non-negotiables | 7 | — |
