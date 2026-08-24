# FreshKirana – B2B Business Model & Operating Plan

**Version** 1.1 · **Date** 2026-08-24 · **Status** Founder decisions applied — building against this
**Supersedes** the B2C marketplace business model in §0–§1.3 of the *Scalable Grocery Marketplace Documentation Set*.
**Does not supersede** the technical architecture (§2), security (§3), or the module-boundary discipline — those survive the pivot intact.

> **Read §0 first.** It states what changed and why almost every downstream section had to move. If you disagree with §0, stop there — everything after it is a consequence.

---

## Decisions taken — 2026-08-24

Founder answers to the questions this document opened. They close every schema-level question; the rest of the document is written against them.

| # | Question | **Decided** | Consequence |
|---|---|---|---|
| **D-B1** | Branch geography | **All branches in the same state as the hub** | One GSTIN for the whole network. Hub→branch transfers are **delivery challans — no tax invoice, no GST, no ITC hop.** The `transfer` module gets materially simpler and the ledger needs no inter-state scoping |
| **D-B2** | Economic numbers | **Demo / placeholder numbers for now** | §2.2, §2.3 and §4 ship as illustrative. Every figure lives in config, tunable without a deploy — so replacing them later is a data change, never a code change |
| **D-B3** | Counter retail at branches | **Yes — branches sell over the counter too** | A counter sale **depletes branch stock**, so it cannot be deferred entirely (§1.4). Recording it is required in Phase 7; a full POS comes later |
| **D-B4** | Tax & invoicing scope | **Simple invoice, demo GSTIN, placeholder tax config — replace later** | No e-invoice or e-way bill integration in this build. **Seams stay open**, and the demo config is fenced so it cannot boot in production (§6, R-9, R-11) |
| **D-B5** | Customer types | **Small retail shops · caterers · event management** | "Catering" confirmed. §1.2 stands as written |
| **D-B6** | Fleet | **Both own vehicles and hired** | Phase 10 models a vehicle as owned *or* hired, with **cost per trip attributed either way**, so delivery cost per drop stays true (§2.4 lever 6) |
| **D-B7** | B2C | **Deferred — seam kept open** | `customer_type` is modelled from day one; no B2C surface is built |

**Still open, running on demo values until answered — none of them block the build:** real margins and volumes (Q2) · beauty range specifics (Q5) · your actual credit policy (Q7) · stock held (Q10).

---

# 0. What changed, in one page

## 0.1 The old model

FreshKirana v2 was a **B2C multi-vendor marketplace**. Independent kirana stores listed their goods; consumers ordered; the platform earned a **commission** on someone else's inventory. The platform owned no stock, carried no purchase risk, and never touched the goods.

## 0.2 The new model

FreshKirana is a **B2B wholesale distribution business** with a hub-and-spoke network the founder already owns and operates:

- **One main shop and main inventory** in the home city — the **hub**. This is where buying happens and where the deep stock sits.
- **N established branch shops** in different locations — the **spokes**. Each carries stock sized to *its own local demand*, replenished from the hub.
- **B2B customers**: small retail shops, catering businesses, event-management companies.
- **Two ways to receive goods**: collect at a branch, or delivered to the customer's shop or event site.
- **One control point.** Head office runs catalog, pricing, credit, purchasing, and replenishment for the whole network from a single place.

## 0.3 The single change that moves everything else

| | Marketplace (old) | Distribution (new) |
|---|---|---|
| Who owns the stock | The vendor | **You** |
| Where revenue comes from | Commission on GMV | **Gross margin: sell price − landed cost** |
| Who you owe money to | Vendors (payable) | **Suppliers (payable)** |
| Who owes you money | Nobody — you net off | **Customers (receivable, on credit)** |
| Biggest risk | Vendor churn, bad inventory data | **Working capital, credit default, wastage** |
| Biggest lever | Take rate, AOV | **Buy price, mix, drop size, wastage, DSO** |
| What can kill you | No supply | **Cash locked in receivables and stock** |

**You now carry inventory risk and credit risk.** Those two sentences generate most of §2, §4, §6 and §9 of this document. A marketplace never has to answer "what did this crate cost me, and did the shop that took it on credit pay?" A distributor answers both, every day, or dies.

## 0.4 What survives from the old plan

More than you would expect — the technical foundation was built to be re-pointed, not rebuilt:

**Survives intact:** modular monolith and boundary enforcement · master catalog (D1) · search · variable weight (F&V is *more* weight-driven than B2C) · perishables, batches, FEFO, recall · substitution engine · order state machine · idempotency · analytics ingest · double-entry ledger *discipline* · the reservation/oversell guarantee · "Your usual basket" (which becomes the **primary** ordering surface, not a feature).

**Survives with a rename:** `vendor` → **branch** · `vendor_offer` → **branch stock + central price list** (this one splits in two) · slots → **delivery days and routes**.

**Is deleted:** commission · vendor onboarding and approval · vendor SLAs and scoring · vendor payouts and settlement cycles · marketplace TCS §52 and TDS 194-O · guest/consumer COD risk bands (replaced by credit risk).

**Is new and does not exist in any form today:** procurement · goods receipt · landed cost and inventory valuation · COGS and gross margin · stock transfer between locations · customer credit and receivables · price lists and customer tiers · credit notes and saleable returns · wastage accounting · e-way bills.

## 0.5 Is B2C dead?

**No — it is deferred, and the model is built to accept it back.** The founder's words were "in starting I'm focusing on only B2B." So the design rule is:

> Model **customer type** as a first-class attribute (`B2B_RETAILER`, `B2B_CATERER`, `B2B_EVENT`, `B2C_CONSUMER`), and let price list, credit policy, tax treatment, minimum order, and fulfilment mode all resolve from it.

Do this from day one and adding B2C later is configuration. Skip it and adding B2C later is a migration. The cost of the discipline now is roughly one extra column and one resolver; the cost of skipping it is a quarter.

**Confirmed (D-B7): B2C is deferred and the seam stays open.** `customer_type` is modelled now; nothing B2C-facing is built. Note that this is *not* the same thing as counter retail — D-B3 confirms branches sell to walk-ins over the counter today, which is a physical-shop flow, not an online consumer product. See §1.4.

---

# 1. The business

## 1.1 Network structure

```
                    ┌──────────────────────────┐
                    │   HUB — home city        │
                    │   main shop + main stock  │
                    │   • all buying            │
                    │   • deep / slow-moving    │
                    │   • overflow for branches │
                    └────────────┬──────────────┘
                                 │  stock transfer (delivery challan / e-way bill)
             ┌───────────────┬───┴───────────┬───────────────┐
             ▼               ▼               ▼               ▼
        ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
        │ Branch 1│    │ Branch 2│    │ Branch 3│    │ Branch N│
        │ local   │    │ local   │    │ local   │    │ local   │
        │ demand  │    │ demand  │    │ demand  │    │ demand  │
        └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘
             │              │              │              │
     ┌───────┴──────────────┴──────────────┴──────────────┴───────┐
     │  CUSTOMERS — small shops · caterers · event managers        │
     │  receive by: PICKUP at branch  |  DELIVERY to shop / site   │
     └─────────────────────────────────────────────────────────────┘

     ┌─────────────────────────────────────────────────────────────┐
     │  CONTROL TOWER — one place, whole network                    │
     │  catalog · pricing · credit policy · purchasing · replenish  │
     └─────────────────────────────────────────────────────────────┘
```

**The defining property: branches hold stock but do not make decisions.** Catalog, price, credit and replenishment are central. A branch picks, hands over, and delivers locally. This is what "handle all of this from a single location" means in system terms, and it is the right call — it is also the only way N branches stay consistent as N grows.

## 1.2 Customer segments

These three behave *very* differently and must not be flattened into one "B2B customer".

| | **Small retail shop** | **Caterer** | **Event management** |
|---|---|---|---|
| Order pattern | Rhythmic — weekly or twice-weekly | Semi-rhythmic, spikes around functions | Episodic, project-shaped |
| Basket | 30–80 lines, mostly identical week to week | 15–40 lines, larger quantities | 20–60 lines, very large quantities |
| Order value | ₹8,000–25,000 | ₹15,000–60,000 | ₹50,000–3,00,000 |
| Predictability | **Very high** — reorder is the whole product | Medium | Low, but with lead time |
| Price sensitivity | Extreme — compares every rate | Moderate — values reliability | Low — values certainty |
| What they need most | **Fill rate + credit** | **Date certainty** | **Quote, then hit the date exactly** |
| Credit expectation | 7–30 days, non-negotiable | 15–30 days | Advance + balance on delivery |
| Failure mode for you | Slow payment, switching on rate | Miss a function date | One miss ends the relationship |
| Margin | Thinnest | Middle | Best |

**Three commercial consequences:**

1. **The retail shop segment is a reorder product, not a shopping product.** Search barely matters. The order pad — last order pre-filled, change quantities, submit in 90 seconds — is the entire UI. This is where the old §0.3 "repeat-basket intelligence" wedge becomes the load-bearing wall rather than a differentiator.

2. **Events need a quote-to-order flow that does not exist anywhere in the current build.** Enquiry → quotation with validity → customer accepts → converts to a firm order with a reserved stock allocation. Treating an event as a normal order will lose events.

3. **Caterers and events must never be served from the same free stock pool as walk-up retail orders**, or a ₹2L event gets short-shipped because eleven shops bought the flour that morning. Firm allocation against confirmed events is a real requirement (§3.4).

## 1.3 Product lines and their different physics

These three are not one catalog with three categories. They obey different laws and must be measured separately.

| | **Staples & grocery** | **Fruits & vegetables** | **Beauty & personal care** |
|---|---|---|---|
| Share of revenue *(assumed — confirm)* | ~60% | ~25% | ~15% |
| Gross margin | **3–8%** | **12–25% gross** | **12–25%** |
| Wastage | ~0.5% | **8–15% — the single biggest margin leak** | ~1% (expiry, damage) |
| Net contribution | Thin but predictable | Volatile — wastage decides it | **Best, if it turns** |
| Price stability | Weekly-ish | **Daily, sometimes twice daily** | Stable, MRP-anchored |
| Sold by | Pack / weight | **Weight — always** | Piece |
| Batch & expiry | Some | Short and brutal | **Yes, and returns on expiry** |
| Stock turns / year | 12–20 | **60–120** | 4–8 |
| Working capital drag | Medium | **Low — turns fast** | **High — sits** |
| Key control | Buy price | **Wastage + daily repricing** | Assortment, don't overstock |

**What this table demands of the system:**

- **Daily cost and daily price for F&V.** A weekly price list is wrong by Wednesday. F&V needs cost-plus pricing computed from *this morning's* landed cost, not a static rate card. This is a hard requirement, not a nice-to-have.
- **Wastage as a first-class posted number**, per branch per category per day — not a plug figure discovered at month end. If wastage is not measured daily, F&V margin is unknowable, and F&V is a quarter of revenue.
- **Margin reported by line, not blended.** A blended 10% margin hides the fact that staples earn 4% and beauty earns 20%. Mix shift is one of the top three levers (§2.4) and you cannot manage it without the split.
- **Beauty is the working-capital trap.** Best margin, worst turns. Overstocking beauty is the classic way a distributor with good margins runs out of cash.

## 1.4 Channels — how an order actually arrives

Be honest about this: **most B2B grocery orders in India today arrive by phone or WhatsApp to a person.** A system that only accepts self-serve app orders will be bypassed on day one.

| Channel | Who uses it | Priority | Notes |
|---|---|---|---|
| **WhatsApp order to a rep** | Most shops, most caterers | **V1** | Carries over the entire WhatsApp investment already built |
| **Order pad in the app** | Shops willing to self-serve | **V1** | The reorder surface; the margin lever, because it costs nothing per order |
| **Phone → telesales enters it** | Older shop owners, urgent top-ups | **V1** | Requires "place order on behalf of customer" — a role that does not exist today |
| **Field rep at the counter** | Beat-visit ordering | V1.5 | Rep app, offline-tolerant |
| **Counter walk-in at a branch** | Cash-and-carry at the shop | **V1 — record it** | ✅ **Confirmed (D-B3).** Branches do sell over the counter. See the warning below — this one cannot be fully deferred |
| Standing order / subscription | Rhythmic shops | V2 | "Same as last week, every Tuesday" — high retention, low cost to serve |

**Design rule:** every channel writes to the *same* order object through the same service. The channel is an attribute (`order.source`), never a parallel code path. Get this wrong and you maintain four order flows and reconcile none of them.

> ⚠️ **Counter sales must be recorded even though the POS is deferred.**
>
> A walk-in buying 5 kg of atta over the counter **removes stock the system still believes is there.** Unrecorded, that error compounds every single day and silently breaks the three things branch stock exists to feed: allocation to B2B orders (§3.4), reorder-point replenishment (§3.3), and inventory valuation (§3.2). Branch stock accuracy is a Phase-8 gate and a B1 rollout gate — counter sales are the most likely reason it fails.
>
> **The minimum is small:** a counter-sale entry that depletes stock and posts revenue and COGS. A few fields, not a point-of-sale product. Barcode scanning, tender types, printed receipts, cash-drawer reconciliation and a counter UI all come later. **Do the stock-truth half now; defer the retail-experience half.**

---

# 2. How the money works

## 2.1 Revenue is gross margin, not commission

The single most important line in this document:

```
Revenue        = invoice value to the customer
Cost of goods  = landed cost of what was actually shipped
Gross margin   = revenue − COGS
```

**Landed cost is not the purchase price.** It is:

```
landed cost = purchase price
            + inward freight
            + loading / unloading / mandi charges
            + grading and packing losses at receipt
            − supplier discounts, schemes and rebates actually realised
            (GST is NOT part of landed cost — it is recoverable as ITC)
```

Getting landed cost wrong overstates margin on every single order, forever, and the error compounds silently. This is why procurement and goods receipt (§3.1, §3.2) come *before* the money phase in the build plan, not after.

## 2.2 Illustrative contribution model — small retail shop order

> **Decision D-B2 — these are demo numbers.** Every figure below is an industry-typical placeholder. They are here so the *shape* of the model and the **ranking of the levers in §2.4** can be reasoned about now, which is what actually drives the build order.
>
> All of them are **configuration, not constants** — held in the pricing module, tunable per branch and per customer tier without a deploy. Replacing them with your real figures (Q2) is a data change; no code moves.

| Line | Per order | Note |
|---|---|---|
| **Invoice value (drop size)** | **₹12,000** | The B2B equivalent of AOV |
| Cost of goods sold (landed) | −₹10,800 | Blended 10% gross margin |
| **Gross margin** | **+₹1,200** | **10.0%** |
| Delivery cost (share of a multi-drop trip) | −₹150 | ~8 drops per vehicle per day |
| Picking, packing, crates | −₹80 | |
| Wastage & shrinkage (blended 2% of value) | −₹240 | F&V-weighted; see §1.3 |
| Cost of credit (30 days @ 14% p.a.) | −₹138 | Real money — most distributors ignore it |
| Bad debt provision (1% of value) | −₹120 | |
| Payment, banking, collection handling | −₹20 | |
| Comms (WhatsApp, SMS) | −₹12 | |
| **Contribution per order** | **≈ ₹440** | **3.7% of invoice value** |

### Why this is a far better business than the B2C plan

The *percentage* is nearly the same — 3.7% against the old model’s 3.8%. The **absolute number is 19× larger** — ₹440 versus ₹23 — because the order is 20× bigger and the delivery cost is not.

| | B2C marketplace (old) | B2B distribution (new) |
|---|---|---|
| Order value | ₹600 | ₹12,000 |
| Contribution per order | ₹23 | **₹440** |
| Orders/day for ₹5L monthly contribution | ~725 | **~38** |
| Supply | Had to be recruited store by store | **Already owned and running** |
| Demand | Cold-start consumer acquisition | **Existing customer relationships** |

**38 orders a day versus 725 for the same contribution.** That is the whole argument for the pivot, and it is a strong one. It also means the pilot gate (§8) is reachable with a fraction of the volume.

## 2.3 Working capital — the constraint that actually binds

**This is the section most distribution plans omit, and it is the one that kills them.** In distribution, growth consumes cash. Doubling revenue roughly doubles the cash locked up, and the cash arrives *after* you have already paid for the goods.

At **₹30 lakh monthly revenue**:

| | Days | Cash locked |
|---|---|---|
| Inventory held (DIO) | 20 | ₹18.0 L (at cost) |
| Receivables outstanding (DSO) | 30 | ₹30.0 L |
| Less: supplier credit (DPO) | −15 | −₹13.5 L |
| **Net working capital required** | **35-day cycle** | **≈ ₹34.5 L** |

**Read that carefully: ₹34.5 lakh of cash must sit still to run ₹30 lakh a month.** Every extra ₹10 lakh of monthly revenue needs roughly another ₹11.5 lakh of cash.

**The cash conversion cycle — `DIO + DSO − DPO` — is the single most important operating number in this business.** It belongs on the daily dashboard above revenue. Three ways to shorten it, in order of leverage:

1. **Cut DSO.** Every 5 days off collection at ₹30L/month releases ₹5L of cash *and* cuts bad-debt exposure. This is why §4 (credit) is a build phase and not an admin task.
2. **Raise DPO.** Supplier credit is the cheapest capital available. Negotiating 15 → 30 days releases ₹13.5L.
3. **Cut DIO.** Faster turns, less dead stock. Beauty is the usual offender (§1.3).

**Growth rule to adopt now:** never approve a revenue-growth push without stating the working capital it consumes and where that cash comes from. A distributor that grows 40% on 30-day credit without funding it runs out of money while profitable — the most common death in this industry, and it looks like success right up to the day it doesn't.

## 2.4 The levers, ranked

Unlike the marketplace model (which had two levers), distribution has six — and **you control all six**, because you own the buying.

| # | Lever | Effect | Where it lives in the system |
|---|---|---|---|
| **1** | **Buy price** | 1% better buying = **+10% contribution.** Nothing else comes close | Procurement (§3.1), supplier rate comparison, hub consolidation |
| **2** | **Drop size** | Delivery cost is fixed per drop; ₹12k → ₹18k adds ~₹550 contribution | Order pad, minimum order, upsell on reorder, standing orders |
| **3** | **Wastage** | F&V wastage 12% → 8% at 25% of revenue = **+₹120/order** | FEFO (built), daily wastage posting, demand-led replenishment |
| **4** | **Mix** | Shifting 5 points of revenue from staples to beauty/F&V lifts blended margin ~0.6pt | Assortment, rep incentives, order-pad recommendations |
| **5** | **DSO** | 30 → 20 days: releases cash, cuts bad debt, cuts credit cost | Credit engine (§4), collections, early-payment discount |
| **6** | **Route density** | 8 → 12 drops/vehicle/day cuts delivery ~₹50/order | Route planning (§3.6), delivery-day clustering |

**Levers 1 and 3 are the ones a marketplace never had.** They are also the two that most reward good software, because both are invisible without measurement.

## 2.5 Success metrics

Replaces §1.3.3 of the old spec entirely. Grouped by what they protect.

**Service — do customers get what they ordered?**
- **Fill rate ≥ 95%** by value, ≥ 93% by line — *the single most important B2B metric.* A shop that gets short-shipped twice calls someone else.
- Order-to-dispatch < 24 h for standard, < 4 h for urgent
- On-time delivery within the promised day ≥ 95%
- Order accuracy (right item, right quantity, right weight) ≥ 98%
- Zero missed event/function dates — **this is a binary, not a percentage**

**Commercial — is the trade healthy?**
- Gross margin % — reported **by category, branch and customer**, never blended alone
- Average drop size, trending up
- Active outlets (ordered in last 30 days) and **outlet reorder rate ≥ 80%**
- Lines per order, and order-pad adoption ≥ 60% of orders by month 6
- Revenue per branch per sq ft of stock held

**Money — is cash coming back?**
- **DSO ≤ 25 days**
- **Receivables > 60 days < 5% of book** — the early-warning light for the whole business
- Bad debt < 0.5% of revenue
- **Cash conversion cycle ≤ 35 days**
- Contribution per order ≥ ₹400
- Credit-limit breaches auto-blocked, 100% (no manual overrides without a logged reason)

**Inventory — is stock working or sleeping?**
- **Wastage: F&V < 8%, staples < 0.5%, beauty < 1%**
- Stock turns: staples ≥ 12/yr, F&V ≥ 60/yr, beauty ≥ 4/yr
- Dead stock (no movement 60 days) < 3% of stock value
- Stock accuracy (physical count vs system) ≥ 98%
- Branch stock-out rate on A-class SKUs < 2%

---

# 3. The operating model, end to end

Seven stages. Each names what the system must do, and flags what exists today.

## 3.1 Procure — buying at the hub

**Today: does not exist. Entirely new.**

Supplier master (GSTIN, terms, credit days, category, lead time) → indent raised from replenishment need → rate comparison across suppliers → purchase order issued → PO tracked against receipt.

- **F&V is a different flow from packaged.** Mandi buying is same-day, cash or short credit, price discovered on the day, no PO in advance. The system must support **"buy first, record immediately"** (a receipt without a prior PO) alongside the formal PO flow for packaged goods. Forcing mandi purchases through a PO workflow guarantees the data never gets entered.
- Schemes and rebates (buy 10 get 1, quarterly slabs) must be captured at PO time and **accrued into landed cost**, not booked as a windfall at quarter end — otherwise every margin number in between is wrong.
- Supplier payment terms drive DPO, which drives §2.3.

## 3.2 Receive — goods in, landed cost fixed

**Today: does not exist. Entirely new. This is the single most important new module.**

Goods receipt note (GRN) against PO or standalone → quantity and quality check → **short/damage/rejection recorded at receipt, not later** → batch and expiry captured → freight and charges apportioned across lines → **landed cost computed and frozen** → stock valued and added → supplier payable posted.

- **This is where margin truth is created.** Every downstream number — gross margin, contribution, per-customer profitability, the P&L — inherits its accuracy from here. A sloppy GRN makes every report a guess.
- **Valuation method must be decided once and never changed casually: weighted average cost is recommended** for grocery distribution — simpler than FIFO, robust to the constant small purchases this business makes, and standard for the category. FIFO is more precise for F&V but the added complexity is not worth it at this scale.
- Batch and expiry captured here flow into the **already-built** `offer.offer_batch` table, FEFO picking, and the recall workflow. That part is done.

## 3.3 Distribute — hub to branches

**Today: does not exist. Entirely new, and it is the mechanism that makes hub-and-spoke work.**

Branch demand signal (sell-through + reorder point) → **transfer suggestion generated centrally** → approved → picked at hub → **delivery challan (+ e-way bill if > ₹50,000)** → in transit → received at branch → discrepancy resolved → branch stock updated.

- **Reorder point per branch per SKU is the whole game.** `reorder point = (average daily sell-through × lead time in days) + safety stock`, recalculated on a rolling window, per branch, because branch stock is "based on the location demand" by the founder's own description. Letting branches guess reproduces the problem the hub exists to solve.
- **Stock in transit is a real state that must be visible**, or you will double-order. It is neither hub stock nor branch stock and must not be sellable from either.
- **Tax treatment — settled by D-B1, and it is the easy case.** All branches sit in **the same state under one GSTIN**, so a hub→branch transfer is **a delivery challan: no tax invoice, no GST charged, no ITC hop, no inter-state complexity.** Stock keeps its landed cost across the move — only its location changes. The ledger posts `INVENTORY(HUB)` → `INVENTORY_IN_TRANSIT` → `INVENTORY(BRANCH)` with no tax leg at all. This removes roughly half of what the transfer module would otherwise have to do.
- **E-way bill is deferred, not solved (D-B4).** It is legally required above ₹50,000 even within a single state. Per D-B4 the integration waits. **The challan carries the fields an e-way bill needs**, so switching it on later is an API call rather than a redesign. Tracked honestly as **R-9** — this is a known open exposure, not a closed item.

## 3.4 Sell — order capture

**Today: substantially built for B2C. Needs re-pointing, not rebuilding.**

Customer identified → **price resolved from their tier's price list** → order pad pre-filled from last order → quantities adjusted → **credit check before confirmation** → stock allocated → order confirmed.

What is new here:
- **Credit check is a hard gate at order confirmation.** Over limit or overdue → block or route to approval. Never a warning that can be clicked past.
- **Price comes from a customer-specific price list**, not a single selling price. This is the split described in §5.2.
- **Partial fulfilment is a normal, acceptable outcome** — "send what you have, bill what you send." B2C treats a short line as a failure needing substitution consent; **B2B treats it as routine.** The order state machine currently encodes the B2C assumption.
- **Firm allocation for events and caterers**, protected from the general free-stock pool (§1.2).
- **Quotations for events**: enquiry → quote with validity date → acceptance → order. Does not exist in any form.

## 3.5 Fulfil — pick, weigh, pack, hand over

**Today: largely built. The best-covered stage.**

Picking list (FEFO ordered) → pick → **weigh variable-weight lines** → record shorts → pack → **invoice generated on actual quantities shipped** → dispatch or hold for pickup.

- Already built: FEFO picking, batch selection, the picker screen, actual-weight entry in grams, tolerance handling, invoice-after-weighing.
- New: **pickup at branch** as a fulfilment mode — customer collects, no delivery cost, likely a small discount to encourage it (it is the cheapest fulfilment you have).
- New: **crate and container tracking** if you use returnable crates — a real cost leak in F&V distribution.

## 3.6 Deliver — routes, not slots

**Today: partially built as consumer slots. Needs reframing.**

Orders clustered by delivery day and area → route built → vehicle and driver assigned → loaded against a loading sheet → delivered in sequence → **POD captured** → cash or cheque collected → returns picked up on the same trip → end-of-day cash and returns reconciled.

- **B2B runs on delivery days and beats, not 2-hour slots.** "We serve Sector 12 on Mon/Wed/Fri." The built `slot_definition` / `slot_instance` capacity machinery maps onto route-day capacity well — this is a reframe, not a rewrite.
- **The driver collects money.** Cash, cheque, or UPI at the doorstep, against specific invoices. This is a collections function riding on the delivery, and it must post to the ledger the same day.
- **The vehicle picks up returns on the same trip.** Saleable returns and empty crates. Nobody makes a separate trip.
- Delivery cost per drop must be **measured**, not assumed, because §2.4 lever 6 depends on it.

## 3.7 Collect and adjust — the cash comes back

**Today: does not exist. Entirely new, and commercially critical.**

Invoice raised → **ageing clock starts** → reminder before due → due → overdue escalation ladder → collection (driver, rep, bank transfer, UPI) → **receipt applied against specific invoices** → disputes and credit notes → write-off with approval.

- **Receipts must be applied invoice-by-invoice, not to a floating balance.** "Shop paid ₹40,000" against a book of eleven invoices is unreconcilable within a month. Which invoices it cleared is the whole record.
- **Credit note** is a GST document, required for: saleable returns, rate differences, damages, and post-sale discounts. It affects both your GST filing and your customer's ITC.
- **Saleable returns** — unsold stock coming back from a shop — do not exist in B2C and are routine in B2B. The goods re-enter stock at their original landed cost, not at the selling price.

---

# 4. Credit — the system that decides whether this business lives

> Credit is not a feature. In B2B distribution it is the **primary risk system**, and it deserves the same rigour the old plan gave to the ledger. Everything in §2.3 flows through it.

## 4.1 Customer credit profile

Every B2B customer carries:

| Field | Purpose |
|---|---|
| Credit limit (₹) | Maximum total outstanding permitted |
| Credit days | 0 (cash) / 7 / 15 / 30 / 45 |
| Security held | Cheque, PDC, deposit, personal guarantee — and its value |
| Risk grade | A / B / C / D, derived from payment behaviour, not opinion |
| Current outstanding | Live, computed from the ledger |
| Overdue amount and oldest overdue days | The number that triggers everything |
| Status | ACTIVE / WATCH / **HOLD** / SUSPENDED / WRITTEN-OFF |

## 4.2 The gate at order time

```
available credit = credit limit
                 − outstanding invoices
                 − undelivered confirmed orders   ← easy to forget, and it is how limits get breached
                 + unapplied receipts
```

| Condition | Action |
|---|---|
| Within limit, nothing overdue | **Confirm** |
| Within limit, overdue 1–15 days | Confirm + reminder to the customer |
| Within limit, overdue 16–30 days | **Approval required** (branch manager) |
| Over limit **or** overdue > 30 days | **BLOCK.** Cash-only, or head-office approval with logged reason |
| Overdue > 60 days | **HOLD.** No supply. Collections owns the account |

**Every override is logged with who, when, why, and how much.** Uncontrolled overrides are how a receivables book quietly rots — and the audit-log pattern already built for COD risk decisions (`cod.cod_risk_decision`) is exactly the right shape to reuse.

## 4.3 Ageing and collections

Standard buckets, reported daily per customer, per branch, per rep: **0–30 · 31–60 · 61–90 · 90+**.

| Bucket | Owner | Action |
|---|---|---|
| Not yet due | System | WhatsApp reminder 2 days before due |
| 1–15 overdue | Sales rep | Reminder on the next beat visit |
| 16–30 | Branch manager | Call + **new orders need approval** |
| 31–60 | Head office | **Supply stopped.** Payment plan or security enforced |
| 61–90 | Head office | Legal notice considered; provision raised |
| 90+ | Founder | Write-off decision; account suspended |

**Collection efficiency = collections in the month ÷ opening receivables + sales.** It belongs on the daily dashboard next to the cash conversion cycle.

## 4.4 What the old COD risk engine becomes

The `cod` module built in P3.4 — bands, ops-configurable thresholds in a table, confirmation flow, full audit log — is **structurally right and commercially misdirected**. Its inputs were consumer fraud signals (new customer, high value, risky pincode). Its inputs become **credit signals** (utilisation, days overdue, payment history, cheque bounces, security held).

**Keep the engine and the audit discipline. Replace the rules.** The rules already sit behind an interface (readiness item G3), which is precisely the seam that makes this a rule swap rather than a refactor. That decision, made months ago for AI reasons, is paying for itself here.

---

# 5. Domain model — what moves

## 5.1 Module map after the pivot

Grounded in the 22 modules and 36 tables actually in the repo today.

| Module | Today | After | Effort |
|---|---|---|---|
| `catalog` | Master product, brand, category, product request | **Unchanged.** Add beauty attributes (shade, size, variant) | ⚙ S |
| `search` | Postgres search, synonyms, index | **Unchanged.** Less central in B2B — the order pad replaces browse | — |
| `vendor` | External shops, approval, suspension, FSSAI | → **`branch`**. Own locations. **Delete approval, suspension, onboarding, SLA** | ⚙⚙ M |
| `offer` | `vendor_offer` — price + stock per vendor | **SPLITS IN TWO**: `pricing.price_list_item` (central, per tier) + `inventory.branch_stock` (per branch). Keep `offer_batch` as-is | ⚙⚙⚙ L |
| `pricing` | Delivery / small-basket / packaging fees | **Rebuilt**: price lists, customer tiers, quantity slabs, scheme discounts, **cost-plus for F&V** | ⚙⚙⚙ L |
| `inventory` | Reservation, oversell guard | **Extended**: per-branch stock, in-transit, firm allocation. **Keep the atomic reservation guarantee — it was hard-won** | ⚙⚙ M |
| `cart` | Consumer cart | → **order pad**. Same object, different surface | ⚙ S |
| `order` | Order, lines, status history, substitution | **Mostly kept.** `vendor_id` → `branch_id`; add `source`, `customer_type`, **partial fulfilment as a normal terminal state** | ⚙⚙ M |
| `checkout` | Address → slot → payment | **Re-pointed**: customer → delivery day → **credit check** → confirm | ⚙⚙ M |
| `serviceability` | Polygons, slots, waitlist | → **routes and delivery days**. Capacity machinery survives; the framing changes | ⚙⚙ M |
| `delivery` | Provider abstraction (unbuilt) | → **own vehicles and drivers**, route sequence, POD, doorstep collection | ⚙⚙⚙ L |
| `payment` | Razorpay UPI, refunds | **Kept**, plus cheque, bank transfer, part-payment, **receipt application against invoices** | ⚙⚙ M |
| `cod` | Consumer COD risk bands | → **credit risk**. Engine kept, rules replaced (§4.4) | ⚙⚙ M |
| `ledger` | ⚠️ **In progress, uncommitted** | **Chart of accounts recut now** — see §5.3. Discipline and invariants unchanged | ⚙⚙ M |
| `settlement` | Vendor payouts T+3/T+7 (unbuilt) | → **customer collections and supplier payments.** Complete inversion, nothing built yet | ⚙⚙⚙ L |
| `tax` | Stub. GST, TCS §52, TDS 194-O | **Simplified by D-B1 + D-B4**: single-GSTIN B2B invoice, demo GSTIN, configurable flat GST rates, credit/debit notes. **Delete marketplace TCS/TDS.** E-way bill and e-invoice are **seams only** | ⚙⚙ M |
| `notification` | WhatsApp, templates, inbound | **Kept.** Templates rewritten for B2B (order confirmed, dispatched, **payment due**, **overdue**, statement) | ⚙⚙ M |
| `identity` / `user` | Account, roles, address | **Extended**: customer **organisation** with multiple users; rep-on-behalf-of; branch scoping | ⚙⚙ M |
| `admin` | Ops console | → **control tower** (§3, §7 Phase 11) | ⚙⚙⚙ L |
| `analytics` | Event ingest | **Kept.** Event catalogue rewritten for B2B funnels | ⚙ S |
| `support` | Tickets | **Kept** | — |
| **`procurement`** | — | **NEW**: supplier, PO, indent, schemes | ⚙⚙⚙ L |
| **`receiving`** | — | **NEW**: GRN, landed cost, valuation. *The most important new module* | ⚙⚙⚙ L |
| **`transfer`** | — | **NEW**: hub↔branch movement, challan, in-transit | ⚙⚙ M |
| **`credit`** | — | **NEW**: limits, exposure, ageing, collections, holds | ⚙⚙⚙ L |
| **`wastage`** | — | **NEW**: damage, expiry, shrinkage, posted daily | ⚙ S |
| **`counter`** | — | **NEW (D-B3)**: counter sale at a branch — depletes stock, posts revenue and COGS. **Stock truth now, full POS later** | ⚙ S |

**Net: 4 modules deleted or gutted, ~10 re-pointed, 6 new.** The foundation — boundaries, contracts, idempotency, migrations, CI, deploy — carries over completely. The module-boundary discipline is what makes a pivot of this size survivable at all; without it this would be a rewrite.

## 5.2 The one genuinely hard model change

**`offer.vendor_offer` conflates two things that must now separate.**

In the marketplace, one row meant "this vendor's price and this vendor's stock for this product" — correct, because competing vendors set competing prices on their own stock.

In distribution, **there is one seller (you)**, so:

- **Price is central and varies by customer**, not by location. Shop A pays ₹52/kg, Caterer B pays ₹49/kg, at every branch.
- **Stock is per branch and does not vary by customer.** Branch 2 has 400 kg; who buys it does not change that.

```
                    OLD                                  NEW
        ┌────────────────────────┐        ┌──────────────────────────────┐
        │   offer.vendor_offer   │        │  pricing.price_list_item     │
        │  ├ vendor_id           │  ───▶  │  ├ price_list_id (per tier)  │
        │  ├ master_product_id   │        │  ├ master_product_id         │
        │  ├ selling_price       │        │  ├ rate, slab, valid_from    │
        │  ├ mrp                 │        │  └ (central, customer-facing) │
        │  ├ stock_on_hand       │        ├──────────────────────────────┤
        │  ├ stock_reserved      │        │  inventory.branch_stock      │
        │  ├ inventory_mode      │        │  ├ branch_id                 │
        │  ├ is_available        │        │  ├ master_product_id         │
        │  └ batch/expiry ───────┼───┐    │  ├ on_hand, reserved         │
        └────────────────────────┘   │    │  ├ allocated_firm  ← new     │
                                     │    │  ├ in_transit      ← new     │
                                     │    │  └ weighted_avg_cost ← new   │
                                     │    ├──────────────────────────────┤
                                     └──▶ │  offer.offer_batch           │
                                          │  (UNCHANGED — repoint the FK) │
                                          └──────────────────────────────┘
```

**This is the migration with real risk**, because `vendor_offer_id` is referenced from `order.order_line`, `inventory.reservation`, `offer.offer_batch`, `search.product_index` and the cart. It must be done **early, before Phase 7 loads it with landed-cost data** — hence its position as the first phase.

Two things worth protecting through the migration:
- The `vendor_offer_reserved_within_stock` check constraint and P3.1's atomic reservation statement are the oversell guarantee. **Port them, do not reimplement them.**
- `inventory_mode` (TOGGLE / THRESHOLD / QUANTITY) was designed for kiranas with bad data. **Your own branches should all run QUANTITY mode** — you control them, and you need true counts for valuation. Keep the column for a possible future third-party seller, but default and enforce QUANTITY. This is a genuine simplification the pivot buys you.

## 5.3 The ledger — decide this before committing P5.1

The uncommitted `packages/contracts/src/ledger.ts` defines a **marketplace** chart of accounts. Under the B2B model it is wrong in a specific, fixable way. **The timing is fortunate: nothing has been built on it yet.**

| Current account | Fate | Why |
|---|---|---|
| `PLATFORM_REVENUE` | → **`SALES_REVENUE`** | You sell goods; you do not earn commission |
| `VENDOR_PAYABLE` | → **`SUPPLIER_PAYABLE`** *(scoped)* | You owe suppliers for goods bought, not vendors for goods sold |
| `GST_TCS_PAYABLE` | **DELETE** | §52 TCS applies to e-commerce *operators* facilitating third-party supply. You are the principal supplier |
| `TDS_PAYABLE` | **DELETE** *(then re-add per Q6)* | 194-O is a marketplace provision. **194Q / 206C(1H) may apply instead** — CA question |
| `COD_CASH_IN_TRANSIT` | **KEEP**, rescope to driver | Same mechanic: cash held, not yet banked. The shortfall detection works unchanged |
| `CASH_AT_HUB`, `BANK`, `GATEWAY_RECEIVABLE`, `CUSTOMER_REFUND_PAYABLE`, `WRITE_OFF` | **KEEP** | All still correct |
| — | **NEW: `CUSTOMER_RECEIVABLE`** *(scoped per customer)* | **The most important new account.** The entire credit book |
| — | **NEW: `INVENTORY`** *(scoped per location)* | Asset. Stock you own, at landed cost |
| — | **NEW: `INVENTORY_IN_TRANSIT`** | Asset. Hub→branch stock, owned by neither end |
| — | **NEW: `COGS`** | Expense. What margin is computed against |
| — | **NEW: `WASTAGE`** | Expense. Separate from write-off — this is stock destroyed, not debt forgiven |
| — | **NEW: `GST_INPUT_CREDIT`** | Asset. GST paid on purchases, recoverable |
| — | **NEW: `GST_OUTPUT_PAYABLE`** | Liability. GST charged on sales |

**Worked example — B2B sale on credit, ₹12,000 goods at ₹10,800 landed cost, 5% GST:**

```
Dr customer_receivable(C)        12,600
   Cr sales_revenue                        12,000
   Cr gst_output_payable                      600

Dr cogs                          10,800
   Cr inventory(BRANCH)                    10,800
```
Gross margin ₹1,200 falls straight out of the ledger. It is never a spreadsheet.

**On collection (₹12,600 cash to the driver):**
```
Dr cod_cash_in_transit(DRIVER)   12,600
   Cr customer_receivable(C)               12,600
```
**Driver banks it:**
```
Dr bank                          12,600
   Cr cod_cash_in_transit(DRIVER)          12,600
```

A non-zero `customer_receivable(C)` past its due date **is** the overdue amount — computed, not asserted. A non-zero `cod_cash_in_transit(DRIVER)` after the deposit deadline **is** the cash shortfall. Both fall out of double entry with no reconciliation spreadsheet, exactly as the original §2.11 intended. **The discipline was right; only the account names were wrong.**

`SCOPED_ACCOUNTS` becomes: `CUSTOMER_RECEIVABLE`, `SUPPLIER_PAYABLE`, `COD_CASH_IN_TRANSIT`, `INVENTORY`. `LedgerRef` gains `PURCHASE`, `GRN`, `TRANSFER`, `WASTAGE`, `CREDIT_NOTE`, `RECEIPT`.

---

# 6. Compliance — what changes, and what D-B1 and D-B4 took off the table

Two founder decisions shrank this section more than any other. **D-B1** (all branches in one state, one GSTIN) removes the inter-state transfer problem entirely. **D-B4** (simple invoice, demo GSTIN, replace later) defers the integration-heavy items behind seams.

| Area | B2C marketplace | **B2B distribution, as decided** | Status |
|---|---|---|---|
| GST registration | Per vendor | **One GSTIN for hub and all branches** (D-B1). Branches are additional places of business on the same registration | ✅ **Simple** |
| Invoice | To unregistered consumer; B2C summary in GSTR-1 | **Must carry buyer GSTIN.** Appears as B2B in GSTR-1; buyer claims ITC | **Build — simple form (D-B4)** |
| Invoice accuracy | Compliance matter | **Commercial matter.** A wrong invoice costs your customer real ITC money, and they will stop buying. This does not get simpler just because the tax config is a placeholder | ⚠️ |
| GSTIN & rates | — | **Demo GSTIN, configurable flat rates** (D-B4). Real values swapped in at P12.1 | **Deferred, fenced** |
| **Inter-branch transfer** | — | **Delivery challan. No tax.** (D-B1) | ✅ **Removed** |
| **E-way bill** | Rarely triggered | Legally required > ₹50,000 **even within one state**. Deferred per D-B4; challan carries the required fields | 🔓 **Seam — R-9** |
| **E-invoice (IRN + QR)** | N/A | Mandatory above the turnover threshold. Deferred per D-B4 | 🔓 **Seam** |
| Credit / debit notes | Rare | **Routine** — returns, rate differences, damages. Build these; they are core trade documents, not an integration | **Build** |
| TCS §52 | Applied (marketplace) | **Does not apply** — you are the principal supplier, not an e-commerce operator | ❌ **Delete** |
| TDS 194-O | Applied (marketplace) | **Does not apply.** 194Q / 206C(1H) may, at higher turnover — revisit with the CA when volumes justify it | ❌ **Delete** |
| Reverse charge | Rare | Applies on some unregistered purchases — **mandi buying especially**. Model the flag now, compute later | **Flag only** |
| ITC | N/A | **Central to profitability.** GST on purchases, freight and expenses is real money. Track it even while rates are demo values | **Build the register** |
| FSSAI | Per vendor | **Yours now — per location.** Every branch storing or selling food needs its own registration or licence. Not deferrable; it is a physical-premises requirement | ⚠️ **Real work** |
| Beauty products | N/A | Cosmetics carry their own labelling and, for some categories, licensing rules — distinct from FSSAI | **Q5** |
| Weights & Measures | Per vendor | **Yours now.** Legal Metrology: declarations, and verified weighing equipment at every location that weighs | ⚠️ **Real work** |
| DPDP 2023 | Consumer PII heavy | **Lighter** — business contacts rather than consumer personal data. Still applies | Reduced |

## 6.1 The three that are still real work

D-B4 deferred the *software* integrations. It did not defer the *physical* obligations, and these three have lead times measured in weeks:

1. **FSSAI registration or licence per branch.** Every location that stores or sells food needs its own. No amount of deferred tax config makes this go away.
2. **Legal Metrology — verified weighing equipment at every location that weighs.** F&V is a quarter of revenue and all of it is weighed.
3. **Cosmetics labelling and licensing** for the beauty range, depending on what is in it (Q5).

## 6.2 The rule that keeps deferral safe

> **Demo tax configuration must be structurally incapable of booting in production.**

The pattern already exists in this codebase: P0.5a built an image that **refuses to start in production** when it is misconfigured, and it works. Apply exactly that to the tax config — a demo GSTIN or a placeholder rate table must hard-fail a production boot, not warn.

This is what makes D-B4 a safe decision rather than a deferred incident. Without the fence, "we will replace it later" becomes an invoice with a fake GSTIN sent to a real customer, who then cannot claim ITC and has a legitimate grievance. Tracked as **R-11**.

---

# 7. Phased build plan

Phases 0–4 are **built, deployed, and largely reusable** (753 tests, API + storefront live on GCP). Phase 5 onward is recut below. The old Phases 5–8 are superseded.

**Sequencing principle: model → cost truth → stock truth → sell → collect → deliver → control → comply.** You cannot compute margin before landed cost exists, and you cannot compute landed cost before receiving exists. That dependency chain sets the order and is not negotiable.

## Phase 5 — The recut ⚙⚙⚙
*Everything else is built on this. Do it first, do it completely, do not build around it.*

| Part | Title | Notes |
|---|---|---|
| P5.1 | **Ledger chart of accounts (B2B)** | ✅ **Done 2026-08-24.** Marketplace accounts replaced with `CUSTOMER_RECEIVABLE`, `SUPPLIER_PAYABLE`, `INVENTORY`, `COGS`, `WASTAGE`, GST input/output. Scope kinds named (customer / supplier / location / driver). Every invariant unchanged |
| P5.2 | `vendor` → `branch` | Delete approval/suspension/SLA. Hub flagged as a branch with `is_hub` |
| P5.3 | **Split `vendor_offer`** | → `pricing.price_list_item` + `inventory.branch_stock` (§5.2). **The riskiest migration in the plan** |
| P5.4 | Customer organisation & types | Org with multiple users, `customer_type`, rep-on-behalf-of, branch scoping |
| P5.5 | Price lists & tiers | Tier → price list → rate, slabs, validity. Cost-plus mode for F&V |

**Gate:** an order can be placed at a customer-specific price, allocated from a specific branch's stock, and posts a balanced entry to the new chart of accounts.

## Phase 6 — Credit, receivables & collections ⚙⚙⚙

> **Reordered 2026-08-24 — this was Phase 9.** Two reasons, and the second is the deciding one.
>
> **It is the shortest path to a number you cannot get today.** Credit needs only customers, invoices and the ledger — all of which land in Phase 5. Margin, by contrast, needs procurement, goods receipt, valuation and catalog depth before it says anything true. Roughly four weeks to first value against twelve.
>
> **And the data entry is yours.** The credit book is the founder's own record, kept by the founder. Goods receipt pushes discipline onto whoever is at the warehouse door at 6am — and software dying because the warehouse quietly stopped entering things is the single most common failure in this category. Build the habit on the person who feels the pain first; earn the right to ask the warehouse second.

| Part | Title | Notes |
|---|---|---|
| P6.1 | Credit profiles & limits | Limit, days, security, risk grade, status |
| P6.2 | Live exposure & ageing | Buckets, per customer / branch / rep. Computed from the ledger |
| P6.3 | Invoice → receivable posting | Every invoice opens a receivable and starts an ageing clock |
| P6.4 | Receipt application | **Against specific invoices**, never a floating balance |
| P6.5 | Credit gate at order confirmation | Hard gate (§4.2). Reuses the `cod` risk engine, new rules |
| P6.6 | Collections workflow | Escalation ladder (§4.3), driver and rep collection, doorstep UPI |
| P6.7 | Credit notes | GST-correct, for returns and rate differences |
| P6.8 | Customer statements | Opening → invoices → receipts → notes → closing. **Must tie to the ledger exactly** |

**Gate:** the founder stops opening the ledger book. Ageing and collection days compute live from the ledger, and a customer statement ties to the paisa.

## Phase 7 — Procurement & landed cost ⚙⚙⚙
*Where margin truth is created. Nothing about profitability is trustworthy until this is right.*

| Part | Title | Notes |
|---|---|---|
| P7.1 | Supplier master | GSTIN, terms, credit days, lead time, category |
| P7.2 | Purchase orders & indents | Formal flow for packaged goods |
| P7.3 | **Goods receipt & landed cost** | **The most important new module.** Short/damage at receipt, freight apportionment, batch capture |
| P7.4 | Inventory valuation | **Weighted average cost.** Posts `INVENTORY` and `COGS` |
| P7.5 | Mandi / direct-purchase flow | Receipt without a prior PO. **Without this, F&V data never gets entered** |
| P7.6 | Schemes & rebates | Accrued into landed cost, not booked as a quarter-end windfall |
| P7.7 | Supplier payables | The other side: DPO, payment scheduling, reconciliation |

**Gate:** gross margin on a delivered order is computed from the ledger and ties to a manual calculation, to the paisa.

## Phase 8 — Stock across locations ⚙⚙
| Part | Title | Notes |
|---|---|---|
| P8.1 | Branch stock truth | Per-branch on-hand, reserved, in-transit, firm-allocated |
| P8.2 | Stock transfer hub↔branch | Challan, in-transit state, receipt, discrepancy resolution |
| P8.3 | **Reorder points & replenishment suggestions** | Per branch per SKU from rolling sell-through. **The hub-and-spoke mechanism** |
| P8.4 | Wastage & shrinkage | Damage, expiry, adjustment — posted daily, per branch, per category |
| P8.5 | Physical stock count | Cycle counting, variance approval, ledger adjustment |
| P8.6 | **Counter-sale recording (D-B3)** | Walk-in sale depletes branch stock, posts revenue + COGS. **Stock truth, not a POS** — see §1.4 |

**Gate:** a branch's system stock matches a physical count within 2% **on a day that included counter sales**, and every variance has a posted ledger entry explaining it.

## Phase 9 — B2B order to invoice ⚙⚙⚙
| Part | Title | Notes |
|---|---|---|
| P9.1 | **Order pad** | Last order pre-filled, fast quantity entry, running total, live credit balance |
| P9.2 | Credit check wired into checkout | The gate itself ships in P6.5; this is the order flow calling it |
| P9.3 | Allocation & partial fulfilment | Firm allocation for events; **partial fill as a normal terminal state** |
| P9.4 | Telesales & rep-on-behalf-of | Order placed *for* a customer, attributed correctly |
| P9.5 | **B2B tax invoice** | Buyer GSTIN, HSN, correct GST split, e-invoice hook |
| P9.6 | Quotations for events | Enquiry → quote → validity → acceptance → firm order |
| P9.7 | WhatsApp order capture | Rewire the built templates to the B2B flow |

**Gate:** a shop orders from the pad, is credit-checked, allocated, picked, weighed, and invoiced with a GST-correct B2B invoice.

## Phase 10 — Distribution & routes ⚙⚙⚙
| Part | Title | Notes |
|---|---|---|
| P10.1 | Delivery days & beats | Reframe the built slot machinery as route-day capacity |
| P10.2 | Route planning & loading | Cluster by area and day, sequence, loading sheet |
| P10.3 | Vehicles & drivers — **own and hired (D-B6)** | One vehicle model, `ownership: OWNED \| HIRED`. Owned carries running cost; hired carries a per-trip rate. **Both attribute cost per trip**, or delivery cost per drop (§2.4 lever 6) becomes a guess |
| P10.4 | Driver app & POD | Sequence, POD, doorstep collection, returns pickup |
| P10.5 | **Pickup at branch** | Cheapest fulfilment mode. Ready-for-collection notification |
| P10.6 | Crate & container tracking | If returnable crates are used — a real F&V cost leak |

**Gate:** a day's orders build into routes, load onto vehicles, deliver with POD, collect cash, and reconcile end-of-day to the ledger.

## Phase 11 — Control tower ⚙⚙⚙
*This is "handle all of this from a single location", made real.*

| Part | Title | Notes |
|---|---|---|
| P11.1 | Network dashboard | All branches: stock, orders, receivables, wastage, one screen |
| P11.2 | **Margin analytics** | By category, branch, customer, rep, SKU. Never blended alone |
| P11.3 | **Cash & working capital dashboard** | DIO, DSO, DPO, **cash conversion cycle** (§2.3) |
| P11.4 | Replenishment engine | Auto-generated transfer and purchase suggestions |
| P11.5 | Demand planning | Seasonality, festivals, event pipeline feeding purchase plans |
| P11.6 | Customer & rep performance | Reorder rate, drop size, fill rate, collection efficiency |

**Gate:** the founder runs a day from one screen without calling a single branch.

## Phase 12 — Compliance & launch readiness ⚙⚙

*Materially smaller than first planned, because **D-B1** (one state, one GSTIN) and **D-B4** (simple invoice) removed most of it. What remains is mostly the auth work carried over from the old plan.*

| Part | Title | Notes |
|---|---|---|
| P12.1 | **Replace the demo tax config** | Real GSTIN, real rates, real HSN. **Fenced so demo values cannot boot in production** — reuse the "refuses production" guard pattern already proven in P0.5a. See **R-11** |
| P12.2 | GST returns support | GSTR-1 / 3B data, ITC register, reconciliation |
| P12.3 | E-way bill integration | 🔓 Seam open from P7.2. Switch on when volume or enforcement requires it — **R-9** |
| P12.4 | E-invoice (IRN + QR) | 🔓 Seam only. Needed if turnover crosses the threshold — take it to the CA at that point, not from memory |
| P12.5 | **Auth hardening** | 🔒 **STILL BLOCKS PRODUCTION.** Carried forward from old P8.6. Real OTP, refresh rotation, rate limits, admin MFA |
| P12.6 | Abuse prevention & API hardening | Carried forward |
| P12.7 | DPDP features | Reduced scope — business contacts, not consumer PII |
| P12.8 | Load & chaos testing | Against real branch and order volumes |
| P12.9 | Launch readiness review | |

---

# 8. Rollout gates

Replaces §1.10 of the old spec.

| Phase | Scope | Go/no-go to advance |
|---|---|---|
| **B0 — Hub only** | Main shop, 10–15 friendly existing customers | Order → pick → invoice → deliver → collect works end to end. **Landed cost and gross margin tie to manual calculation** |
| **B1 — Hub + 1 branch** | One branch on the system, ~30 customers | Stock transfer works · branch stock accurate within 2% · **DSO measured and under 30** · fill rate ≥ 93% |
| **B2 — Full network** | All N branches, full customer base | All B1 gates hold at N branches · **cash conversion cycle ≤ 35 days** · wastage measured and within target by category · zero missed event dates |
| **B3 — Grow** | New customers, new territory, possibly B2C | **Unit economics positive and working capital funded.** Playbook repeatable without founder involvement |

**If B1 gates are missed:** the likely cause is data discipline (GRN quality, stock counts), not software. Fix the operating discipline before adding branches — a second branch multiplies a data problem, it does not dilute it.

---

# 9. Open questions — what is left

**Every schema-level question is closed** (see *Decisions taken*, top of document). What remains changes numbers and policy, not structure — so none of it blocks the build. The model runs on demo values until each is answered.

## 9.1 Closed

| Q | Was | **Answer** |
|---|---|---|
| Q1 | Branch geography, same state or not? | **Same state** → D-B1 |
| Q2 | Real economic numbers? | **Use demo numbers for now** → D-B2 *(still worth answering — see 9.2)* |
| Q3 | Counter retail at branches? | **Yes** → D-B3 |
| Q4 | Confirm customer types? | **Shops, catering, event management** → D-B5 |
| Q6 | Tax and invoicing scope? | **Simple invoice, demo GSTIN, replace later** → D-B4 |
| Q8 | Own vehicles or hired? | **Both** → D-B6 |
| Q9 | Keep B2C alive? | **Deferred, seam kept** → D-B7 |

## 9.2 Still open — answer when convenient, not before building

### Q2b — Your real numbers 🟠 *Changes decisions, not code*
Monthly revenue · split across staples / F&V / beauty · **actual gross margin by category** · average order value by customer type · active customer count · **credit days you actually give and your real DSO** · supplier terms (DPO).

Why it still matters even under D-B2: §2.4 ranks six levers, and **the ranking drives the build order.** I have put buy price first and wastage third on industry assumptions. If your F&V wastage is actually 4% and your staples margin is actually 3%, the ranking shifts and so should the sequence. Demo numbers are fine to build against; they are not fine to *plan* against forever.

### Q5 — What is in the beauty range? 🟠
Branded FMCG (MRP-anchored, thin margin, safe) or unbranded/local (better margin, more freedom)? And does it include anything **ayurvedic, medicated, or drug-adjacent** — which widens the licensing surface beyond FSSAI (§6.1)?

### Q7 — Your actual credit policy 🟠
What limits, what days, what security (PDCs, deposits, guarantees), and what your worst overdue looks like today. §4 is currently written as textbook good practice. **I would rather encode your real policy and tighten it gradually than ship a policy your customers reject on day one** — a credit gate that everybody overrides is worse than no gate, because it produces an audit log of ignored warnings.

### Q10 — Stock held 🟢
Roughly what value sits at the hub and at a typical branch, and how long it sits. Sizes DIO in §2.3 and sets reorder-point defaults in P8.3. Demo values work until then.

### Q11 — New, raised by D-B3 🟠
**Roughly what share of a branch's sales go over the counter versus B2B?** If counter retail is 5% of a branch's movement, P8.6 stays a small stock-depletion entry. If it is 40%, counter sale is a major flow that deserves a proper POS earlier than Phase 12 — and branch stock accuracy depends almost entirely on getting it right.

### Q12 — New, raised by D-B6 🟢
**Roughly what is the own/hired split, and how do you pay hired vehicles** — per trip, per day, or per km? P10.3 needs the shape to attribute cost per drop correctly.

---

# 10. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| **R-1** | **Working capital runs out while growing** | **Fatal, and it looks like success until the day it isn't** | §2.3 cash conversion cycle on the daily dashboard · growth approvals must state the cash they consume · credit discipline in §4 |
| **R-2** | **Receivables rot** — customers stretch payment, nobody stops supply | Fatal, slowly | Hard credit gate at order time (§4.2) · escalation ladder with **supply stop** at 31 days · logged overrides only |
| **R-3** | **Landed cost is wrong** → every margin number is fiction | Severe, and invisible | GRN discipline (P6.3) built before any margin reporting · gross margin gate at Phase 6 ties to manual calculation |
| **R-4** | **F&V wastage eats the category's margin** | Severe — a quarter of revenue | Daily wastage posting (P8.4) · FEFO (built) · demand-led replenishment (P8.3) · daily cost-plus repricing |
| **R-5** | **Branch stock data drifts from reality** | Severe — allocation and replenishment both fail | Cycle counting (P8.5) · QUANTITY mode enforced at every branch · 2% accuracy gate before adding branches |
| **R-6** | **Customers keep ordering by phone; the system is bypassed** | Moderate — you lose the data, and the data is the product | Every channel writes the same order object (§1.4) · telesales entry is a first-class flow, not a workaround |
| **R-7** | **A missed event or function date** | Reputational, segment-ending | Firm allocation protected from free stock (§3.4) · zero-missed-dates is a binary metric |
| **R-8** | **The `vendor_offer` split goes wrong mid-flight** | Severe — it touches orders, reservations, batches, search | Do it in Phase 5, before Phase 7 loads it with cost data · port the oversell constraint rather than reimplementing it |
| **R-9** | **E-way bill deferred under D-B4** — required above ₹50k even in-state | Goods can be detained in transit; penalties | **Accepted, not solved.** Challan carries e-way-bill fields so P12.3 is an API call · revisit the moment consignment values or enforcement rise |
| **R-10** | **Over-building.** 8 phases is a lot; the business runs today on WhatsApp and a notebook | Moderate — slow shipping, no adoption | Gate at B0 with the hub only · ship Phase 5–6 and *use it* before building Phase 7 · the existing business is the fallback, not a hostage |
| **R-11** | **Demo tax config reaches production** (D-B4) | A real customer gets an invoice with a fake GSTIN and loses their ITC | **Hard-fail production boot on placeholder values** (§6.2), reusing P0.5a's proven "refuses production" guard · P12.1 replaces them |
| **R-12** | **Counter sales go unrecorded** (D-B3) | Branch stock silently drifts — breaks allocation, replenishment and valuation at once | P8.6 records the stock movement from day one · physical-count gate deliberately run on a day that included counter sales · **Q11** sizes how urgent this is |

---

# 11. What I recommend doing next

The blocking questions are answered, so this is a build order rather than a waiting list.

1. ✅ **Ledger re-chart — done 2026-08-24 (P5.1).** The cheapest correction in the plan, taken while it was still free. `CUSTOMER_RECEIVABLE`, `SUPPLIER_PAYABLE`, `INVENTORY`, `COGS` and `WASTAGE` replace the marketplace accounts; every invariant and all three layers of balance enforcement are untouched.
2. **Finish Phase 5 completely before anything else.** The `vendor_offer` split (§5.2) is the load-bearing migration and it touches orders, reservations, batches and search. Building on the old shape makes it worse every day.
3. **Then Phase 6 — credit — not procurement.** Reordered deliberately: it reaches a number you cannot get today in about a third of the time, and the data entry belongs to the person who feels the pain. See the note under Phase 6.
4. **Fence the demo tax config the day it is written**, not at P12.1 (§6.2, R-11). Deferring the values is fine; deferring the guard is how a fake GSTIN reaches a real invoice.
5. **Do not defer counter-sale recording** (R-12). Small work whose absence quietly invalidates branch stock — and branch stock is what Phases 8–11 stand on.
6. **Run against the hub only, with real orders, before adding a branch.** A data-discipline problem multiplies with each branch; it does not dilute.
7. **Start FSSAI per branch and Legal Metrology verification now** (§6.1). D-B4 deferred the software, not these. They have real lead times and no amount of code closes them.
8. **Answer Q2b when you have a quiet hour.** Not to unblock — to confirm the lever ranking in §2.4, because that ranking is what set the phase order, and it is currently derived from demo numbers.

---

## Appendix A — Document status

| Section | Confidence | Basis |
|---|---|---|
| Decisions taken | **Confirmed** | Founder, 2026-08-24 |
| §0 What changed | **High** | Founder's direct description |
| §1.1 Network structure | **High** | Founder's direct description |
| §1.2 Customer segments | **High (types)**, Medium (behaviour) | Types confirmed by D-B5; behaviour is industry pattern |
| §1.3 Product physics | Medium | Lines confirmed; margins and wastage are industry ranges → **Q2b**, **Q5** |
| §1.4 Channels | **High** | Counter retail confirmed by D-B3 → sizing open at **Q11** |
| §2.2 Unit economics | **Demo values, by decision (D-B2)** | Industry placeholders. Shape is sound; figures are not yours yet |
| §2.3 Working capital | **High (method)**, demo (numbers) | Method is standard; numbers await **Q2b** |
| §2.4 Lever ranking | Medium | **Derived from demo numbers** — the one place where D-B2 has a real cost, since the ranking set the phase order |
| §3 Operating model | **High** | Standard distribution flow, mapped onto the built system |
| §4 Credit | **High (method)**, unconfirmed (policy) | Textbook practice → tune with **Q7** |
| §5 Domain model | **High** | Read directly from the repo — 22 modules, 36 tables |
| §6 Compliance | **High (scope)**, deferred (detail) | Simplified by D-B1 and D-B4. §6.1's three physical items are real and unavoidable |
| §7 Phases | **High** | Derived from §5 dependencies and the decisions above |
| §8 Gates | **High** | Adapted from the old §1.10, which was sound |

**Nothing in this document should be treated as tax or legal advice.** D-B4 defers the tax detail deliberately; §6.1 and §6.2 name what that deferral does *not* cover. Take §6 to a CA and counsel before P12.1 replaces the demo values — not from this file.
