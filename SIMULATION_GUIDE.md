# GridFlex Simulator — User Guide

**Constraint-Relieved Dispatch Model + Topology Leverage**
**Production Cost Delta Simulator**

This is the operating manual for the React simulator at `website/gridflex-sim/`. It explains every input, every output, what each market type means, how the math flows, and how to read the screens during a utility conversation.

The simulator implements the methodology in [`power-flow-model/Pilot_Grade_Process.md`](../../power-flow-model/Pilot_Grade_Process.md) and the formula chain in [`business-materials/Formulas_Meanings.md`](../../business-materials/Formulas_Meanings.md).

---

## 1. Running the simulator

```bash
cd website/gridflex-sim
npm install         # first time only
npm start
```

Opens at [http://localhost:3000](http://localhost:3000).

---

## 2. Mental model — what the simulator is doing

The simulator quantifies the **annual dollar value of deploying X MW of flexible load** in a specific utility's service territory, under a specific market regime, and structures a contract around that value.

It does this by comparing two cases:

| Case | What it represents |
|---|---|
| **Base Case** (constrained dispatch) | The world as it is today — congestion, redispatch, curtailment, CP-billed peak, etc. |
| **Constraint-Relieved Case** | The world after deploying X MW of dependable flex load, applied at the right node. |

The dollar **delta** between these two cases is the value to the utility. That value funds the contract, the rebate, and GridFlex's margin.

Two doctrines are non-negotiable:

1. **Production cost delta is the recurring annual benefit.** It captures redispatch savings, curtailment recovery, capacity-market revenue, CP avoidance, arbitrage, and reserves.
2. **Capital deferral is a separate structural overlay.** It's a one-time NPV from pushing out an infrastructure project. Never mix it into the production cost delta. Always present it as a labeled overlay with explicit assumptions.

The headline KPI **Total Value Stack** = Addressable Annual + Capital Deferral NPV. Treat the two as different things when negotiating.

---

## 3. Market type — pick this first

The market selector at the top of the screen drives **which value modules are active and which tabs are shown**. Pick before tuning anything else.

| Market | When to use | Active value streams |
|---|---|---|
| **RTO / ISO** | PJM, MISO, ERCOT, NYISO, CAISO, SPP | Redispatch + Curtailment + Capacity market + Arbitrage + Reserves + Capital deferral |
| **Vertically Integrated** | Southern Company, Duke, AEP, etc. (regulated utilities outside an RTO) | Redispatch + Reserves + Capital deferral |
| **EMC / Cooperative** | Distribution coops (Cobb EMC, Sawnee, etc.) | CP avoidance + Arbitrage + Capital deferral |

Each selection re-seeds the parameters with a sensible default for that market class. Your installed-MW, delivery-factor, and contract-structure inputs are preserved across switches.

> **Topology leverage is a transmission concept.** It applies to RTO and VI markets only. For EMC, the leverage parameter is forced to 1x — distribution coops earn value through CP coincidence at the load, not PTDF leverage on the bulk grid. The "Topology Leverage" tab is hidden for EMC.

---

## 4. Inputs — left-side modules

All inputs are sliders. Edits take effect instantly.

### Module 3 — Topology Leverage (PTDF)
*Visible for RTO + VI only.*

The single most important parameter for transmission-grid markets.

- **Topology Leverage Multiplier**: how many MW of redispatch are eliminated per 1 MW of dependable load shed at your target node. Driven by the PTDF ratio: `PTDF_load_node / PTDF_marginal_gen`.
- **Field reference**:
  - 1–2x: load is electrically distant from the constraint (generic DSM territory)
  - 2–5x: load is in the general constrained area (modest leverage)
  - 5–10x: load is at or near the high-voltage side of the binding interface (strong)
  - 10–20x: load sits directly on the highest-sensitivity node (max leverage)
- Validate against a PTDF matrix from a network model (PSS/E or similar) before claiming anything more than screening grade.

### Module 2 — Base Case (Constrained)
*Visible for RTO + VI only.*

Describes the constraint you're trying to relieve.

- **Redispatch Required to Relieve Constraint**: total MW of out-of-merit dispatch needed during binding events, with no flex load.
- **Binding Hours / Year**: how many hours per year the constraint actually binds.
- **Redispatch Price Differential**: $/MWh gap between the constrained generator (cheap, can't reach load) and the substitute generator (expensive, has to run). Validate from OASIS / RTO public data.
- **Total Zone Curtailment** (RTO only): annual curtailment in the zone (renewables typically).
- **Curtailment Attribution**: share of zone curtailment caused by *this specific* constraint. Engineering estimate at screening grade; firm up with constraint logs.
- **Curtailed Energy Value**: marginal $/MWh value of recovered energy.

### Module 2b — Capacity Market Revenue
*Visible for RTO only.*

- **Capacity Clearing Price**: $/MW-day (PJM BRA ~$200, MISO PRA ~$80).
- **Accreditation (ELCC)**: fraction of nameplate that counts toward capacity obligation. Typical: 50–70% for summer-peaking DR.

### Module 2c — Coincident Peak Avoidance
*Visible for EMC only — typically the largest single value lever for a coop.*

- **G&T Demand Charge**: $/kW-month billed by the G&T on the coop's coincident-peak determinant.
- **Transmission Charge**: NITS or bundled $/kW-month on the same CP determinant.
- **CP Coincidence Factor**: probability the flex load is online during the billed CP hour.

### Module 2d — Energy Arbitrage
*Visible for RTO + EMC.*

- **Peak vs Off-Peak Spread**: $/MWh price spread (LMP for RTO, wholesale purchase cost for EMC).
- **Arbitrageable Hours/Year**: hours per year where the spread is large enough to dispatch profitably. **Already a curated subset** — the model does not double-derate this by binding-hour overlap.

### Module 4 — Flex Load Intervention
*Visible for all markets.*

- **Installed Flexible Load**: MW of flex load at the target node. The scaling parameter.
- **Delivery Factor**: probability the load actually responds when called. **Derates ALL revenue streams that depend on dispatchable performance** (reserves, CP avoidance, arbitrage). Typical: 60–80%.
- **Coincidence Factor** *(RTO + VI only)*: fraction of binding hours where the flex is operational. Direction matters: night-shift load with no overlap = 0%; matched-shift with full availability = 100%. Drives redispatch + curtailment math only.
- **Curtailment Mitigation** *(RTO only)*: share of attributed curtailment recoverable per MW of relief.

### Module 5 — Dispatch Timing
Specifies the daily pre-cool / dispatch window. Visualizes the timeline. The "suggested coincidence factor" hint is derived from the window size:
- 1-hr window → 60%, 2-hr → 70%, 3-hr → 80%, 4-hr → 90%

If the slider's current setting is far from the suggested value, the panel flags it as conservative or aggressive vs. the window size.

### Module 6 — Capital Deferral
*Visible for all markets except where disabled.*

Structural overlay — kept separate from production cost delta per the Pilot-Grade Process.

- **Infrastructure Project Cost** (CapEx)
- **WACC**
- **Deferral Years**
- **MW Threshold for Full Deferral**: the MW of constraint relief (RTO/VI) or CP-coincident load reduction (EMC) required to push the project out by `Deferral Years`.

> **Realization scaling**: deferral is realized linearly with deployment up to the threshold. If you deploy half the MW threshold, you realize half the NPV. The panel shows the realization fraction live.

### Module 7 — Flex Load Incentive
The unit-level economics of installing flex load assets at a building.

- **Flex Load Unit Cost (installed)**: fully-loaded $ per unit.
- **Unit Electrical Capacity**: kW per unit. Drives the unit count for a given MW.
- **ITC Tax Credit**: 48E Clean Electricity ITC — typically 30–40%.
- **Utility Rebate**: % of unit cost. Funded from the avoided cost pool.
- **Diminishing Returns Threshold**: defines "Optimal MW" — the MW where marginal $/kW-yr drops below this % of peak marginal value. *(Rule active in saturating markets only — see §6.)*

### Module 8 — Contract Structure
Translates avoided cost into NWA contract economics.

- **Contract Term**: 3–10 years.
- **GridFlex Rate**: % of avoided cost that the utility pays GridFlex. Default 70% (utility keeps 30% as net savings).
- **Facility Incentive**: $/kW-yr bill credit GridFlex pays back to participating facilities.

### Module 9 — Operating Reserve Value
*Visible for RTO + VI only.*

- **Reserve-Eligible Fraction**: % of flex MW that qualifies as spinning/non-spinning reserve (response-time and telemetry gates).
- **Reserve Capacity Credit**: $/kW-yr. PJM reference: ~$4–8/kW-yr spinning, ~$2–4/kW-yr non-spinning.
- **Revenue is derated by Delivery factor** because failure-to-perform on a NERC ancillary product carries a penalty.

---

## 5. Reading the right side — outputs

### Top KPI row (5 boxes)

| Box | What it shows |
|---|---|
| **Effective Load Shed** | `MW_flex × Delivery × Coincidence` — dependable MW during binding hours. |
| **Annual Benefit (market-specific)** | RTO: PCD + Capacity. VI: Production Cost Delta only. EMC: CP Avoidance + Arbitrage. |
| **Total Value Stack** | All recurring annual streams + capital deferral NPV. **The headline number for utility conversations.** |
| **Capital Deferral (NPV)** | Realized one-time NPV (full × realization fraction). |
| **Optimal Deployment** | MW where marginal $/kW-yr drops below threshold (saturating markets) OR your current input (linear-value markets). |

### Tab — Topology Leverage *(RTO + VI)*

The flagship visual for utility conversations. Shows:

- **Side-by-side**: With targeting (PTDF leverage) vs. Without (generic DSM at 1:1). Same MW deployed, dramatically different value.
- **Leverage chart**: production cost delta vs. MW installed, with-leverage vs. no-leverage.
- **Field reference table**: what 1x, 5x, 10x, 20x leverage looks like physically.

This tab does NOT exist for EMC because PTDF leverage doesn't apply at distribution.

### Tab — Formula Chain

The audit trail. Every value stream's math is shown live with the inputs and result. Use this when a utility analyst wants to verify the calculation.

The formula chain is **market-aware**:

- **RTO**: full chain — redispatch + curtailment + capacity + arbitrage + reserves + cap deferral
- **VI**: redispatch + reserves + cap deferral (no curtailment, no capacity, no arb)
- **EMC**: CP avoidance + arbitrage + cap deferral (no redispatch chain shown, since all rows would be zero)

The aggregation rows distinguish:
- **Σ1 — Addressable annual**: recurring annual revenue (used for $/kW-yr and contract pricing)
- **Σ2 — Total value**: addressable + capital deferral one-time NPV

### Tab — Optimal MW

#### Saturating regime (RTO + VI)
The "diminishing returns" rule fires. Optimal MW = the MW where marginal $/kW-yr drops below `threshold_pct` (default 20%) of peak marginal. Below the optimal, deploying more produces strong marginal value; above it, you're paying full unit cost for diminishing return.

The chart shows:
- **Green area**: Addressable annual revenue vs. MW
- **Orange dashed line**: Total value stack (includes cap deferral)
- **Cyan line**: Marginal $/kW-yr (right axis)
- **Purple vertical line**: Optimal MW
- **Cyan dashed vertical**: MW to fully relieve constraint
- **Red horizontal**: marginal cutoff

The MW Decision Table below tags each MW row as `OPTIMAL`, `DEPLOY` (above cutoff), `DIMINISHING` (below cutoff), or `SATURATED` (constraint fully relieved).

#### Linear-value regime (EMC)
For markets where marginal value is constant in MW (CP + arb), there's no diminishing-returns optimum. The simulator detects this automatically. The "Optimal MW" then equals your current `mw_flex` input — treat it as your planned pilot or program size, deployment-economics constrained, not value-curve constrained.

A purple banner at the top of the tab makes this regime explicit.

### Tab — Incentive Model

Shows the unit-level economics at the optimal MW:
- Units required, gross install cost, ITC credit, utility rebate, net cost to owner
- 8-year utility value pool (the funding source for the rebate)
- Self-financing logic in 5 narrated steps

This tab is what you show building owners to explain why deploying flex load makes sense for them.

### Tab — Contract Structure

NWA contract economics derived from the optimal MW:
- **Utility Avoided Cost** ($/kW-yr): the utility's recurring savings per kW
- **GridFlex Contract Rate** ($/kW-yr): what the utility pays GridFlex (default 70% of avoided cost)
- **Utility Net Savings** ($/kW-yr): what the utility keeps

A **RIM Test panel** explains why the program passes the Ratepayer Impact Measure — critical framing for Georgia PSC and similar regulatory environments.

The payment-flow diagram makes the money movement explicit:
**Utility → GridFlex → Facilities** (single contract, single utility invoice, downstream facility administration).

### Tab — Assumptions

The 6-to-8 most important assumptions plus what would break each. Use this to triage which assumptions need data validation before a utility presentation.

---

## 6. The "GENERATE ONE-PAGER" button

Top-right of the header. Type a utility/client name (optional) and click. Opens a print-ready HTML one-pager in a new tab — branded, market-aware (different sections shown for RTO vs. VI vs. EMC), with:

- The constraint exposure ("what it's costing you today")
- The topology-leverage approach (or CP coincidence framing for EMC)
- Dispatch protocol with timeline
- Full value stack table
- Proof-of-concept proposal (auto-sized at ~15% of full-relief MW, capped at 2 MW for pilot)
- Contract structure summary
- Assumptions and validation notes

The one-pager is what you hand to a utility VP after a 30-minute meeting.

---

## 7. Worked example — RTO default

Default RTO settings produce these numbers (sanity check — your math should match):

- `mw_flex = 10`, `delivery = 0.7`, `coincidence = 0.8`, `topology_leverage = 5`
- `mw_redisp = 100`, `h_bind = 320`, `price_diff = $55`
- `mwh_curt = 45,000`, `curt_attrib = 0.35`, `curt_mwh_value = $48`, `curt_mitigation = 0.45`

**Step-by-step:**

| Quantity | Calculation | Result |
|---|---|---|
| MW_effective | 10 × 0.7 × 0.8 | 5.6 MW |
| MW_redisp_equivalent | 5.6 × 5 | 28 MW |
| Reduction_fraction | min(1, 28/100) | 28% |
| E_redisp_base | 100 × 320 | 32,000 MWh |
| E_redisp_saved | 32,000 × 0.28 | 8,960 MWh |
| Redispatch value | 8,960 × $55 | $492,800 |
| Curtailment recovered | 45,000 × 0.35 × 0.45 × 0.28 | 1,985 MWh |
| Curtailment value | 1,985 × $48 | $95,256 |
| **Production cost delta** | **redisp + curt** | **$588,056** |
| Capacity revenue | 10 × $180 × 365 × 0.60 | $394,200 |
| Arbitrage | 10 × 0.7 × $40 × 500 | $140,000 |
| Reserves | 10,000 × 0.7 × 0.80 × $8 | $44,800 |
| **Addressable annual** | sum | **$1,167,056** |
| Cap deferral full | $28M × (1 − 1/1.075³) | $5,516,000 |
| Cap deferral realized | $5,516,000 × 0.28 | $1,544,480 |
| **Total Value Stack** | addressable + cap deferral | **$2,711,536** |

If you deploy at the MW that fully relieves the constraint (~36 MW), reduction_fraction → 100%, redispatch saturates, and total value stack peaks around $11M/yr.

---

## 8. Worked example — EMC default

Default EMC settings:

- `mw_flex = 10`, `delivery = 0.7`, `cp_coincidence = 0.8`
- `cp_charge = $5/kW-mo`, `trans_charge = $3/kW-mo`
- `arb_spread = $20/MWh`, `arb_hours = 400`
- `capex = $12M`, `wacc = 5.5%`, `years_deferral = 3`, `mw_deferral_threshold = 15`

| Quantity | Calculation | Result |
|---|---|---|
| CP avoidance | 10,000 × 0.7 × 0.8 × ($5+$3) × 12 | $537,600 |
| Arbitrage | 10 × 0.7 × $20 × 400 | $56,000 |
| **Addressable annual** | sum | **$593,600** |
| Cap deferral full | $12M × (1 − 1/1.055³) | $1,780,800 |
| CP-coincident relief MW | 10 × 0.7 × 0.8 | 5.6 MW |
| Deferral realization | min(1, 5.6/15) | 37.3% |
| Cap deferral realized | $1,780,800 × 0.373 | $664,238 |
| **Total Value Stack** | addressable + realized cap deferral | **$1,257,838** |

Marginal $/kW-yr is constant (linear regime), so optimal MW = your input.

---

## 9. Common workflow — utility pitch in 60 seconds

1. **Pick the market type** at the top.
2. **Tune Module 2 (Base Case)** to reflect the utility's actual constraint. Use OASIS, RTO public data, or the utility's IRP for `h_bind`, `mw_redisp`, `price_diff`. For EMC, get the actual G&T demand charge and CP coincidence from a recent bill.
3. **Set Topology Leverage** *(RTO/VI only)* based on the target node — start conservative (3–5x) unless you have PTDF data.
4. **Adjust Module 4** — set `mw_flex` to a defensible pilot size; tune `delivery` and `coincidence` to credible bounds.
5. **Set Module 6 (Capital Deferral)** with the utility's actual planned project ($, WACC from their IRP, years from their capital plan, MW threshold from their planning study).
6. **Read the Top KPI row** — that's your headline.
7. **Switch to the "Topology Leverage" tab** — show the side-by-side and the chart. Frame: *"Same MW deployed, different value because location matters."*
8. **Switch to "Optimal MW"** — show the marginal-value curve and the diminishing returns point.
9. **Switch to "Contract Structure"** — show the RIM-test framing and the payment-flow diagram.
10. **Click "GENERATE ONE-PAGER"** — leave it with them.

---

## 10. What's known to be approximate

These are the screening-grade simplifications baked into the model. State them explicitly when presenting:

| Simplification | What's missing | When it matters |
|---|---|---|
| Topology leverage as a single multiplier | Real PTDFs are direction-specific and depend on dispatch state | Validate against PSS/E/network model before firm commitments |
| Linear scaling of redispatch / curtailment savings with reduction fraction | Real network response can be nonlinear, especially near the constraint boundary | Most relevant for >70% reduction fraction |
| Capital deferral as linear-with-MW realization | Real deferral is often binary — project moves or it doesn't | Most relevant when proposing partial deployments |
| `coincidence_factor` and `cp_coincidence` are operator-set point estimates | Real distributions vary by season, weather, building behavior | Validate with metered data in pilot phase |
| Arbitrage hours assumed independent of binding hours | In practice, they overlap (binding hours often coincide with peak hours) — modeling them separately may double-count value if not careful | Audit when both arbitrage and redispatch streams are large |
| Reserves revenue using delivery-derated MW | Real markets bid + clear on nameplate; penalty exposure is treated separately | Conservative — defensible to a utility |

---

## 11. File map

- [`src/GridFlexSim.jsx`](src/GridFlexSim.jsx) — single-file React app, ~1,750 lines. All inputs, math, charts, tabs, and one-pager generator live here.
- [`src/App.js`](src/App.js) — entry point.
- [`SIMULATION_GUIDE.md`](SIMULATION_GUIDE.md) — this document.
- [`../../power-flow-model/Pilot_Grade_Process.md`](../../power-flow-model/Pilot_Grade_Process.md) — methodology source-of-truth.
- [`../../business-materials/Formulas_Meanings.md`](../../business-materials/Formulas_Meanings.md) — formula reference.

---

## 12. Changelog vs. previous version

The 2026-05-07 audit corrected several math errors. If you're comparing to numbers generated before that date:

- **Reserves**: now derated by Delivery factor (was nameplate × eligible × rate). Lower revenue.
- **CP avoidance**: now derated by Delivery factor (was nameplate × CP coincidence × rate). Lower revenue.
- **Energy arbitrage**: now uses Delivery factor only, dropped Coincidence factor (was double-derating with constraint coincidence). Slightly different revenue, more accurate.
- **Capital deferral**: now scaled by realization fraction (was full NPV at any MW). Much lower at small deployments — correct per Pilot-Grade Process Step 6.
- **Optimal MW for EMC**: now anchors to user input in linear-value regime (was silently selecting sweep ceiling).
- **Topology leverage for EMC**: now forced to 1x (was inheriting RTO's 5x default). Tab hidden for EMC.
- **Coincidence Factor direction**: clarified as *fraction of binding hours where flex is operational*, not the reverse.
- **Formula chain tab**: now market-aware — shows only the applicable streams. Total_value formula corrected to include all six streams.
