import { useState, useMemo } from "react";
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, BarChart, Bar, Cell,
  ComposedChart, Area,
} from "recharts";

// ── Market types ──────────────────────────────────────────────────────────────

const MARKET_TYPES = {
  rto:  { key: "rto",  label: "RTO / ISO",            accent: "#2563eb" },
  vi:   { key: "vi",   label: "Vertically Integrated", accent: "#7c3aed" },
  emc:  { key: "emc",  label: "EMC / Cooperative",    accent: "#16a34a" },
};

// Which modules & tabs are relevant for each market. Modules not in the list
// are hidden in the UI and their value contribution is zeroed in runModel.
const MARKET_MODULES = {
  rto: {
    redispatch:  true,
    curtailment: true,
    capacity:    true,
    cp_avoid:    false,
    reserves:    true,
    arbitrage:   true,
    cap_defer:   true,
    tabs: ["leverage", "formulas", "optimal", "incentive", "contract", "assumptions"],
  },
  vi: {
    redispatch:  true,
    curtailment: false,  // SE VI utilities have near-zero renewable curtailment
    capacity:    false,
    cp_avoid:    false,
    reserves:    true,
    arbitrage:   false,  // no organized market exposing hourly arb opportunity
    cap_defer:   true,   // headline value for VI utilities
    tabs: ["leverage", "formulas", "optimal", "incentive", "contract", "assumptions"],
  },
  emc: {
    redispatch:  false,  // framed as CP avoidance, not redispatch
    curtailment: false,
    capacity:    false,
    cp_avoid:    true,   // headline value for cooperatives
    reserves:    false,  // G&T holds reserves, not the distribution coop
    arbitrage:   true,   // wholesale purchase cost varies by hour
    cap_defer:   true,
    // No "leverage" tab for EMC — PTDF leverage is a transmission concept,
    // not applicable at distribution. Value chain shown in formulas tab.
    tabs: ["formulas", "optimal", "incentive", "contract", "assumptions"],
  },
};

// Per-market default parameter values. Changing the market-type selector
// re-seeds p with the corresponding preset so the sim opens in a sensible
// configuration for that utility class without manual slider tuning.
const MARKET_PRESETS = {
  rto: {
    // Redispatch — enter utility constraint data to unlock value
    h_bind: 0, mw_redisp: 0, price_diff: 0,
    mwh_curt: 0, curt_attrib: 0.0, curt_mwh_value: 0,
    // Topology leverage — PTDF-driven, transmission-grid concept
    topology_leverage: 5,
    // Capacity market — enter clearing price + accreditation when known
    capacity_price_mw_day: 0, capacity_accreditation: 0.0,
    // CP avoidance — not applicable in RTO
    cp_charge_kw_month: 0, trans_charge_kw_month: 0,
    cp_events_per_year: 12, cp_coincidence: 0.0,
    // Energy arbitrage — enter LMP spread when known
    arb_spread_mwh: 0, arb_hours_per_year: 0,
    // Reserves — enter eligible fraction + rate when known
    reserve_eligible_pct: 0.0, reserve_rate_kw_yr: 0,
    // Capital deferral — structural inputs; realization scales with constraint relief
    capex: 28000000, wacc: 0.075, years_deferral: 3,
    mw_deferral_threshold: 100,
  },
  vi: {
    // Internal redispatch — enter utility constraint data to unlock value
    h_bind: 0, mw_redisp: 0, price_diff: 0,
    mwh_curt: 0, curt_attrib: 0.0, curt_mwh_value: 0,
    topology_leverage: 4,
    // No capacity market
    capacity_price_mw_day: 0, capacity_accreditation: 0.0,
    cp_charge_kw_month: 0, trans_charge_kw_month: 0,
    cp_events_per_year: 12, cp_coincidence: 0.0,
    // No hourly market to arb against
    arb_spread_mwh: 0, arb_hours_per_year: 0,
    // Reserves — enter eligible fraction + rate when known
    reserve_eligible_pct: 0.0, reserve_rate_kw_yr: 0,
    // Capital deferral — VI utilities have the largest projects
    capex: 50000000, wacc: 0.075, years_deferral: 4,
    mw_deferral_threshold: 60,
  },
  emc: {
    // EMC does not "redispatch" — CP avoidance is the headline value stream
    h_bind: 0, mw_redisp: 0, price_diff: 0,
    mwh_curt: 0, curt_attrib: 0.0, curt_mwh_value: 0,
    // Topology leverage = 1: distribution coops have no PTDF leverage
    topology_leverage: 1,
    capacity_price_mw_day: 0, capacity_accreditation: 0.0,
    // CP avoidance — enter from G&T wholesale rate schedule when known
    // Southeast reference: OPC G&T demand ~$5-6/kW-mo, GTC NITS ~$2-4/kW-mo
    cp_charge_kw_month: 0.0, trans_charge_kw_month: 0.0,
    cp_events_per_year: 12, cp_coincidence: 0.0,
    // Wholesale purchase arbitrage — toggleable, off by default for EMC
    arb_spread_mwh: 0, arb_hours_per_year: 0,
    // No reserves at distribution coop level
    reserve_eligible_pct: 0.0, reserve_rate_kw_yr: 0,
    // Capital deferral (distribution substations / feeders) — toggleable
    capex: 20000000, wacc: 0.055, years_deferral: 5,
    // MW of CP-coincident peak reduction needed to push out the upgrade
    mw_deferral_threshold: 5,
    // BESS is high-reliability once commissioned
    delivery_factor: 0.95,
    // EMC BESS site sizing
    site_kw: 500,
    duration_hours: 2,
    bess_cost_kwh: 350,
    site_soft_cost: 50000,
    // Contract structure — NWA + BTM dual revenue
    gridflex_rate_pct: 0.60,
    facility_demand_rate_kw_month: 0,
    gridflex_btm_share_pct: 0.80,
    facility_upfront_pct: 0,
    service_fee_kw_yr: 25,
    debt_rate_pct: 0.08,
    debt_term_years: 10,
  },
};

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  // Market-type + preset-driven value-stack fields (all markets seed these;
  // value-driving params start at 0 so outputs show $0 until user enters data)
  ...MARKET_PRESETS.rto,
  // Module 3 — Topology Leverage
  topology_leverage: 5,
  // Module 4 — Intervention
  mw_flex: 10,
  delivery_factor: 0.70,
  coincidence_factor: 0.80,
  curt_mitigation: 0.45,
  // Module 7 — Flex Load / BESS Site Incentive
  hvac_unit_cost: 45000,  // RTO/VI: cost per flex load unit
  hvac_unit_kw: 15,       // RTO/VI: kW per unit
  site_kw: 500,           // EMC: kW capacity per enrolled BESS site
  duration_hours: 2,      // EMC: storage duration (2h or 4h)
  bess_cost_kwh: 350,     // EMC: $/kWh installed hardware
  site_soft_cost: 50000,  // EMC: flat per-site soft costs (permitting, engineering)
  itc_pct: 0.30,
  utility_incentive_pct: 0.20,
  // Optimal MW threshold
  threshold_pct: 20,
  // Module 5 — Dispatch Timing (RTO/VI only — hidden for EMC)
  forecast_peak_hour: 15,
  window_hours: 2,
  // Module 8 — Contract Structure (RTO/VI)
  contract_years: 5,
  gridflex_rate_pct: 0.70,
  facility_incentive_kw_yr: 50,
  mw_deferral_threshold: 100,
  // Module 8 — EMC Dual-Revenue Contract
  facility_demand_rate_kw_month: 0,  // $/kW-month on facility's EMC bill
  gridflex_btm_share_pct: 0.80,      // GridFlex share of BTM demand savings
  facility_upfront_pct: 0,           // % of gross capex facility contributes
  service_fee_kw_yr: 25,             // $/kW-yr management/dispatch/M&V fee
  debt_rate_pct: 0.08,               // annual interest rate on GridFlex-held debt
  debt_term_years: 10,               // loan term (years)
  // Module overrides — per-session toggle state
  module_overrides: {},
};

// ── Model ─────────────────────────────────────────────────────────────────────

function runModel(p) {
  const baseMods = MARKET_MODULES[p.market || "rto"] || MARKET_MODULES.rto;
  const mods = p.module_overrides ? { ...baseMods, ...p.module_overrides } : baseMods;

  // ── Dependable MW + leverage (constraint relief framing) ────────────────
  // mw_effective = MW available *during* binding hours.
  // coincidence_factor = fraction of binding hours where flex is operational.
  // (Direction matters: it's binding-hours-with-flex / binding-hours, not
  // flex-hours-overlapping-binding / flex-hours.)
  const mw_effective = p.mw_flex * p.delivery_factor * p.coincidence_factor;
  const mw_redisp_equivalent = mw_effective * p.topology_leverage;
  const reduction_fraction = p.mw_redisp > 0
    ? Math.min(mw_redisp_equivalent / p.mw_redisp, 1.0)
    : 0;
  const leverageDenom = p.topology_leverage * p.delivery_factor * p.coincidence_factor;
  const mw_to_fully_relieve = leverageDenom > 0 && p.mw_redisp > 0
    ? p.mw_redisp / leverageDenom
    : 0;

  // ── Production cost delta (redispatch + curtailment, RTO + VI only) ─────
  const e_redisp_base = p.mw_redisp * p.h_bind;
  const e_redisp_saved = e_redisp_base * reduction_fraction;
  const redispatch_value = mods.redispatch ? e_redisp_saved * p.price_diff : 0;

  const curtailment_attrib = p.mwh_curt * p.curt_attrib;
  const curtailment_recovered = curtailment_attrib * p.curt_mitigation * reduction_fraction;
  const curtailment_value = mods.curtailment ? curtailment_recovered * p.curt_mwh_value : 0;

  const production_cost_delta = redispatch_value + curtailment_value;

  // ── Reserves — derate by delivery factor. NERC ancillary products carry
  // non-performance penalty, so revenue applies to dependable MW, not nameplate.
  const reserve_value = mods.reserves
    ? p.mw_flex * 1000 * (p.delivery_factor || 1)
        * (p.reserve_eligible_pct || 0) * (p.reserve_rate_kw_yr || 0)
    : 0;

  // ── Capacity market — ELCC accreditation already encodes resource adequacy
  // contribution; do not double-derate by delivery. Penalty exposure is a
  // separate risk overlay (not in revenue model).
  const capacity_market_value = mods.capacity
    ? p.mw_flex * (p.capacity_price_mw_day || 0) * 365 * (p.capacity_accreditation || 0)
    : 0;

  // ── Coincident-peak avoidance (EMC) — derate by delivery factor. If the
  // load fails to be online during the billed CP hour, no avoidance is
  // realized for that month.
  const cp_avoidance_value = mods.cp_avoid
    ? p.mw_flex * 1000 * (p.delivery_factor || 1) * (p.cp_coincidence || 0)
        * ((p.cp_charge_kw_month || 0) + (p.trans_charge_kw_month || 0))
        * 12
    : 0;

  // ── Energy arbitrage — for BESS (EMC), a 4h system shifts 2× the MWh per
  // dispatch cycle vs. a 2h system. Scale by duration_hours/2 so duration
  // choice shows up in value, not just cost. RTO/VI (non-BESS) = no scaling.
  const arb_duration_scale = (p.market === "emc") ? ((p.duration_hours || 2) / 2) : 1;
  const arbitrage_value = mods.arbitrage
    ? p.mw_flex * (p.delivery_factor || 1) * (p.arb_spread_mwh || 0) * (p.arb_hours_per_year || 0) * arb_duration_scale
    : 0;

  // ── Capital deferral — structural overlay, scaled by deployment realization.
  // RTO/VI: realization = constraint relief fraction (the project gets
  // deferred when the constraint that drove it is relieved).
  // EMC: realization scales with CP-coincident MW vs. a deployment threshold
  // (the load reduction needed to push out the distribution upgrade).
  const cp_relief_mw = p.mw_flex * (p.delivery_factor || 1) * (p.cp_coincidence || 0);
  const deferral_threshold = Math.max(p.mw_deferral_threshold || 1, 1);
  const deferral_realized = mods.redispatch
    ? reduction_fraction
    : mods.cp_avoid
      ? Math.min(1, cp_relief_mw / deferral_threshold)
      : 0;
  const capital_deferral_full = mods.cap_defer
    ? p.capex * (1 - 1 / Math.pow(1 + p.wacc, p.years_deferral))
    : 0;
  const capital_deferral_value = capital_deferral_full * deferral_realized;

  // ── Aggregations ─────────────────────────────────────────────────────────
  const total_value =
    production_cost_delta
    + capital_deferral_value
    + reserve_value
    + capacity_market_value
    + cp_avoidance_value
    + arbitrage_value;

  // addressable_annual = recurring annual revenue (excludes one-time capital
  // deferral NPV). Used for $/kW-yr and contract pricing.
  const addressable_annual =
    production_cost_delta + reserve_value + capacity_market_value
    + cp_avoidance_value + arbitrage_value;
  const dollars_per_kw_yr =
    p.mw_flex > 0 ? addressable_annual / (p.mw_flex * 1000) : 0;

  const mw_redisp_avoided = Math.min(mw_redisp_equivalent, p.mw_redisp);
  const leverage_ratio_realized = mw_effective > 0
    ? mw_redisp_avoided / mw_effective
    : 0;

  return {
    mw_effective,
    mw_redisp_equivalent,
    mw_to_fully_relieve,
    reduction_fraction,
    e_redisp_base,
    e_redisp_saved,
    redispatch_value,
    curtailment_attrib,
    curtailment_recovered,
    curtailment_value,
    production_cost_delta,
    capital_deferral_full,
    capital_deferral_value,
    deferral_realized,
    reserve_value,
    capacity_market_value,
    cp_avoidance_value,
    arbitrage_value,
    addressable_annual,
    total_value,
    dollars_per_kw_yr,
    mw_redisp_avoided,
    leverage_ratio_realized,
  };
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

function computeSweep(p) {
  const r0 = runModel(p);
  const maxMW = Math.max(30, Math.ceil(r0.mw_to_fully_relieve * 2.5));
  const pts = [];
  for (let mw = 1; mw <= maxMW; mw += 1) pts.push(mw);

  return pts.map((mw, i) => {
    const r = runModel({ ...p, mw_flex: mw });
    let marginal_per_kw = 0;
    if (i === 0) {
      marginal_per_kw = r.dollars_per_kw_yr;
    } else {
      const prevMW = pts[i - 1];
      const prevR = runModel({ ...p, mw_flex: prevMW });
      const delta_kw = (mw - prevMW) * 1000;
      // Use full addressable revenue (production cost delta + capacity + CP
      // avoidance + arbitrage + reserves) so the marginal calc works for any
      // market type. Using only production_cost_delta would zero out for EMC
      // and ignore capacity-market marginal value for RTO.
      const delta_val = r.addressable_annual - prevR.addressable_annual;
      marginal_per_kw = delta_kw > 0 ? delta_val / delta_kw : 0;
    }
    return {
      mw,
      production_cost_delta: r.production_cost_delta,
      addressable_annual: r.addressable_annual,
      total_value: r.total_value,
      dollars_per_kw_yr: r.dollars_per_kw_yr,
      marginal_per_kw: Math.max(0, marginal_per_kw),
      reduction_fraction: r.reduction_fraction,
      mw_redisp_equivalent: r.mw_redisp_equivalent,
    };
  });
}

function findOptimal(sweep, threshold_pct, mwFlexInput) {
  if (!sweep.length) return null;
  const peakMarginal = sweep[0].marginal_per_kw;
  const lastMarginal = sweep[sweep.length - 1].marginal_per_kw;

  // Detect linear-value regime: marginal $/kW-yr stays roughly flat across
  // the sweep. Happens for markets without a saturation mechanism (EMC: CP
  // avoidance + arbitrage are linear in MW). In that case the threshold rule
  // silently selects the sweep ceiling, which is misleading. Instead: anchor
  // optimal to the user's current deployment input (deployment-economics
  // limited, not value-limited).
  const linearTol = 0.05;
  const isLinear = peakMarginal > 0
    && Math.abs(lastMarginal - peakMarginal) / peakMarginal < linearTol;
  if (isLinear) {
    const target = Math.max(1, Math.round(mwFlexInput || sweep[0].mw));
    const matched = sweep.find((s) => s.mw === target) || sweep[Math.min(sweep.length - 1, target - 1)] || sweep[0];
    return {
      ...matched,
      cutoff_value: peakMarginal,
      peak_marginal: peakMarginal,
      regime: "linear_value",
    };
  }

  const cutoff = peakMarginal * (threshold_pct / 100);
  let optimal = sweep[0];
  for (let i = 1; i < sweep.length; i++) {
    if (sweep[i].marginal_per_kw >= cutoff) optimal = sweep[i];
    else break;
  }
  return { ...optimal, cutoff_value: cutoff, peak_marginal: peakMarginal, regime: "saturating" };
}

// ── Leverage comparison ───────────────────────────────────────────────────────

function buildLeverageComparison(p) {
  const r0 = runModel(p);
  const maxMW = Math.max(30, Math.ceil(r0.mw_to_fully_relieve * 2.5));
  const pts = [];
  for (let mw = 1; mw <= maxMW; mw += 2) pts.push(mw);

  return pts.map((mw) => {
    const withLeverage = runModel({ ...p, mw_flex: mw });
    const noLeverage = runModel({ ...p, mw_flex: mw, topology_leverage: 1 });
    return {
      mw,
      with_leverage: withLeverage.production_cost_delta,
      no_leverage: noLeverage.production_cost_delta,
      redisp_equivalent: Math.min(withLeverage.mw_redisp_equivalent, p.mw_redisp),
    };
  });
}

// ── Incentive ─────────────────────────────────────────────────────────────────

function computeIncentiveData(p, sweep) {
  const isEmc = p.market === "emc";
  return sweep.map((s) => {
    let units, gross, itc, rebate, net;
    if (isEmc) {
      const siteKw = p.site_kw || 500;
      const siteKwh = siteKw * (p.duration_hours || 2);
      const siteCost = siteKwh * (p.bess_cost_kwh || 350) + (p.site_soft_cost || 50000);
      units = siteKw > 0 ? Math.max(1, Math.ceil((s.mw * 1000) / siteKw)) : 1;
      gross = units * siteCost;
      itc = gross * (p.itc_pct || 0);
      rebate = 0;
      net = gross - itc;
    } else {
      units = p.hvac_unit_kw > 0 ? Math.max(1, Math.ceil((s.mw * 1000) / p.hvac_unit_kw)) : 1;
      gross = units * p.hvac_unit_cost;
      itc = gross * p.itc_pct;
      rebate = gross * p.utility_incentive_pct;
      net = gross - itc - rebate;
    }
    const pool = s.addressable_annual * p.contract_years;
    return { mw: s.mw, units, gross, itc, rebate, net, pool };
  });
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtD(v) {
  if (v >= 1000000) return "$" + (v / 1000000).toFixed(2) + "M";
  if (v >= 1000) return "$" + (v / 1000).toFixed(0) + "K";
  return "$" + Math.round(v);
}
function fmtMWh(v) {
  return v >= 1000 ? (v / 1000).toFixed(1) + "K MWh" : Math.round(v) + " MWh";
}
function fmtPct(v) { return (v * 100).toFixed(0) + "%"; }
function fmtHour(h) {
  const h24 = ((Math.round(h) % 24) + 24) % 24;
  if (h24 === 0) return "12 AM";
  if (h24 < 12) return h24 + " AM";
  if (h24 === 12) return "12 PM";
  return (h24 - 12) + " PM";
}

// ── UI Components ─────────────────────────────────────────────────────────────

function Panel({ title, accent, children, badge, toggleable, enabled, onToggle }) {
  const isOff = toggleable && enabled === false;
  return (
    <div style={{ background: "#0b1520", border: "1px solid #0f1c2a", borderTop: "2px solid " + (isOff ? "#1e3a5a" : (accent || "#1e3a5a")), borderRadius: 8, padding: "16px 18px", marginBottom: 16, opacity: isOff ? 0.45 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isOff ? 0 : 12, paddingBottom: isOff ? 0 : 10, borderBottom: isOff ? "none" : "1px solid #0f1c2a" }}>
        <div style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: "0.12em", color: isOff ? "#2d4a63" : (accent || "#3b82f6"), textTransform: "uppercase" }}>{title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {badge && !isOff && <div style={{ fontSize: 9, fontFamily: "monospace", color: badge.color, background: badge.color + "18", border: "1px solid " + badge.color + "44", borderRadius: 3, padding: "2px 7px" }}>{badge.text}</div>}
          {toggleable && (
            <button onClick={onToggle} style={{
              fontSize: 9, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.1em",
              background: isOff ? "#0a111a" : (accent || "#3b82f6") + "25",
              border: "1px solid " + (isOff ? "#1e3a5a" : (accent || "#3b82f6") + "55"),
              color: isOff ? "#3d5068" : (accent || "#3b82f6"),
              borderRadius: 3, padding: "3px 9px", cursor: "pointer",
            }}>{isOff ? "OFF" : "ON"}</button>
          )}
        </div>
      </div>
      {!isOff && children}
    </div>
  );
}

function Slider({ label, value, display, onChange, min, max, step, note, highlight }) {
  return (
    <div style={{ marginBottom: 12, background: highlight ? "#06b6d408" : "transparent", borderRadius: 4, padding: highlight ? "6px 8px" : "0", border: highlight ? "1px solid #06b6d420" : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: highlight ? "#06b6d4" : "#7a90a8", fontFamily: "monospace" }}>{label}{highlight && " ★"}</span>
        <span style={{ fontSize: 12, color: "#e2e8f0", fontFamily: "monospace", fontWeight: 700 }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: highlight ? "#06b6d4" : "#3b82f6", cursor: "pointer" }} />
      {note && <div style={{ fontSize: 10, color: "#3d5068", marginTop: 2, fontFamily: "monospace" }}>{note}</div>}
    </div>
  );
}

function FRow({ num, formula, inputs, result, color, highlight }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "22px 1fr auto", gap: 10, padding: "8px 6px", borderBottom: "1px solid #0a1520", alignItems: "start", background: highlight ? color + "08" : "transparent", borderRadius: highlight ? 4 : 0 }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: color + "25", border: "1px solid " + color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color, fontFamily: "monospace", fontWeight: 700, flexShrink: 0 }}>{num}</div>
      <div>
        <div style={{ fontSize: 11, color: highlight ? "#e2e8f0" : "#cbd5e1", fontFamily: "monospace", marginBottom: 1, fontWeight: highlight ? 700 : 400 }}>{formula}</div>
        <div style={{ fontSize: 10, color: "#3d5068", fontFamily: "monospace" }}>{inputs}</div>
      </div>
      <div style={{ fontSize: 12, color, fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap" }}>{result}</div>
    </div>
  );
}

function MBox({ label, value, sub, color, tag }) {
  return (
    <div style={{ background: "#070d14", border: "1px solid " + color + "28", borderLeft: "3px solid " + color, borderRadius: 6, padding: "11px 13px" }}>
      <div style={{ fontSize: 9, color: "#2d4a63", fontFamily: "monospace", letterSpacing: "0.09em", marginBottom: 3 }}>{tag}</div>
      <div style={{ fontSize: 18, fontFamily: "monospace", color, fontWeight: 700, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#7a90a8" }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "#3d5068", fontFamily: "monospace", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const TAB = (active, accent) => ({
  background: active ? "#0b1520" : "transparent",
  border: "1px solid " + (active ? "#1e3a5a" : "transparent"),
  borderBottom: active ? "2px solid " + accent : "2px solid transparent",
  color: active ? "#e2e8f0" : "#4a6080",
  fontFamily: "monospace", fontSize: 11, padding: "6px 13px",
  cursor: "pointer", borderRadius: "4px 4px 0 0",
  letterSpacing: "0.05em", textTransform: "uppercase",
});

// ── Main ──────────────────────────────────────────────────────────────────────

export default function GridFlexSim() {
  const [market, setMarketRaw] = useState("rto");
  const [p, setP] = useState({ ...DEFAULTS, market: "rto" });
  const [tab, setTab] = useState("leverage");
  const [utilityName, setUtilityName] = useState("");
  const set = (k) => (v) => setP((prev) => ({ ...prev, [k]: v }));

  // Changing the market type re-seeds the market-specific parameters with
  // that market's preset while preserving user-set fields that are market-
  // independent (mw_flex, delivery_factor, contract_years, etc.). This lets
  // the user toggle between pitches without losing their flex-load config.
  const setMarket = (m) => {
    setMarketRaw(m);
    setP((prev) => ({ ...prev, ...MARKET_PRESETS[m], market: m, module_overrides: {} }));
    const allowedTabs = MARKET_MODULES[m].tabs;
    if (!allowedTabs.includes(tab)) setTab(allowedTabs[0]);
  };
  const baseMods = MARKET_MODULES[market] || MARKET_MODULES.rto;
  const mods = p.module_overrides ? { ...baseMods, ...p.module_overrides } : baseMods;
  const toggleModule = (key) => setP((prev) => ({
    ...prev,
    module_overrides: { ...(prev.module_overrides || {}), [key]: !mods[key] },
  }));
  const marketMeta = MARKET_TYPES[market] || MARKET_TYPES.rto;

  const r = useMemo(() => runModel(p), [p]);
  const sweep = useMemo(() => computeSweep(p), [p]);
  const optimal = useMemo(() => findOptimal(sweep, p.threshold_pct, p.mw_flex), [sweep, p.threshold_pct, p.mw_flex]);
  const levComp = useMemo(() => buildLeverageComparison(p), [p]);
  const incentiveData = useMemo(() => computeIncentiveData(p, sweep), [p, sweep]);

  const sweepChart = useMemo(() =>
    sweep.filter((s) => s.mw % 2 === 0 || s.mw === 1 || (optimal && s.mw === optimal.mw)),
    [sweep, optimal]
  );
  const incentiveChart = useMemo(() =>
    incentiveData.filter((s) => s.mw % 5 === 0 || s.mw === 1),
    [incentiveData]
  );
  const optIncentive = useMemo(() =>
    optimal ? (incentiveData.find((d) => d.mw === optimal.mw) || incentiveData[0]) : incentiveData[0],
    [incentiveData, optimal]
  );

  const contract = useMemo(() => {
    if (!optimal) return null;
    const optMW_kw = optimal.mw * 1000;
    const avoided_kw_yr = optimal.dollars_per_kw_yr;
    const gridflex_rate_kw_yr = avoided_kw_yr * p.gridflex_rate_pct;
    const utility_net_kw_yr = avoided_kw_yr - gridflex_rate_kw_yr;
    const utility_net_annual = optMW_kw * utility_net_kw_yr;
    const rim_pass = gridflex_rate_kw_yr < avoided_kw_yr;
    const nwa_annual = optMW_kw * gridflex_rate_kw_yr;

    if (market === "emc") {
      // ── BTM demand charge savings at the facility ──────────────────────────
      const btm_savings_annual = optMW_kw * (p.delivery_factor || 0.95)
        * (p.facility_demand_rate_kw_month || 0) * 12;
      const gridflex_btm_revenue = btm_savings_annual * (p.gridflex_btm_share_pct || 0.80);
      const facility_btm_savings = btm_savings_annual - gridflex_btm_revenue;

      // ── Service / management fee ───────────────────────────────────────────
      const service_fee_annual = optMW_kw * (p.service_fee_kw_yr || 0);

      // ── Total GridFlex annual revenue ──────────────────────────────────────
      const total_gf_revenue_annual = nwa_annual + gridflex_btm_revenue + service_fee_annual;

      // ── Capital structure ──────────────────────────────────────────────────
      const sites = Math.ceil(optimal.mw * 1000 / (p.site_kw || 500));
      const siteKwh = (p.site_kw || 500) * (p.duration_hours || 2);
      const site_cost = siteKwh * (p.bess_cost_kwh || 350) + (p.site_soft_cost || 50000);
      const gross_capex = sites * site_cost;
      const itc_credit = gross_capex * (p.itc_pct || 0.30);
      const facility_upfront_amount = gross_capex * (p.facility_upfront_pct || 0);
      const gridflex_net_capex = Math.max(0, gross_capex - itc_credit - facility_upfront_amount);

      // ── Debt service (PMT formula) ─────────────────────────────────────────
      const dr = p.debt_rate_pct || 0.08;
      const dt = Math.max(1, p.debt_term_years || 10);
      const annual_debt_service = gridflex_net_capex > 0
        ? gridflex_net_capex * (dr * Math.pow(1 + dr, dt)) / (Math.pow(1 + dr, dt) - 1)
        : 0;

      // ── Net margin ─────────────────────────────────────────────────────────
      const gf_net_margin_annual = total_gf_revenue_annual - annual_debt_service;

      return {
        // Utility / NWA
        avoided_kw_yr, gridflex_rate_kw_yr, utility_net_kw_yr, utility_net_annual, nwa_annual, rim_pass,
        // BTM
        btm_savings_annual, gridflex_btm_revenue, facility_btm_savings,
        // Service fee
        service_fee_annual,
        // Revenue total
        total_gf_revenue_annual,
        // Capital
        gross_capex, itc_credit, facility_upfront_amount, gridflex_net_capex, sites,
        // Debt
        annual_debt_service,
        // Net
        gf_net_margin_annual,
        total_contract: gf_net_margin_annual * p.contract_years,
        // Facility view
        facility_upfront_amount,
        facility_annual_net: facility_btm_savings,
      };
    }

    // ── RTO / VI original model ────────────────────────────────────────────
    const facility_kw_yr = p.facility_incentive_kw_yr;
    const margin_kw_yr = gridflex_rate_kw_yr - facility_kw_yr;
    const gridflex_annual = nwa_annual;
    const facility_annual = optMW_kw * facility_kw_yr;
    const margin_annual = gridflex_annual - facility_annual;
    return {
      avoided_kw_yr, gridflex_rate_kw_yr, facility_kw_yr, margin_kw_yr,
      gridflex_annual, facility_annual, margin_annual,
      utility_net_kw_yr, utility_net_annual, rim_pass, nwa_annual,
      total_3yr: margin_annual * 3,
      total_5yr: margin_annual * 5,
      total_10yr: margin_annual * 10,
      total_contract: margin_annual * p.contract_years,
    };
  }, [optimal, p, market]);

  const confColor = r.reduction_fraction > 0.85 ? "#ef4444" : r.reduction_fraction > 0.6 ? "#f59e0b" : "#22c55e";

  const tabs = [
    { id: "leverage",    label: "Topology Leverage", accent: "#06b6d4" },
    { id: "formulas",   label: "Formula Chain",      accent: "#22c55e" },
    { id: "optimal",    label: "Optimal MW",          accent: "#a78bfa" },
    { id: "incentive",  label: "Incentive Model",     accent: "#f472b6" },
    { id: "contract",   label: "Contract Structure",  accent: "#34d399" },
    { id: "assumptions",label: "Assumptions",         accent: "#ef4444" },
  ];
  function generateOnePager() {
    const client = utilityName.trim() || "Prospective Utility Client";
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const pocMW = Math.min(2, Math.round(r.mw_to_fully_relieve * 0.15 * 10) / 10 || 2);
    const pocR = runModel({ ...p, mw_flex: pocMW });
    const optMW = optimal ? optimal.mw : r.mw_to_fully_relieve.toFixed(1);
    const optTotal = optimal ? fmtD(optimal.total_value) : fmtD(r.total_value);
    const eRedisp = fmtD(p.mw_redisp * p.h_bind * p.price_diff);
    const eCurt = fmtD(p.mwh_curt * p.curt_attrib * p.curt_mwh_value);
    const eTotalDrag = fmtD(p.mw_redisp * p.h_bind * p.price_diff + p.mwh_curt * p.curt_attrib * p.curt_mwh_value);

    const marketLabel = marketMeta.label;
    const marketSubtitle = market === "rto" ? "Production Cost Delta & Capacity Value Analysis"
                          : market === "vi"  ? "Production Cost Delta & Capital Deferral Analysis"
                          : "Coincident-Peak Avoidance & Wholesale Cost Analysis";

    // Exposure section varies by market type
    const exposureSectionTitle = market === "emc"
      ? "Coincident-Peak Exposure — What It's Costing You Today"
      : "The Constraint — What It's Costing You Today";

    const exposureCards = market === "emc" ? `
      <div class="card blue">
        <div class="card-label">G&amp;T Demand Charge</div>
        <div class="card-value">$${p.cp_charge_kw_month.toFixed(2)}/kW-mo</div>
        <div class="card-sub">billed on coincident peak</div>
      </div>
      <div class="card blue">
        <div class="card-label">Transmission (NITS)</div>
        <div class="card-value">$${p.trans_charge_kw_month.toFixed(2)}/kW-mo</div>
        <div class="card-sub">billed on same CP determinant</div>
      </div>
      <div class="card blue">
        <div class="card-label">Total CP Rate</div>
        <div class="card-value">$${((p.cp_charge_kw_month + p.trans_charge_kw_month) * 12).toFixed(0)}/kW-yr</div>
        <div class="card-sub">annualized cost of 1 kW on CP</div>
      </div>
    ` : `
      <div class="card blue">
        <div class="card-label">Binding Hours / Year</div>
        <div class="card-value">${p.h_bind} hrs</div>
        <div class="card-sub">hours at thermal limit</div>
      </div>
      <div class="card blue">
        <div class="card-label">MW Redispatch Required</div>
        <div class="card-value">${p.mw_redisp} MW</div>
        <div class="card-sub">avg. out-of-merit dispatch</div>
      </div>
      <div class="card blue">
        <div class="card-label">Price Differential</div>
        <div class="card-value">$${p.price_diff}/MWh</div>
        <div class="card-sub">expensive minus cheap unit</div>
      </div>
    `;

    const exposureTable = market === "emc" ? `
      <table>
        <tr><th>Cost Component</th><th style="text-align:right;">Annual $/kW-yr</th></tr>
        <tr><td class="td-label">G&amp;T demand charge on coincident peak</td><td class="td-value">$${(p.cp_charge_kw_month * 12).toFixed(0)}/kW-yr</td></tr>
        <tr><td class="td-label">Transmission service (NITS) on coincident peak</td><td class="td-value">$${(p.trans_charge_kw_month * 12).toFixed(0)}/kW-yr</td></tr>
        <tr style="background:#fef2f2;"><td class="td-label" style="font-weight:600;">Every 1 kW on CP costs the coop annually</td><td class="td-value" style="color:#dc2626;">$${((p.cp_charge_kw_month + p.trans_charge_kw_month) * 12).toFixed(0)}/kW-yr</td></tr>
        <tr style="background:#f0fdf4;"><td class="td-label" style="font-weight:600;">GridFlex Addressable Value (at optimal ${optMW} MW)</td><td class="td-value" style="color:#16a34a;">${fmtD(r.cp_avoidance_value + r.arbitrage_value)}</td></tr>
      </table>
    ` : `
      <table>
        <tr><th>Cost Component</th><th style="text-align:right;">Annual Cost</th></tr>
        <tr><td class="td-label">Redispatch (out-of-merit dispatch cost)</td><td class="td-value">${eRedisp}</td></tr>
        ${mods.curtailment ? `<tr><td class="td-label">Attributable curtailment losses (${Math.round(p.curt_attrib * 100)}% attribution)</td><td class="td-value">${eCurt}</td></tr>` : ""}
        <tr style="background:#fef2f2;"><td class="td-label" style="font-weight:600;">Total Annual Production Cost Drag (full system)</td><td class="td-value" style="color:#dc2626;">${eTotalDrag}</td></tr>
        <tr style="background:#f0fdf4;"><td class="td-label" style="font-weight:600;">GridFlex Addressable Value (at optimal ${optMW} MW)</td><td class="td-value" style="color:#16a34a;">${fmtD(optimal ? optimal.production_cost_delta : r.production_cost_delta)}</td></tr>
      </table>
    `;

    // Value-stack rows vary by market — only show streams actually active.
    const valueStackRows = [
      mods.redispatch ? `<tr><td class="td-label">Production cost delta (redispatch savings${mods.curtailment ? " + curtailment recovery" : ""})</td><td class="td-value">${fmtD(optimal ? optimal.production_cost_delta : r.production_cost_delta)}</td></tr>` : "",
      mods.capacity   ? `<tr><td class="td-label">Capacity market revenue ($${p.capacity_price_mw_day}/MW-day × ${fmtPct(p.capacity_accreditation)} accreditation)</td><td class="td-value">${fmtD(r.capacity_market_value)}</td></tr>` : "",
      mods.cp_avoid   ? `<tr><td class="td-label">Coincident-peak avoidance ($${(p.cp_charge_kw_month + p.trans_charge_kw_month).toFixed(2)}/kW-mo × ${fmtPct(p.cp_coincidence)} coincidence × 12 months)</td><td class="td-value">${fmtD(r.cp_avoidance_value)}</td></tr>` : "",
      mods.arbitrage  ? `<tr><td class="td-label">Energy arbitrage ($${p.arb_spread_mwh}/MWh spread × ${p.arb_hours_per_year} hrs/yr)</td><td class="td-value">${fmtD(r.arbitrage_value)}</td></tr>` : "",
      mods.reserves   ? `<tr><td class="td-label">Operating reserve credit (${fmtPct(p.reserve_eligible_pct)} eligible × $${p.reserve_rate_kw_yr}/kW-yr)</td><td class="td-value">${fmtD(r.reserve_value)}</td></tr>` : "",
      mods.cap_defer  ? `<tr><td class="td-label">Capital deferral — NPV of ${p.years_deferral}-year delay on $${(p.capex / 1e6).toFixed(0)}M project (${Math.round(p.wacc * 100)}% WACC)</td><td class="td-value">${fmtD(r.capital_deferral_value)}</td></tr>` : "",
    ].filter(Boolean).join("\n      ");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>GridFlex — ${client} Engagement Summary</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #fff; color: #0f172a; font-size: 13px; }
  .page { max-width: 820px; margin: 0 auto; padding: 48px 52px; }
  .logo-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; border-bottom: 2px solid #0f172a; padding-bottom: 14px; }
  .logo-name { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
  .logo-tag { font-size: 9px; letter-spacing: 0.18em; color: #2563eb; font-weight: 600; margin-top: 2px; }
  .meta { text-align: right; font-size: 11px; color: #64748b; line-height: 1.6; }
  .title { font-size: 22px; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #2563eb; font-weight: 500; margin-bottom: 28px; }
  .section { margin-bottom: 22px; }
  .section-head { font-size: 8px; font-weight: 700; letter-spacing: 0.2em; color: #94a3b8; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 12px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; }
  .card.blue { border-left: 3px solid #2563eb; }
  .card.green { border-left: 3px solid #16a34a; }
  .card.amber { border-left: 3px solid #d97706; }
  .card.red { border-left: 3px solid #dc2626; }
  .card.purple { border-left: 3px solid #7c3aed; }
  .card-label { font-size: 9px; color: #94a3b8; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
  .card-value { font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1; }
  .card-sub { font-size: 10px; color: #64748b; margin-top: 4px; }
  .highlight-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 14px 18px; margin-bottom: 22px; }
  .highlight-box .hl-label { font-size: 9px; font-weight: 700; letter-spacing: 0.15em; color: #2563eb; text-transform: uppercase; margin-bottom: 6px; }
  .highlight-box .hl-text { font-size: 12px; color: #1e3a5f; line-height: 1.65; }
  .poc-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 14px 18px; margin-bottom: 22px; }
  .poc-box .poc-label { font-size: 9px; font-weight: 700; letter-spacing: 0.15em; color: #16a34a; text-transform: uppercase; margin-bottom: 6px; }
  .poc-box .poc-text { font-size: 12px; color: #14532d; line-height: 1.65; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 9px; font-weight: 700; letter-spacing: 0.1em; color: #94a3b8; text-transform: uppercase; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; }
  tr:last-child td { border-bottom: none; }
  .td-label { color: #475569; }
  .td-value { font-weight: 600; color: #0f172a; text-align: right; }
  .footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-end; }
  .footer-left { font-size: 10px; color: #64748b; line-height: 1.7; }
  .footer-right { font-size: 9px; color: #94a3b8; text-align: right; line-height: 1.7; }
  .pill { display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: 0.1em; border-radius: 4px; padding: 2px 8px; text-transform: uppercase; }
  .pill.blue { background: #dbeafe; color: #1d4ed8; }
  .pill.green { background: #dcfce7; color: #15803d; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="page">

  <div class="logo-row">
    <div>
      <div class="logo-name">GridFlex Analytics</div>
      <div class="logo-tag">TRANSMISSION CONSTRAINT ANALYTICS</div>
    </div>
    <div class="meta">
      <div><strong>${client}</strong></div>
      <div>Engagement Summary</div>
      <div>${date}</div>
    </div>
  </div>

  <div class="title">${market === "emc" ? "Flex Before You Build — Coincident-Peak Load Reduction" : "Constraint Relief via Topology-Targeted Flex Load"}</div>
  <div class="subtitle">${marketLabel} &mdash; ${marketSubtitle}</div>

  <div class="highlight-box">
    <div class="hl-label">The Core Concept</div>
    <div class="hl-text">
      ${market === "emc"
        ? `Your cooperative is billed by the G&T on a <strong>coincident-peak (CP) determinant</strong> — a handful of hours each year that set your demand charge for the next 12 months. Every kilowatt your members draw during those hours is costing you on <em>both</em> the G&T demand charge and the transmission service charge. GridFlex deploys enrolled commercial BESS sites to reduce load precisely during those hours — then structures the engagement so the cooperative's own avoided G&T costs fund the program. <strong>Flex before you build.</strong>`
        : `At the right node on the network, 1 MW of flexible load shed can relieve <strong>${p.topology_leverage}x</strong> more redispatch than it would at an untargeted location — because of its Power Transfer Distribution Factor (PTDF) relative to the binding constraint. GridFlex identifies these nodes, quantifies the production cost delta, and structures the engagement so the utility's own avoided costs fund the program.`}
    </div>
  </div>

  <div class="section">
    <div class="section-head">${exposureSectionTitle}</div>
    <div class="grid3">
      ${exposureCards}
    </div>
    <div style="margin-top:10px;">
      ${exposureTable}
    </div>
  </div>

  <div class="section">
    <div class="section-head">${market === "emc" ? "The GridFlex Approach — Enrolled BESS Fleet" : "The GridFlex Approach — Topology Leverage"}</div>
    <div class="grid3">
      ${market === "emc" ? `
      <div class="card green">
        <div class="card-label">Enrolled Site Capacity</div>
        <div class="card-value">${p.site_kw || 500} kW</div>
        <div class="card-sub">per commercial BESS site (${p.duration_hours || 2}h duration)</div>
      </div>
      <div class="card green">
        <div class="card-label">Sites at ${optMW} MW</div>
        <div class="card-value">${Math.ceil(parseFloat(optMW) * 1000 / (p.site_kw || 500))} sites</div>
        <div class="card-sub">${optMW} MW ÷ ${p.site_kw || 500} kW/site</div>
      </div>
      <div class="card green">
        <div class="card-label">CP Delivery Factor</div>
        <div class="card-value">${fmtPct(p.delivery_factor)}</div>
        <div class="card-sub">probability online during CP hour</div>
      </div>
      ` : `
      <div class="card green">
        <div class="card-label">Topology Leverage</div>
        <div class="card-value">${p.topology_leverage}x</div>
        <div class="card-sub">MW relief per MW flex load shed</div>
      </div>
      <div class="card green">
        <div class="card-label">MW to Fully Relieve</div>
        <div class="card-value">${r.mw_to_fully_relieve.toFixed(1)} MW</div>
        <div class="card-sub">flex load needed at target node</div>
      </div>
      <div class="card green">
        <div class="card-label">Optimal Deployment</div>
        <div class="card-value">${optMW} MW</div>
        <div class="card-sub">value-maximizing threshold</div>
      </div>
      `}
    </div>
  </div>

  ${market !== "emc" ? `
  <div class="section">
    <div class="section-head">Dispatch Protocol — BA Forecast-Based Flex Load</div>
    <div class="grid3">
      <div class="card amber">
        <div class="card-label">Forecast Peak</div>
        <div class="card-value">${fmtHour(p.forecast_peak_hour)}</div>
        <div class="card-sub">BA daily load forecast peak</div>
      </div>
      <div class="card blue">
        <div class="card-label">Pre-Dispatch Window</div>
        <div class="card-value">${fmtHour(p.forecast_peak_hour - p.window_hours)} – ${fmtHour(p.forecast_peak_hour)}</div>
        <div class="card-sub">flex load charges / stores energy off-peak</div>
      </div>
      <div class="card green">
        <div class="card-label">Dispatch Window</div>
        <div class="card-value">${fmtHour(p.forecast_peak_hour)} – ${fmtHour(p.forecast_peak_hour + p.window_hours)}</div>
        <div class="card-sub">load reduces — constraint binding window</div>
      </div>
    </div>
    <div style="font-size:11px; color:#475569; margin-top:10px; line-height:1.7;">
      Each morning the operator pulls the BA load forecast, identifies the expected peak hour, and confirms the dispatch schedule.
      Flex load assets stage during the pre-dispatch window and reduce electrical demand during the constraint window.
      Signal delivery: OpenADR automated dispatch or manual schedule.
    </div>
  </div>
  ` : `
  <div class="section">
    <div class="section-head">Dispatch Protocol — DERMS-Automated CP Event Response</div>
    <div class="grid3">
      <div class="card amber">
        <div class="card-label">CP Event Frequency</div>
        <div class="card-value">${p.cp_events_per_year} months/yr</div>
        <div class="card-sub">each month has one CP determinant hour</div>
      </div>
      <div class="card blue">
        <div class="card-label">Dependable CP Reduction</div>
        <div class="card-value">${(p.mw_flex * (p.delivery_factor || 0.95) * (p.cp_coincidence || 0)).toFixed(1)} MW</div>
        <div class="card-sub">${optMW} MW × ${fmtPct(p.delivery_factor)} delivery × ${fmtPct(p.cp_coincidence)} CP coincidence</div>
      </div>
      <div class="card green">
        <div class="card-label">Dispatch Method</div>
        <div class="card-value">Automated</div>
        <div class="card-sub">DERMS signal via OpenADR — no manual intervention</div>
      </div>
    </div>
    <div style="font-size:11px; color:#475569; margin-top:10px; line-height:1.7;">
      Enrolled BESS sites are monitored by GridFlex's DERMS platform. When the G&T's CP signal or a forecast-based trigger fires,
      enrolled sites automatically discharge, reducing coincident demand on the cooperative's billed peak.
      Measurement & verification is performed against BESS dispatch logs and interval meter data from the cooperative.
      Once commissioned, BESS sites respond in seconds — delivery factor reflects commissioning and availability, not dispatch lag.
    </div>
  </div>
  `}

  <div class="section">
    <div class="section-head">Full Value Stack — At Optimal ${optMW} MW Deployment (${marketLabel})</div>
    <table>
      <tr><th>Value Component</th><th style="text-align:right;">Annual Value</th></tr>
      ${valueStackRows}
      <tr style="background:#f0fdf4;"><td class="td-label" style="font-weight:600;">Total Value Stack</td><td class="td-value" style="color:#16a34a;">${optTotal}</td></tr>
    </table>
  </div>

  <div class="poc-box">
    <div class="poc-label">Proof of Concept Proposal — ${pocMW} MW Pilot</div>
    <div class="poc-text">
      ${market === "emc"
        ? `GridFlex proposes a <strong>${pocMW} MW flex load pilot</strong> deployed at commercial sites with the highest coincident-peak coincidence. The fleet delivers <strong>${(pocMW * p.delivery_factor * p.cp_coincidence).toFixed(1)} MW of dependable load reduction during the cooperative's billed CP hour</strong>, producing measurable wholesale demand-charge avoidance of approximately <strong>${fmtD(pocR.cp_avoidance_value + pocR.arbitrage_value)} per year</strong>. Results are verified against BESS dispatch logs and EMC interval meter data. If the pilot validates, Phase 2 scales to the full ${optMW} MW optimal deployment.`
        : `GridFlex proposes a <strong>${pocMW} MW flex load pilot</strong> at the highest-leverage node in the constraint corridor. At ${p.topology_leverage}x topology leverage, this delivers <strong>${(pocMW * p.delivery_factor * p.coincidence_factor * p.topology_leverage).toFixed(1)} MW of redispatch equivalent</strong> — enough to produce a measurable, auditable production cost delta of approximately <strong>${fmtD(pocR.production_cost_delta)} per year</strong>. Results are validated against actual EMS dispatch logs and ISO/RTO public data. If the pilot validates, Phase 2 scales to the full ${optMW} MW optimal deployment.`}
    </div>
  </div>

  <div class="section">
    <div class="section-head">Contract Structure — ${p.contract_years}-Year Agreement</div>
    ${market === "emc" ? `
    <div class="grid3" style="margin-bottom:12px;">
      <div class="card green">
        <div class="card-label">G&T Avoided Cost</div>
        <div class="card-value" style="font-size:16px;">$${contract ? Math.round(contract.avoided_kw_yr) : "—"}/kW-yr</div>
        <div class="card-sub">CP demand reduction at ${optMW} MW deployed</div>
      </div>
      <div class="card blue">
        <div class="card-label">NWA Contract Rate</div>
        <div class="card-value" style="font-size:16px;">$${contract ? Math.round(contract.gridflex_rate_kw_yr) : "—"}/kW-yr</div>
        <div class="card-sub">cooperative pays GridFlex — single invoice</div>
      </div>
      <div class="card purple">
        <div class="card-label">Cooperative Net Savings</div>
        <div class="card-value" style="font-size:16px;">$${contract ? Math.round(contract.utility_net_kw_yr) : "—"}/kW-yr</div>
        <div class="card-sub">retained vs. G&T infrastructure build</div>
      </div>
    </div>
    <table>
      <tr><th>How It Works</th><th style="text-align:right;"></th></tr>
      <tr><td class="td-label">Cooperative → GridFlex</td><td class="td-value">NWA contract payment — funded by avoided G&T demand charges</td></tr>
      <tr><td class="td-label">Enrolled Facilities</td><td class="td-value">Zero upfront cost — BESS installed and operated by GridFlex; facilities share in on-site demand savings</td></tr>
      <tr><td class="td-label">GridFlex Role</td><td class="td-value">Owns, operates, and dispatches the BESS fleet; handles all M&V, DERMS, and contract administration</td></tr>
    </table>
    <table style="margin-top:10px;">
      <tr><th>Cooperative Economics</th><th style="text-align:right;">Annual</th><th style="text-align:right;">${p.contract_years}-Year Total</th></tr>
      <tr><td class="td-label">G&T demand charge reduction</td><td class="td-value" style="color:#16a34a;">${contract ? fmtD(contract.avoided_kw_yr * optMW_kw) : "—"}</td><td class="td-value" style="color:#16a34a;">${contract ? fmtD(contract.avoided_kw_yr * optMW_kw * p.contract_years) : "—"}</td></tr>
      <tr><td class="td-label">NWA payment to GridFlex</td><td class="td-value" style="color:#dc2626;">–${contract ? fmtD(contract.nwa_annual) : "—"}</td><td class="td-value" style="color:#dc2626;">–${contract ? fmtD(contract.nwa_annual * p.contract_years) : "—"}</td></tr>
      <tr style="background:#f0fdf4;"><td class="td-label" style="font-weight:600;">Cooperative Net Savings</td><td class="td-value" style="color:#16a34a;">${contract ? fmtD(contract.utility_net_annual) : "—"}</td><td class="td-value" style="color:#16a34a;">${contract ? fmtD(contract.utility_net_annual * p.contract_years) : "—"}</td></tr>
    </table>
    <div style="font-size:11px; color:#64748b; margin-top:10px; line-height:1.6;">
      The cooperative executes a single NWA contract with GridFlex — no capital outlay, no facility coordination required.
      GridFlex owns and operates the enrolled BESS fleet, dispatches automatically on CP signals via OpenADR, and provides monthly M&V reporting.
      Enrolled commercial facilities host BESS at no upfront cost and benefit from reduced on-site demand charges.
      Cooperative net savings over ${p.contract_years} years vs. building the deferred infrastructure: <strong>${contract ? fmtD(contract.utility_net_annual * p.contract_years) : "—"}</strong>.
    </div>
    ` : `
    <div class="grid3" style="margin-bottom:12px;">
      <div class="card green">
        <div class="card-label">Utility Avoided Cost</div>
        <div class="card-value" style="font-size:16px;">$${contract ? Math.round(contract.avoided_kw_yr) : "—"}/kW-yr</div>
        <div class="card-sub">production cost delta at ${optMW} MW</div>
      </div>
      <div class="card blue">
        <div class="card-label">GridFlex Contract Rate</div>
        <div class="card-value" style="font-size:16px;">$${contract ? Math.round(contract.gridflex_rate_kw_yr) : "—"}/kW-yr</div>
        <div class="card-sub">${fmtPct(p.gridflex_rate_pct)} of avoided cost — single utility invoice</div>
      </div>
      <div class="card purple">
        <div class="card-label">Utility Net Savings</div>
        <div class="card-value" style="font-size:16px;">$${contract ? Math.round(contract.utility_net_kw_yr) : "—"}/kW-yr</div>
        <div class="card-sub">retained vs. building the wire</div>
      </div>
    </div>
    <table>
      <tr><th>Payment Flow</th><th style="text-align:right;">Annual</th><th style="text-align:right;">${p.contract_years}-Year Total</th></tr>
      <tr><td class="td-label">Utility → GridFlex (NWA contract)</td><td class="td-value">${contract ? fmtD(contract.gridflex_annual) : "—"}</td><td class="td-value">${contract ? fmtD(contract.gridflex_annual * p.contract_years) : "—"}</td></tr>
      <tr><td class="td-label">GridFlex → Facilities (bill credit at $${p.facility_incentive_kw_yr}/kW-yr)</td><td class="td-value" style="color:#dc2626;">–${contract ? fmtD(contract.facility_annual) : "—"}</td><td class="td-value" style="color:#dc2626;">–${contract ? fmtD(contract.facility_annual * p.contract_years) : "—"}</td></tr>
      <tr style="background:#f0fdf4;"><td class="td-label" style="font-weight:600;">GridFlex Net Margin</td><td class="td-value" style="color:#16a34a;">${contract ? fmtD(contract.margin_annual) : "—"}</td><td class="td-value" style="color:#16a34a;">${contract ? fmtD(contract.total_contract) : "—"}</td></tr>
    </table>
    <div style="font-size:11px; color:#64748b; margin-top:10px; line-height:1.6;">
      GridFlex serves as the single point of contact — the utility executes one NWA contract and receives one invoice.
      Facility incentives are administered downstream by GridFlex as monthly bill credits, offsetting each facility's flex load service cost.
      The utility's ${p.contract_years}-year net savings vs. building the deferred infrastructure: <strong>${contract ? fmtD(contract.utility_net_annual * p.contract_years) : "—"}</strong>.
    </div>
    `}
  </div>

  <div class="section">
    <div class="section-head">Assumptions &amp; Validation Notes</div>
    <div style="font-size:11px; color:#475569; line-height:1.8;">
      ${market === "emc"
        ? `G&T demand charge ($${p.cp_charge_kw_month.toFixed(2)}/kW-mo) and transmission rate ($${p.trans_charge_kw_month.toFixed(2)}/kW-mo) should be confirmed from the G&T's current wholesale rate schedule.
      CP coincidence factor (${fmtPct(p.cp_coincidence)}) reflects BESS availability during the monthly CP hour — validate post-deployment against interval meter data.
      Capital deferral assumes ${p.years_deferral}-year load growth trajectory per the cooperative's most recent IRP or capital plan.
      All values are analytical estimates. Phase 1 involves data sharing and site qualification to firm up inputs.`
        : `Topology leverage factor (${p.topology_leverage}x) requires validation against network PTDF data for the specific constraint corridor.
      Price differential ($${p.price_diff}/MWh) and binding hours (${p.h_bind} hrs/year) should be confirmed from OASIS data or utility dispatch records.
      Capital deferral timing assumes ${p.years_deferral}-year load growth trajectory per utility IRP.
      All values presented as analytical estimates pending data confirmation in Phase 1.`}
    </div>
  </div>

  <div class="footer">
    <div class="footer-left">
      <strong>Joshua Yackee</strong><br/>
      GridFlex Analytics<br/>
      jyackee@gridflexanalytics.com<br/>
      gridflexanalytics.com
    </div>
    <div class="footer-right">
      Model: GridFlex Production Cost Delta Simulator<br/>
      Topology leverage methodology — PTDF-based constraint targeting<br/>
      ${date}
    </div>
  </div>

</div>
</body>
</html>`;

    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
  }

  const barData = [
    ...(mods.redispatch  ? [{ name: "Redispatch",    value: r.redispatch_value,       color: "#3b82f6" }] : []),
    ...(mods.curtailment ? [{ name: "Curtailment",   value: r.curtailment_value,      color: "#8b5cf6" }] : []),
    ...(mods.capacity    ? [{ name: "Capacity Mkt",  value: r.capacity_market_value,  color: "#2563eb" }] : []),
    ...(mods.cp_avoid    ? [{ name: "CP Avoidance",  value: r.cp_avoidance_value,     color: "#16a34a" }] : []),
    ...(mods.arbitrage   ? [{ name: "Energy Arb",    value: r.arbitrage_value,        color: "#0ea5e9" }] : []),
    ...(mods.reserves    ? [{ name: "Reserves",      value: r.reserve_value,          color: "#f97316" }] : []),
    ...(mods.cap_defer   ? [{ name: "Cap Deferral",  value: r.capital_deferral_value, color: "#f59e0b" }] : []),
    { name: "TOTAL", value: r.total_value, color: "#22c55e" },
  ];

  return (
    <div style={{ background: "#050b12", minHeight: "100vh", color: "#e2e8f0", fontFamily: "sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ background: "#070f1a", borderBottom: "1px solid #0f1c2a", padding: "16px 24px 13px" }}>
        <div style={{ fontSize: 9, color: "#2563eb", fontFamily: "monospace", letterSpacing: "0.2em", marginBottom: 4 }}>
          GRIDFLEX ANALYTICS // PRODUCTION COST DELTA SIMULATOR
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 3px", letterSpacing: "-0.02em" }}>
          Constraint-Relieved Dispatch Model + Topology Leverage
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {mods.redispatch ? (
            <div style={{ fontSize: 11, color: "#7a90a8" }}>
              {p.mw_flex} MW flex load shed × {p.topology_leverage}x leverage = {(p.mw_flex * p.delivery_factor * p.coincidence_factor * p.topology_leverage).toFixed(1)} MW redispatch equivalent —
              fully relieves constraint at <span style={{ color: "#06b6d4" }}>{r.mw_to_fully_relieve.toFixed(1)} MW installed</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "#7a90a8" }}>
              {p.mw_flex} MW × {fmtPct(p.delivery_factor)} delivery × {fmtPct(p.cp_coincidence)} CP coincidence = <span style={{ color: "#16a34a" }}>{(p.mw_flex * p.delivery_factor * p.cp_coincidence).toFixed(1)} MW dependable CP reduction</span>
            </div>
          )}
          {mods.redispatch && (
            <div style={{ fontSize: 10, fontFamily: "monospace", color: confColor, background: confColor + "15", border: "1px solid " + confColor + "40", borderRadius: 4, padding: "2px 8px" }}>
              {r.reduction_fraction >= 1.0 ? "CONSTRAINT FULLY RELIEVED" : fmtPct(r.reduction_fraction) + " CONSTRAINT RELIEVED"}
            </div>
          )}
        </div>
        {/* Market type selector — drives which value streams apply */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, fontFamily: "monospace", color: "#4a6080", letterSpacing: "0.12em" }}>MARKET TYPE</span>
          <div style={{ display: "flex", background: "#0b1520", border: "1px solid #1e3a5a", borderRadius: 5, overflow: "hidden" }}>
            {Object.values(MARKET_TYPES).map((mt) => {
              const active = market === mt.key;
              return (
                <button
                  key={mt.key}
                  onClick={() => setMarket(mt.key)}
                  style={{
                    fontSize: 10, fontFamily: "monospace", fontWeight: 700,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    padding: "6px 14px", border: "none", cursor: "pointer",
                    background: active ? mt.accent : "transparent",
                    color: active ? "#fff" : "#7a90a8",
                    borderRight: "1px solid #1e3a5a",
                  }}
                >
                  {mt.label}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 10, fontFamily: "monospace", color: marketMeta.accent }}>
            {market === "rto" && "Redispatch + capacity + reserves + energy arbitrage"}
            {market === "vi"  && "Capital deferral + reserves + IRP-driven cost delta"}
            {market === "emc" && "CP avoidance" + (mods.arbitrage ? " + energy arbitrage" : "") + (mods.cap_defer ? " + capital deferral" : "")}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <input
            value={utilityName}
            onChange={(e) => setUtilityName(e.target.value)}
            placeholder="Utility / client name (optional)"
            style={{ fontSize: 11, fontFamily: "monospace", background: "#0b1520", border: "1px solid #1e3a5a", borderRadius: 4, padding: "5px 10px", color: "#e2e8f0", width: 240, outline: "none" }}
          />
          <button
            onClick={generateOnePager}
            style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.08em", background: marketMeta.accent, color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}
          >
            GENERATE ONE-PAGER ↗
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "305px 1fr", gap: 15, padding: 15, maxWidth: 1380, margin: "0 auto" }}>

        {/* ── LEFT: INPUTS ── */}
        <div>

          {/* Module 3 — Topology Leverage (RTO + VI only — PTDF is a transmission concept) */}
          {mods.redispatch && (
          <Panel title="Module 3 — Topology Leverage (PTDF)" accent="#06b6d4" badge={{ text: "KEY CONCEPT", color: "#06b6d4" }}>
            <div style={{ fontSize: 11, color: "#4a7090", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 12, borderLeft: "2px solid #06b6d430", paddingLeft: 10 }}>
              At the right node, shedding 1 MW of load can relieve far more than 1 MW of redispatch.
              This ratio is your topology leverage — set it based on the PTDF of your target node
              relative to the binding constraint.
            </div>
            <Slider highlight label="Topology Leverage Multiplier" value={p.topology_leverage}
              display={p.topology_leverage + "x  (1 MW shed = " + p.topology_leverage + " MW redispatch relief)"}
              onChange={set("topology_leverage")} min={1} max={20} step={0.5}
              note={"At " + p.topology_leverage + "x: need only " + r.mw_to_fully_relieve.toFixed(1) + " MW flex load to fully relieve " + p.mw_redisp + " MW constraint"} />
            <div style={{ background: "#06b6d410", border: "1px solid #06b6d430", borderRadius: 5, padding: "10px 12px", marginTop: 8 }}>
              <div style={{ fontSize: 9, color: "#06b6d4", fontFamily: "monospace", marginBottom: 6, letterSpacing: "0.1em" }}>LEVERAGE MATH AT CURRENT SETTINGS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[
                  { label: "Effective load shed",    value: r.mw_effective.toFixed(1) + " MW" },
                  { label: "Redispatch equivalent",  value: Math.min(r.mw_redisp_equivalent, p.mw_redisp).toFixed(1) + " MW" },
                  { label: "MW to fully relieve",    value: r.mw_to_fully_relieve.toFixed(1) + " MW installed" },
                  { label: "Constraint relief",      value: fmtPct(r.reduction_fraction) },
                ].map((item, i) => (
                  <div key={i} style={{ fontSize: 11, fontFamily: "monospace" }}>
                    <span style={{ color: "#3d5068" }}>{item.label}: </span>
                    <span style={{ color: "#06b6d4", fontWeight: 700 }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
          )}

          {/* Module 2 — Base Case (Redispatch) — RTO + VI only */}
          {mods.redispatch && (
          <Panel title="Module 2 — Base Case (Constrained)" accent="#3b82f6">
            <Slider label="Redispatch Required to Relieve Constraint" value={p.mw_redisp}
              display={p.mw_redisp + " MW"} onChange={set("mw_redisp")} min={1} max={500} step={5}
              note="Total MW of generation redispatch needed WITHOUT flexible load" />
            <Slider label="Binding Hours / Year" value={p.h_bind} display={p.h_bind + " hrs"}
              onChange={set("h_bind")} min={50} max={2000} step={10} note="Hours/yr constraint actually binds" />
            <Slider label="Redispatch Price Differential" value={p.price_diff} display={"$" + p.price_diff + "/MWh"}
              onChange={set("price_diff")} min={10} max={150} step={1} note="Cost gap: constrained gen vs. substitute gen" />
            {mods.curtailment && (<>
              <Slider label="Total Zone Curtailment" value={p.mwh_curt} display={(p.mwh_curt / 1000).toFixed(0) + "K MWh"}
                onChange={set("mwh_curt")} min={1000} max={500000} step={1000} note="Annual curtailment in zone" />
              <Slider label="Curtailment Attribution" value={p.curt_attrib} display={fmtPct(p.curt_attrib)}
                onChange={set("curt_attrib")} min={0.05} max={1.0} step={0.05} note="Share caused by this constraint" />
              <Slider label="Curtailed Energy Value" value={p.curt_mwh_value} display={"$" + p.curt_mwh_value + "/MWh"}
                onChange={set("curt_mwh_value")} min={10} max={120} step={1} note="Marginal value of recovered energy" />
            </>)}
          </Panel>
          )}

          {/* NEW — Capacity Market Revenue — RTO only */}
          {mods.capacity && (
          <Panel title="Module 2b — Capacity Market Revenue" accent="#2563eb" badge={{ text: "RTO / ISO", color: "#2563eb" }}>
            <div style={{ fontSize: 11, color: "#4a7090", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 12, borderLeft: "2px solid #2563eb30", paddingLeft: 10 }}>
              DER flex load registered as a capacity resource earns the zonal clearing
              price × MW × accreditation factor. PJM BRA $200/MW-day, MISO PRA ~$80/MW-day,
              NYISO NYC zone highest. Accreditation (ELCC) typically 50–70% for summer-peaking DR.
            </div>
            <Slider label="Capacity Clearing Price ($/MW-day)" value={p.capacity_price_mw_day}
              display={"$" + p.capacity_price_mw_day + "/MW-day"}
              onChange={set("capacity_price_mw_day")} min={0} max={500} step={10}
              note={"Annualized: $" + (p.capacity_price_mw_day * 365 / 1000).toFixed(0) + "K/MW-yr pre-accreditation"} />
            <Slider label="Accreditation (ELCC factor)" value={p.capacity_accreditation}
              display={fmtPct(p.capacity_accreditation)}
              onChange={set("capacity_accreditation")} min={0.3} max={1.0} step={0.05}
              note="Fraction of nameplate MW that counts toward capacity obligation" />
            <div style={{ background: "#2563eb10", border: "1px solid #2563eb30", borderRadius: 5, padding: "8px 10px", marginTop: 6, fontSize: 11, fontFamily: "monospace", color: "#2563eb" }}>
              Annual capacity revenue: <span style={{ fontWeight: 700 }}>{fmtD(r.capacity_market_value)}</span>
              {" "}({p.mw_flex} MW × ${p.capacity_price_mw_day}/day × 365 × {fmtPct(p.capacity_accreditation)})
            </div>
          </Panel>
          )}

          {/* NEW — Coincident Peak Avoidance — EMC / muni only */}
          {mods.cp_avoid && (
          <Panel title="Module 2c — Coincident Peak Avoidance" accent="#16a34a" badge={{ text: "EMC HEADLINE", color: "#16a34a" }}>
            <div style={{ fontSize: 11, color: "#4a7090", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 10, borderLeft: "2px solid #16a34a30", paddingLeft: 10 }}>
              Distribution cooperatives are billed by the G&T on a coincident-peak (CP)
              determinant. A 1 MW flex load online during the CP hour reduces the billed
              MW on <em>both</em> the G&T demand charge and the transmission service (NITS)
              charge. This is typically the largest single dollar lever for a coop.
            </div>
            <div style={{ background: "#16a34a10", border: "1px solid #16a34a30", borderRadius: 4, padding: "8px 10px", marginBottom: 12, fontSize: 10, fontFamily: "monospace", color: "#4a7090", lineHeight: 1.7 }}>
              <div style={{ color: "#16a34a", fontWeight: 700, marginBottom: 3, fontSize: 9, letterSpacing: "0.1em" }}>RATE LOOKUP — WHERE TO FIND THESE NUMBERS</div>
              <div>Pull from your G&T's <strong>wholesale rate schedule</strong> (typically on their website or member portal).</div>
              <div style={{ marginTop: 3 }}>SE reference ranges — <em>confirm from actual tariff:</em></div>
              <div style={{ marginTop: 2, paddingLeft: 8 }}>
                <div>• OPC-served Georgia EMCs: G&T demand ~$5–6/kW-mo, GTC NITS ~$2–4/kW-mo</div>
                <div>• Other SE G&Ts: total CP rate typically $6–12/kW-mo = $72–144/kW-yr</div>
              </div>
            </div>
            <Slider label="G&T Demand Charge ($/kW-month on CP)" value={p.cp_charge_kw_month}
              display={"$" + p.cp_charge_kw_month.toFixed(2) + "/kW-mo"}
              onChange={set("cp_charge_kw_month")} min={0} max={15} step={0.25}
              note={"Annualized: $" + (p.cp_charge_kw_month * 12).toFixed(0) + "/kW-yr on CP"} />
            <Slider label="Transmission Charge ($/kW-month on CP)" value={p.trans_charge_kw_month}
              display={"$" + p.trans_charge_kw_month.toFixed(2) + "/kW-mo"}
              onChange={set("trans_charge_kw_month")} min={0} max={8} step={0.25}
              note="NITS or bundled transmission service rate on the CP determinant" />
            <Slider label="CP Coincidence Factor" value={p.cp_coincidence}
              display={fmtPct(p.cp_coincidence)}
              onChange={set("cp_coincidence")} min={0.3} max={1.0} step={0.05}
              note="Probability flex load is online during the billed CP hour" />
            <div style={{ background: "#16a34a10", border: "1px solid #16a34a30", borderRadius: 5, padding: "8px 10px", marginTop: 6, fontSize: 11, fontFamily: "monospace", color: "#16a34a" }}>
              Annual CP avoidance: <span style={{ fontWeight: 700 }}>{fmtD(r.cp_avoidance_value)}</span>
              {" "}({p.mw_flex}×1000 kW × {fmtPct(p.delivery_factor)} delivery × {fmtPct(p.cp_coincidence)} CP coinc × ${(p.cp_charge_kw_month + p.trans_charge_kw_month).toFixed(2)}/kW-mo × 12)
            </div>
          </Panel>
          )}

          {/* NEW — Energy Arbitrage — RTO + EMC — toggleable */}
          {(baseMods.arbitrage) && (
          <Panel title="Module 2d — Energy Arbitrage" accent="#0ea5e9"
            toggleable enabled={mods.arbitrage} onToggle={() => toggleModule("arbitrage")}>
            <div style={{ fontSize: 11, color: "#4a7090", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 12, borderLeft: "2px solid #0ea5e930", paddingLeft: 10 }}>
              Pre-cool during off-peak hours (cheap $/MWh) and dispatch during peak
              hours (expensive $/MWh). Independent of whether a constraint is binding —
              pure time-shift value driven by the hour-to-hour price spread.
            </div>
            <Slider label="Peak vs Off-Peak $/MWh Spread" value={p.arb_spread_mwh}
              display={"$" + p.arb_spread_mwh + "/MWh"}
              onChange={set("arb_spread_mwh")} min={0} max={120} step={2}
              note={market === "emc"
                ? "Spread on wholesale purchase cost (coop pays G&T less during off-peak)"
                : "LMP spread between peak and off-peak hours"} />
            <Slider label="Arbitrageable Hours / Year" value={p.arb_hours_per_year}
              display={p.arb_hours_per_year + " hrs"}
              onChange={set("arb_hours_per_year")} min={0} max={2000} step={50}
              note="Hours/yr where peak-offpeak spread justifies dispatching" />
            <div style={{ background: "#0ea5e910", border: "1px solid #0ea5e930", borderRadius: 5, padding: "8px 10px", marginTop: 6, fontSize: 11, fontFamily: "monospace", color: "#0ea5e9" }}>
              Annual arbitrage: <span style={{ fontWeight: 700 }}>{fmtD(r.arbitrage_value)}</span>
              {" "}({p.mw_flex} MW × {fmtPct(p.delivery_factor)} delivery × ${p.arb_spread_mwh}/MWh × {p.arb_hours_per_year} hrs)
            </div>
          </Panel>
          )}

          {/* Module 4 — Flex Load Intervention */}
          <Panel title="Module 4 — Flex Load Intervention" accent="#8b5cf6">
            <Slider label="Installed Flexible Load" value={p.mw_flex} display={p.mw_flex + " MW"}
              onChange={set("mw_flex")} min={1} max={100} step={1}
              note={"MW of flex load at target node (" + r.mw_to_fully_relieve.toFixed(1) + " MW fully relieves constraint)"} />
            <Slider label="Delivery Factor" value={p.delivery_factor} display={fmtPct(p.delivery_factor)}
              onChange={set("delivery_factor")} min={0.3} max={1.0} step={0.05} note="Probability load responds when dispatched — derates reserves, CP avoidance, arbitrage" />
            {mods.redispatch && (
              <Slider label="Coincidence Factor (binding-hour overlap)" value={p.coincidence_factor} display={fmtPct(p.coincidence_factor)}
                onChange={set("coincidence_factor")} min={0.2} max={1.0} step={0.05}
                note="Fraction of binding hours where flex is operational — drives redispatch + curtailment math only" />
            )}
            {mods.curtailment && (
              <Slider label="Curtailment Mitigation" value={p.curt_mitigation} display={fmtPct(p.curt_mitigation)}
                onChange={set("curt_mitigation")} min={0.05} max={1.0} step={0.05} note="Share of attributed curtailment recoverable" />
            )}
          </Panel>

          {/* Module 5 — Dispatch Timing — RTO/VI only (BESS dispatches automatically, no pre-cool needed) */}
          {market !== "emc" && (
          <Panel title="Module 5 — Dispatch Timing" accent="#f59e0b" badge={{ text: "BA FORECAST INPUT", color: "#f59e0b" }}>
            <div style={{ fontSize: 11, color: "#4a7090", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 12, borderLeft: "2px solid #f59e0b30", paddingLeft: 10 }}>
              Pull the BA daily load forecast. Enter the expected peak hour and how many hours on each side.
              Units pre-cool before the peak, then deliver near-zero draw during the constraint window.
            </div>
            <Slider label="Forecast Peak Hour" value={p.forecast_peak_hour}
              display={fmtHour(p.forecast_peak_hour)}
              onChange={set("forecast_peak_hour")} min={6} max={22} step={1}
              note="BA daily load forecast peak — typically 2–7 PM summer, 7–9 AM or 6–8 PM winter" />
            <Slider label="Pre-cool / Dispatch Window (each side)" value={p.window_hours}
              display={"±" + p.window_hours + " hr  (" + fmtHour(p.forecast_peak_hour - p.window_hours) + " – " + fmtHour(p.forecast_peak_hour + p.window_hours) + ")"}
              onChange={set("window_hours")} min={1} max={4} step={0.5}
              note={"Pre-cool: " + fmtHour(p.forecast_peak_hour - p.window_hours) + " – " + fmtHour(p.forecast_peak_hour) + "  |  Dispatch: " + fmtHour(p.forecast_peak_hour) + " – " + fmtHour(p.forecast_peak_hour + p.window_hours)} />
            {/* Visual timeline */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 9, color: "#4a7090", fontFamily: "monospace", marginBottom: 5, letterSpacing: "0.1em" }}>DAILY DISPATCH TIMELINE</div>
              <div style={{ position: "relative", height: 32, background: "#0a111a", borderRadius: 4, overflow: "hidden", border: "1px solid #0f1c2a" }}>
                {/* Hour tick lines */}
                {[3, 6, 9, 12, 15, 18, 21].map((h) => (
                  <div key={h} style={{ position: "absolute", left: (h / 24 * 100) + "%", top: 0, bottom: 0, width: 1, background: "#0f1c2a" }} />
                ))}
                {/* Pre-cool window */}
                <div style={{
                  position: "absolute",
                  left: (Math.max(0, p.forecast_peak_hour - p.window_hours) / 24 * 100) + "%",
                  width: (Math.min(p.window_hours, p.forecast_peak_hour) / 24 * 100) + "%",
                  height: "100%",
                  background: "#06b6d420",
                  borderRight: "1px solid #06b6d460",
                }} />
                {/* Dispatch window */}
                <div style={{
                  position: "absolute",
                  left: (p.forecast_peak_hour / 24 * 100) + "%",
                  width: (Math.min(p.window_hours, 24 - p.forecast_peak_hour) / 24 * 100) + "%",
                  height: "100%",
                  background: "#22c55e20",
                  borderLeft: "1px solid #22c55e60",
                }} />
                {/* Peak line */}
                <div style={{ position: "absolute", left: "calc(" + (p.forecast_peak_hour / 24 * 100) + "% - 1px)", width: 2, height: "100%", background: "#f59e0b" }} />
                {/* Labels inside bar */}
                <div style={{ position: "absolute", left: (Math.max(0, p.forecast_peak_hour - p.window_hours) / 24 * 100) + "%", top: 2, fontSize: 8, color: "#06b6d4", fontFamily: "monospace", paddingLeft: 3 }}>PRE-COOL</div>
                <div style={{ position: "absolute", left: "calc(" + (p.forecast_peak_hour / 24 * 100) + "% + 3px)", top: 2, fontSize: 8, color: "#22c55e", fontFamily: "monospace" }}>DISPATCH</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#2d4a63", fontFamily: "monospace", marginTop: 3 }}>
                <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                {[
                  { color: "#06b6d4", label: "Pre-cool  " + fmtHour(p.forecast_peak_hour - p.window_hours) + " – " + fmtHour(p.forecast_peak_hour) },
                  { color: "#f59e0b", label: "Peak  " + fmtHour(p.forecast_peak_hour) },
                  { color: "#22c55e", label: "Dispatch  " + fmtHour(p.forecast_peak_hour) + " – " + fmtHour(p.forecast_peak_hour + p.window_hours) },
                ].map((l, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: l.color, fontFamily: "monospace" }}>
                    <div style={{ width: 8, height: 8, borderRadius: 1, background: l.color + "40", border: "1px solid " + l.color }} />
                    {l.label}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 10, color: "#3d5068", fontFamily: "monospace", marginTop: 10, borderTop: "1px solid #0f1c2a", paddingTop: 8, lineHeight: 1.7 }}>
              {(() => {
                const suggestedCF = Math.min(0.95, 0.50 + (p.window_hours - 1) * 0.10);
                const cfDelta = (suggestedCF - p.coincidence_factor).toFixed(2);
                const cfStatus = Math.abs(suggestedCF - p.coincidence_factor) < 0.05
                  ? { color: "#4ade80", label: "aligned" }
                  : suggestedCF > p.coincidence_factor
                  ? { color: "#f59e0b", label: "conservative — window supports higher" }
                  : { color: "#f87171", label: "aggressive vs. window size" };
                return (
                  <div style={{ background: "#0a111a", border: "1px solid #0f1c2a", borderRadius: 4, padding: "8px 10px" }}>
                    <div style={{ color: "#4a7090", marginBottom: 4 }}>
                      Dispatch window ({p.window_hours} hr) → suggested coincidence factor:{" "}
                      <span style={{ color: "#06b6d4", fontWeight: 700 }}>{fmtPct(suggestedCF)}</span>
                    </div>
                    <div>
                      Current setting: <span style={{ color: "#e2e8f0" }}>{fmtPct(p.coincidence_factor)}</span>
                      {" — "}
                      <span style={{ color: cfStatus.color }}>{cfStatus.label}</span>
                    </div>
                    <div style={{ color: "#2d4a63", marginTop: 4, fontSize: 9, letterSpacing: "0.05em" }}>
                      BASIS: 1-hr window → 60% | 2-hr → 70% | 3-hr → 80% | 4-hr → 90% — adjust for forecast reliability
                    </div>
                  </div>
                );
              })()}
            </div>
          </Panel>
          )}

          {/* Module 6 — Capital Deferral — toggleable */}
          {(baseMods.cap_defer) && (
          <Panel title="Module 6 — Capital Deferral" accent="#f59e0b" badge={{ text: "STRUCTURAL OVERLAY", color: "#f59e0b" }}
            toggleable enabled={mods.cap_defer} onToggle={() => toggleModule("cap_defer")}>
            <div style={{ fontSize: 11, color: "#4a7090", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 12, borderLeft: "2px solid #f59e0b30", paddingLeft: 10 }}>
              One-time NPV from pushing out a planned capital project. Per the
              Pilot-Grade Process — kept as a separate overlay, not mixed into
              production cost delta. Deferral is realized only when deployment
              is sufficient: scaled by constraint relief (RTO/VI) or CP-load
              reduction (EMC).
            </div>
            <Slider label="Infrastructure Project Cost" value={p.capex / 1e6} display={"$" + (p.capex / 1e6).toFixed(0) + "M"}
              onChange={(v) => set("capex")(v * 1e6)} min={1} max={100} step={1} note="Substation / feeder / interface upgrade cost" />
            <Slider label="WACC" value={p.wacc} display={fmtPct(p.wacc)}
              onChange={set("wacc")} min={0.03} max={0.12} step={0.005}
              note={market === "emc" ? "EMC cost of capital — cooperatives typically 4–7%" : "Utility weighted average cost of capital"} />
            <Slider label="Deferral Years" value={p.years_deferral} display={p.years_deferral + " yrs"}
              onChange={set("years_deferral")} min={1} max={10} step={1} note="Years the upgrade can be delayed by meeting the load reduction threshold" />
            <Slider label="MW Threshold for Full Deferral" value={p.mw_deferral_threshold} display={p.mw_deferral_threshold + " MW"}
              onChange={set("mw_deferral_threshold")} min={1} max={100} step={1}
              note={mods.redispatch
                ? "MW of constraint relief required to push out the project"
                : "MW of CP-coincident peak reduction needed to defer the upgrade — confirm from IRP load forecast"} />
            <div style={{ background: "#f59e0b10", border: "1px solid #f59e0b30", borderRadius: 5, padding: "8px 10px", marginTop: 6, fontSize: 11, fontFamily: "monospace", color: "#f59e0b" }}>
              Full deferral NPV: {fmtD(r.capital_deferral_full)} ×{" "}
              <span style={{ color: r.deferral_realized >= 0.95 ? "#22c55e" : r.deferral_realized >= 0.5 ? "#f59e0b" : "#ef4444", fontWeight: 700 }}>
                {fmtPct(r.deferral_realized)} realized
              </span>{" "}= <span style={{ fontWeight: 700 }}>{fmtD(r.capital_deferral_value)}</span>
            </div>
          </Panel>
          )}

          {/* Module 7 — Site Sizing & Incentive */}
          <Panel title={market === "emc" ? "Module 7 — BESS Site Sizing & Incentive" : "Module 7 — Flex Load Incentive"} accent="#f472b6">
            {market === "emc" ? (
              <>
                <div style={{ fontSize: 11, color: "#4a7090", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 12, borderLeft: "2px solid #f472b430", paddingLeft: 10 }}>
                  Cost = (site kW × duration × $/kWh) + per-site soft costs. Sites needed = ⌈MW × 1000 / site kW⌉.
                </div>
                <Slider label="Enrolled Site Capacity" value={p.site_kw || 500}
                  display={(p.site_kw || 500) + " kW per site"}
                  onChange={set("site_kw")} min={250} max={1000} step={50}
                  note={"Sites at " + p.mw_flex + " MW: " + Math.ceil(p.mw_flex * 1000 / (p.site_kw || 500)) + " sites (range 250–1,000 kW C&I BESS)"} />
                {/* Duration toggle */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace" }}>Storage Duration</span>
                    <span style={{ fontSize: 12, color: "#e2e8f0", fontFamily: "monospace", fontWeight: 700 }}>{(p.duration_hours || 2)}h — {(p.site_kw || 500) * (p.duration_hours || 2)} kWh/site</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[2, 4].map((h) => (
                      <button key={h} onClick={() => set("duration_hours")(h)} style={{
                        flex: 1, fontSize: 11, fontFamily: "monospace", fontWeight: 700,
                        background: (p.duration_hours || 2) === h ? "#f472b4" : "#0b1520",
                        color: (p.duration_hours || 2) === h ? "#fff" : "#4a6080",
                        border: "1px solid " + ((p.duration_hours || 2) === h ? "#f472b4" : "#1e3a5a"),
                        borderRadius: 4, padding: "6px 0", cursor: "pointer",
                      }}>{h}h Duration</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#3d5068", fontFamily: "monospace", marginTop: 3 }}>
                    2h = peak shave + CP avoidance | 4h = extended dispatch + deeper CP confidence
                  </div>
                </div>
                <Slider label="BESS Hardware Cost" value={p.bess_cost_kwh || 350}
                  display={"$" + (p.bess_cost_kwh || 350) + "/kWh"}
                  onChange={set("bess_cost_kwh")} min={150} max={650} step={10}
                  note={"Site hardware: $" + (((p.site_kw || 500) * (p.duration_hours || 2) * (p.bess_cost_kwh || 350)) / 1000).toFixed(0) + "K — all-in installed (inverter, BMS, installation)"} />
                <Slider label="Per-Site Soft Costs" value={(p.site_soft_cost || 50000) / 1000}
                  display={"$" + ((p.site_soft_cost || 50000) / 1000).toFixed(0) + "K/site"}
                  onChange={(v) => set("site_soft_cost")(v * 1000)} min={20} max={80} step={5}
                  note="Permitting, engineering, commissioning, interconnection — flat per site" />
                <Slider label="ITC Tax Credit" value={p.itc_pct || 0.30} display={fmtPct(p.itc_pct || 0.30)}
                  onChange={set("itc_pct")} min={0.1} max={0.5} step={0.05} note="48E Clean Electricity ITC — 30% base, up to 50% with adders" />
                <Slider label="Diminishing Returns Threshold" value={p.threshold_pct} display={p.threshold_pct + "% of peak"}
                  onChange={set("threshold_pct")} min={5} max={50} step={5} note="For EMC (linear-value market), this anchors to your input MW — no saturation gate" />
                {(() => {
                  const siteKw = p.site_kw || 500;
                  const siteKwh = siteKw * (p.duration_hours || 2);
                  const siteCost = siteKwh * (p.bess_cost_kwh || 350) + (p.site_soft_cost || 50000);
                  const sites = Math.ceil(p.mw_flex * 1000 / siteKw);
                  const gross = sites * siteCost;
                  const itc = gross * (p.itc_pct || 0.30);
                  const net = gross - itc;
                  return (
                    <div style={{ background: "#f472b410", border: "1px solid #f472b430", borderRadius: 5, padding: "9px 11px", marginTop: 6, fontSize: 11, fontFamily: "monospace" }}>
                      <div style={{ color: "#f472b6", marginBottom: 5, fontSize: 10, letterSpacing: "0.08em" }}>CAPITAL SUMMARY — {p.mw_flex} MW ({sites} SITES × {siteKw} kW)</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, color: "#4a7090" }}>
                        <div>Site kWh: <span style={{ color: "#e2e8f0" }}>{siteKwh} kWh</span></div>
                        <div>Site cost: <span style={{ color: "#e2e8f0" }}>{fmtD(siteCost)}</span></div>
                        <div>Gross capital: <span style={{ color: "#ef4444" }}>{fmtD(gross)}</span></div>
                        <div>ITC ({fmtPct(p.itc_pct || 0.30)}): <span style={{ color: "#22c55e" }}>–{fmtD(itc)}</span></div>
                      </div>
                      <div style={{ marginTop: 5, color: "#f59e0b", fontWeight: 700 }}>Net owner cost: {fmtD(net)}</div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <>
                <Slider label="Flex Load Unit Cost (installed)" value={p.hvac_unit_cost} display={"$" + (p.hvac_unit_cost / 1000).toFixed(0) + "K"}
                  onChange={set("hvac_unit_cost")} min={15000} max={120000} step={1000} note="Fully installed cost per flex load unit" />
                <Slider label="Unit Electrical Capacity" value={p.hvac_unit_kw} display={p.hvac_unit_kw + " kW"}
                  onChange={set("hvac_unit_kw")} min={5} max={60} step={1} note="kW electrical demand per unit" />
                <Slider label="ITC Tax Credit" value={p.itc_pct} display={fmtPct(p.itc_pct)}
                  onChange={set("itc_pct")} min={0.1} max={0.5} step={0.05} note="48E Clean Electricity ITC — 30-40% typical" />
                <Slider label="Utility Rebate" value={p.utility_incentive_pct} display={fmtPct(p.utility_incentive_pct)}
                  onChange={set("utility_incentive_pct")} min={0} max={0.5} step={0.05} note="Rebate as % of unit cost — funded from avoided cost pool" />
                <Slider label="Diminishing Returns Threshold" value={p.threshold_pct} display={p.threshold_pct + "% of peak"}
                  onChange={set("threshold_pct")} min={5} max={50} step={5} note="Optimal MW = where marginal value drops below this % of peak" />
              </>
            )}
          </Panel>

          {/* Module 8 — Contract Structure */}
          <Panel title="Module 8 — Contract Structure" accent="#34d399" badge={{ text: market === "emc" ? "DUAL REVENUE" : "NWA CONTRACT", color: "#34d399" }}>
            <Slider label="Contract Term" value={p.contract_years} display={p.contract_years + " yrs"}
              onChange={set("contract_years")} min={3} max={15} step={1} note="NWA contract length — longer term justifies higher rate and improves debt coverage" />
            <Slider label="GridFlex NWA Rate (% of utility avoided cost)" value={p.gridflex_rate_pct} display={fmtPct(p.gridflex_rate_pct)}
              onChange={set("gridflex_rate_pct")} min={0.40} max={0.85} step={0.05} note="Utility pays GridFlex this share of G&T avoidance — utility keeps the rest" />
            {market === "emc" ? (
              <>
                <div style={{ fontSize: 9, color: "#34d399", fontFamily: "monospace", letterSpacing: "0.1em", margin: "10px 0 6px", borderTop: "1px solid #0f1c2a", paddingTop: 10 }}>BTM — FACILITY DEMAND CHARGE SAVINGS</div>
                <Slider label="Facility Demand Charge Rate" value={p.facility_demand_rate_kw_month || 0}
                  display={"$" + (p.facility_demand_rate_kw_month || 0).toFixed(2) + "/kW-mo"}
                  onChange={set("facility_demand_rate_kw_month")} min={6} max={20} step={0.25}
                  note="$/kW-month on facility's commercial EMC bill — enter from their rate schedule" />
                <Slider label="GridFlex Share of BTM Savings" value={p.gridflex_btm_share_pct || 0.80}
                  display={fmtPct(p.gridflex_btm_share_pct || 0.80)}
                  onChange={set("gridflex_btm_share_pct")} min={0.20} max={0.80} step={0.05}
                  note={"Facility keeps " + fmtPct(1 - (p.gridflex_btm_share_pct || 0.80)) + " of their demand savings — their ongoing incentive"} />
                <div style={{ fontSize: 9, color: "#34d399", fontFamily: "monospace", letterSpacing: "0.1em", margin: "10px 0 6px", borderTop: "1px solid #0f1c2a", paddingTop: 10 }}>FACILITY UPFRONT CONTRIBUTION</div>
                <Slider label="Facility Upfront (% of project cost)" value={p.facility_upfront_pct || 0}
                  display={fmtPct(p.facility_upfront_pct || 0)}
                  onChange={set("facility_upfront_pct")} min={0} max={0.50} step={0.05}
                  note={"Facility puts in " + fmtD((contract?.gross_capex || 0) * (p.facility_upfront_pct || 0)) + " upfront → GridFlex net capex goes down → negotiate lower BTM share"} />
                <div style={{ fontSize: 9, color: "#34d399", fontFamily: "monospace", letterSpacing: "0.1em", margin: "10px 0 6px", borderTop: "1px solid #0f1c2a", paddingTop: 10 }}>SERVICE FEE</div>
                <Slider label="Management / Dispatch Fee" value={p.service_fee_kw_yr || 0}
                  display={"$" + (p.service_fee_kw_yr || 0) + "/kW-yr"}
                  onChange={set("service_fee_kw_yr")} min={0} max={100} step={5}
                  note="Annual fee for DERMS dispatch, M&V, contract admin — paid by facility. $20–50/kW-yr typical for managed DERaaS" />
                <div style={{ fontSize: 9, color: "#34d399", fontFamily: "monospace", letterSpacing: "0.1em", margin: "10px 0 6px", borderTop: "1px solid #0f1c2a", paddingTop: 10 }}>DEBT (GRIDFLEX-HELD)</div>
                <Slider label="Interest Rate" value={p.debt_rate_pct || 0.08}
                  display={fmtPct(p.debt_rate_pct || 0.08)}
                  onChange={set("debt_rate_pct")} min={0.04} max={0.14} step={0.005}
                  note="Commercial BESS financing: 6–10% typical with NWA offtake as collateral" />
                <Slider label="Loan Term" value={p.debt_term_years || 10}
                  display={(p.debt_term_years || 10) + " yrs"}
                  onChange={set("debt_term_years")} min={5} max={15} step={1}
                  note="Match to contract term or BESS useful life (10–15 yr)" />
              </>
            ) : (
              <Slider label="Facility Incentive ($/kW-yr)" value={p.facility_incentive_kw_yr} display={"$" + p.facility_incentive_kw_yr + "/kW-yr"}
                onChange={set("facility_incentive_kw_yr")} min={10} max={100} step={5} note="Monthly bill credit to facility — funded from GridFlex contract revenue" />
            )}
          </Panel>

          {/* Module 9 — Operating Reserve Value */}
          {mods.reserves && (
          <Panel title="Module 9 — Operating Reserve Value" accent="#f97316" badge={{ text: "RESERVES", color: "#f97316" }}>
            <div style={{ fontSize: 11, color: "#4a7090", fontFamily: "monospace", lineHeight: 1.7, marginBottom: 12, borderLeft: "2px solid #f97316 30", paddingLeft: 10 }}>
              Flex load that can respond in seconds qualifies as spinning reserve — a NERC BAL-002 obligation
              the utility must otherwise hold as generator headroom. With AI/data center load growth,
              reserve requirements are rising faster than new capacity can be built.
              Load flex is an underpriced solution to the reserve burden.
            </div>
            <Slider label="Reserve-Eligible Fraction" value={p.reserve_eligible_pct} display={fmtPct(p.reserve_eligible_pct)}
              onChange={set("reserve_eligible_pct")} min={0.2} max={1.0} step={0.05}
              note="% of flex MW qualifying as spinning/non-spinning reserve (response-time + telemetry gates)" />
            <Slider label="Reserve Capacity Credit ($/kW-yr)" value={p.reserve_rate_kw_yr} display={"$" + p.reserve_rate_kw_yr + "/kW-yr"}
              onChange={set("reserve_rate_kw_yr")} min={2} max={30} step={1}
              note={"PJM reference ~$4–8/kW-yr spin, ~$2–4/kW-yr non-spin | revenue derated by Delivery factor"} />
            <div style={{ fontSize: 10, color: "#3d5068", fontFamily: "monospace", marginTop: 4 }}>
              At current settings: {p.mw_flex} MW × 1000 × {fmtPct(p.delivery_factor)} delivery × {fmtPct(p.reserve_eligible_pct)} eligible × ${p.reserve_rate_kw_yr}/kW-yr = <span style={{ color: "#f97316" }}>{fmtD(r.reserve_value)}/yr</span>
            </div>
          </Panel>
          )}

        </div>

        {/* ── RIGHT: RESULTS ── */}
        <div>

          {/* Summary metric row — headline KPI box swaps by market type */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 9, marginBottom: 14 }}>
            <MBox label="Effective Load Shed" value={r.mw_effective.toFixed(1) + " MW"}
              sub={p.mw_flex + " MW × " + fmtPct(p.delivery_factor) + " × " + fmtPct(p.coincidence_factor)}
              color="#06b6d4" tag="DEPENDABLE MW" />
            {market === "rto" && (
              <MBox label="Production Cost Δ + Capacity" value={fmtD(r.production_cost_delta + r.capacity_market_value)}
                sub={"Redisp: " + fmtD(r.redispatch_value) + " | Cap mkt: " + fmtD(r.capacity_market_value)}
                color="#22c55e" tag="ANNUAL BENEFIT (RTO)" />
            )}
            {market === "vi" && (
              <MBox label="Production Cost Delta" value={fmtD(r.production_cost_delta)}
                sub={"Redispatch only — reserves & deferral counted separately"}
                color="#22c55e" tag="ANNUAL BENEFIT (VI)" />
            )}
            {market === "emc" && (
              <MBox label={mods.arbitrage ? "CP Avoidance + Arbitrage" : "CP Avoidance"}
                value={fmtD(r.cp_avoidance_value + r.arbitrage_value)}
                sub={"CP: " + fmtD(r.cp_avoidance_value) + (mods.arbitrage ? " | Arb: " + fmtD(r.arbitrage_value) : "")}
                color="#16a34a" tag="ANNUAL BENEFIT (EMC)" />
            )}
            <MBox label="Total Value Stack" value={fmtD(r.total_value)}
              sub={"$" + r.dollars_per_kw_yr.toFixed(0) + "/kW-yr addressable"}
              color="#22c55e" tag="ANNUAL TOTAL" />
            {mods.cap_defer ? (
              <MBox label="Capital Deferral (NPV)" value={fmtD(r.capital_deferral_value)}
                sub={p.years_deferral + " yrs @ " + fmtPct(p.wacc)}
                color="#f59e0b" tag="STRUCTURAL OVERLAY" />
            ) : (
              <MBox label="—" value="—" sub="" color="#3d5068" tag="—" />
            )}
            <MBox label="Optimal Deployment" value={optimal ? optimal.mw + " MW" : "—"}
              sub={optimal ? fmtD(optimal.addressable_annual) + "/yr addressable" : ""}
              color="#a78bfa" tag="OPTIMAL MW" />
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 3, borderBottom: "1px solid #0f1c2a", marginBottom: 14, flexWrap: "wrap" }}>
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} style={TAB(tab === t.id, t.accent)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ══ TOPOLOGY LEVERAGE TAB ══ */}
          {tab === "leverage" && (
            <>
              <Panel title="The Core Insight — Why Targeted Node Deployment Beats Generic DSM" accent="#06b6d4">
                <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace", lineHeight: 1.8, marginBottom: 14 }}>
                  Traditional demand response treats MW reduction as MW reduction — 1:1 with avoided generation.
                  But in a constrained network, <span style={{ color: "#e2e8f0" }}>load at the right node has topological leverage</span>.
                  A binding constraint is a flow problem — too many MW trying to cross a limited interface.
                  Shedding load on the high-load side of that interface directly relieves the flow,
                  eliminating far more redispatch than the MW shed would suggest.
                  This is measured by the <span style={{ color: "#06b6d4" }}>Power Transfer Distribution Factor (PTDF)</span> —
                  how sensitive the constrained interface is to a 1 MW injection or withdrawal at a specific node.
                </div>

                {/* Side-by-side comparison */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <div style={{ background: "#0a0f18", border: "1px solid #ef444430", borderRadius: 6, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10, color: "#ef4444", fontFamily: "monospace", marginBottom: 8, letterSpacing: "0.1em" }}>WITHOUT TOPOLOGY TARGETING (1:1)</div>
                    <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace", lineHeight: 1.9 }}>
                      <div>Constraint requires: <span style={{ color: "#e2e8f0" }}>{p.mw_redisp} MW redispatch</span></div>
                      <div>Load shed needed: <span style={{ color: "#ef4444" }}>{(p.mw_redisp / (p.delivery_factor * p.coincidence_factor)).toFixed(1)} MW flex load</span></div>
                      <div>Production cost delta: <span style={{ color: "#ef4444" }}>{fmtD(runModel({ ...p, topology_leverage: 1 }).production_cost_delta)}</span></div>
                      <div style={{ marginTop: 6, color: "#3d5068" }}>Generic DSM — deployed anywhere, no targeting</div>
                    </div>
                  </div>
                  <div style={{ background: "#0a0f18", border: "1px solid #06b6d430", borderRadius: 6, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10, color: "#06b6d4", fontFamily: "monospace", marginBottom: 8, letterSpacing: "0.1em" }}>WITH TOPOLOGY TARGETING ({p.topology_leverage}x LEVERAGE)</div>
                    <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace", lineHeight: 1.9 }}>
                      <div>Constraint requires: <span style={{ color: "#e2e8f0" }}>{p.mw_redisp} MW redispatch equiv.</span></div>
                      <div>Load shed needed: <span style={{ color: "#06b6d4" }}>{r.mw_to_fully_relieve.toFixed(1)} MW flex load</span></div>
                      <div>Production cost delta: <span style={{ color: "#22c55e" }}>{fmtD(runModel({ ...p, mw_flex: r.mw_to_fully_relieve }).production_cost_delta)}</span></div>
                      <div style={{ marginTop: 6, color: "#3d5068" }}>GridFlex — deployed at optimal constrained node</div>
                    </div>
                  </div>
                </div>

                {/* Callout */}
                <div style={{ background: "#06b6d415", border: "1px solid #06b6d440", borderRadius: 6, padding: "12px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace", marginBottom: 4 }}>
                    AT {p.topology_leverage}x LEVERAGE — FLEX LOAD DEPLOYMENT REQUIRED TO FULLY RELIEVE CONSTRAINT
                  </div>
                  <div style={{ fontSize: 28, fontFamily: "monospace", color: "#06b6d4", fontWeight: 700 }}>
                    {(p.mw_redisp / (p.delivery_factor * p.coincidence_factor)).toFixed(0)} MW
                    <span style={{ fontSize: 16, color: "#3d5068", margin: "0 12px" }}>→</span>
                    {r.mw_to_fully_relieve.toFixed(1)} MW
                  </div>
                  <div style={{ fontSize: 11, color: "#4a7090", fontFamily: "monospace", marginTop: 4 }}>
                    {((1 - r.mw_to_fully_relieve / (p.mw_redisp / (p.delivery_factor * p.coincidence_factor))) * 100).toFixed(0)}% fewer MW needed — same constraint relief
                  </div>
                </div>
              </Panel>

              {/* Leverage comparison chart */}
              <Panel title="Leverage Effect — Value vs MW: Targeted vs Untargeted" accent="#06b6d4">
                <div style={{ fontSize: 10, color: "#3d5068", fontFamily: "monospace", marginBottom: 10 }}>
                  Green = with {p.topology_leverage}x topology leverage (targeted node). Red = no leverage (1:1, generic DSM).
                  Same MW deployed — dramatically different value because location matters.
                </div>
                <ResponsiveContainer width="100%" height={230}>
                  <ComposedChart data={levComp} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#0f1c2a" />
                    <XAxis dataKey="mw" stroke="#1e3a5a" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#7a90a8" }}
                      label={{ value: "MW Flex Load Installed", position: "insideBottom", offset: -12, fill: "#3d5068", fontSize: 10 }} />
                    <YAxis stroke="#1e3a5a" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#7a90a8" }}
                      tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "K"} />
                    <Tooltip contentStyle={{ background: "#0b1520", border: "1px solid #0f1c2a", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}
                      formatter={(v, name) => [fmtD(v), name === "with_leverage" ? p.topology_leverage + "x leverage (targeted)" : "1x — no leverage (generic DSM)"]}
                      labelFormatter={(l) => l + " MW installed"} />
                    <ReferenceLine x={r.mw_to_fully_relieve} stroke="#06b6d4" strokeWidth={1} strokeDasharray="4 2"
                      label={{ value: r.mw_to_fully_relieve.toFixed(1) + " MW full relief", position: "insideTopRight", fill: "#06b6d4", fontSize: 9, fontFamily: "monospace" }} />
                    <Area type="monotone" dataKey="with_leverage" stroke="#22c55e" fill="#22c55e15" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="no_leverage" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                  {[
                    { color: "#22c55e", label: p.topology_leverage + "x topology leverage — targeted node deployment" },
                    { color: "#ef4444", label: "1x — untargeted, generic DSM (no leverage)" },
                    { color: "#06b6d4", label: "Full constraint relief threshold" },
                  ].map((l, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#7a90a8", fontFamily: "monospace" }}>
                      <div style={{ width: 14, height: 2, background: l.color }} /> {l.label}
                    </div>
                  ))}
                </div>
              </Panel>

              {/* Leverage reference guide */}
              <Panel title="What Determines Your Leverage Multiplier — Field Reference" accent="#3b82f6">
                <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace", lineHeight: 1.8 }}>
                  {[
                    { range: "1x – 2x",   desc: "Load is electrically distant from the constraint. Generic DSM territory — not worth targeting specifically.", color: "#ef4444" },
                    { range: "2x – 5x",   desc: "Load is in the general constrained area. Modest leverage. Worth deploying if cost structure works.", color: "#f59e0b" },
                    { range: "5x – 10x",  desc: "Load is at or near the high-voltage side of the binding interface. Strong leverage. This is the target zone for GridFlex deployment.", color: "#22c55e" },
                    { range: "10x – 20x", desc: "Load sits directly on the most sensitive node relative to the constraint. Maximum leverage. Often found at substation-level load pockets directly causing interface overloads.", color: "#06b6d4" },
                  ].map((item, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 10, borderBottom: "1px solid #0a1520", paddingBottom: 8, marginBottom: 8, alignItems: "start" }}>
                      <div style={{ fontSize: 13, fontFamily: "monospace", color: item.color, fontWeight: 700 }}>{item.range}</div>
                      <div style={{ fontSize: 11, color: "#7a90a8" }}>{item.desc}</div>
                    </div>
                  ))}
                  <div style={{ marginTop: 8, fontSize: 10, color: "#3d5068", borderTop: "1px solid #0a1520", paddingTop: 8 }}>
                    In practice: leverage values are derived from PTDF matrices in the network model (PSS/E or similar).
                    For screening-grade analysis, operational experience identifying which load pockets drive
                    specific constraints is the proxy. This is the competitive moat — knowing where to look.
                  </div>
                </div>
              </Panel>
            </>
          )}

          {/* ══ FORMULA CHAIN TAB ══ */}
          {tab === "formulas" && (
            <>
              <Panel title={"Formula Sequence — " + marketMeta.label} accent="#22c55e">
                {/* Step 1 — common to all markets: dependable MW */}
                <FRow num={1} formula="MW_effective = MW_flex × Delivery × Coincidence"
                  inputs={p.mw_flex + " × " + p.delivery_factor + " × " + p.coincidence_factor}
                  result={r.mw_effective.toFixed(2) + " MW dependable shed"} color="#22c55e" />

                {/* Redispatch + curtailment chain — RTO + VI only */}
                {mods.redispatch && (<>
                  <FRow num="2★" formula="MW_redisp_equiv = MW_effective × Topology_leverage"
                    inputs={r.mw_effective.toFixed(2) + " MW × " + p.topology_leverage + "x leverage"}
                    result={r.mw_redisp_equivalent.toFixed(1) + " MW redispatch equivalent"}
                    color="#06b6d4" highlight={true} />
                  <FRow num="3★" formula="Reduction_fraction = MW_redisp_equiv / MW_redisp_required  [cap 100%]"
                    inputs={r.mw_redisp_equivalent.toFixed(1) + " ÷ " + p.mw_redisp + " required"}
                    result={fmtPct(r.reduction_fraction) + " of constraint relieved"}
                    color="#06b6d4" highlight={true} />
                  <FRow num={4} formula="E_redisp_base = MW_redisp × H_bind"
                    inputs={p.mw_redisp + " MW × " + p.h_bind + " hrs"}
                    result={fmtMWh(r.e_redisp_base)} color="#3b82f6" />
                  <FRow num={5} formula="E_redisp_saved = E_redisp_base × Reduction_fraction"
                    inputs={fmtMWh(r.e_redisp_base) + " × " + fmtPct(r.reduction_fraction)}
                    result={fmtMWh(r.e_redisp_saved)} color="#3b82f6" />
                  <FRow num={6} formula="Redispatch_value = E_redisp_saved × $/MWh_diff"
                    inputs={fmtMWh(r.e_redisp_saved) + " × $" + p.price_diff}
                    result={fmtD(r.redispatch_value)} color="#3b82f6" />
                </>)}
                {mods.curtailment && (<>
                  <FRow num={7} formula="Curtailment_attrib = MWh_curt × Attribution"
                    inputs={fmtMWh(p.mwh_curt) + " × " + fmtPct(p.curt_attrib)}
                    result={fmtMWh(r.curtailment_attrib)} color="#8b5cf6" />
                  <FRow num={8} formula="Curtailment_recovered = Attrib × Mitigation × Reduction"
                    inputs={fmtMWh(r.curtailment_attrib) + " × " + fmtPct(p.curt_mitigation) + " × " + fmtPct(r.reduction_fraction)}
                    result={fmtMWh(r.curtailment_recovered)} color="#8b5cf6" />
                  <FRow num={9} formula="Curtailment_value = Recovered × $/MWh"
                    inputs={fmtMWh(r.curtailment_recovered) + " × $" + p.curt_mwh_value}
                    result={fmtD(r.curtailment_value)} color="#8b5cf6" />
                </>)}
                {mods.redispatch && (
                  <FRow num={10} formula="Production_cost_delta = Redispatch_value + Curtailment_value"
                    inputs={fmtD(r.redispatch_value) + " + " + fmtD(r.curtailment_value)}
                    result={fmtD(r.production_cost_delta)} color="#22c55e" />
                )}

                {/* Capacity market — RTO only */}
                {mods.capacity && (
                  <FRow num="C1" formula="Capacity_value = MW_flex × $/MW-day × 365 × ELCC"
                    inputs={p.mw_flex + " MW × $" + p.capacity_price_mw_day + " × 365 × " + fmtPct(p.capacity_accreditation)}
                    result={fmtD(r.capacity_market_value)} color="#2563eb" />
                )}

                {/* CP avoidance — EMC only */}
                {mods.cp_avoid && (
                  <FRow num="P1" formula="CP_avoidance = MW × 1000 × Delivery × CP_coinc × ($G&T + $NITS)/kW-mo × 12"
                    inputs={p.mw_flex + " × 1000 × " + fmtPct(p.delivery_factor) + " × " + fmtPct(p.cp_coincidence) + " × $" + (p.cp_charge_kw_month + p.trans_charge_kw_month).toFixed(2) + "/kW-mo × 12"}
                    result={fmtD(r.cp_avoidance_value)} color="#16a34a" highlight={true} />
                )}

                {/* Energy arbitrage — RTO + EMC */}
                {mods.arbitrage && (
                  <FRow num="A1"
                    formula={market === "emc"
                      ? "Arbitrage_value = MW × Delivery × $/MWh × Hours/yr × (Duration/2h)"
                      : "Arbitrage_value = MW × Delivery × $/MWh_spread × Hours/yr"}
                    inputs={p.mw_flex + " × " + fmtPct(p.delivery_factor) + " × $" + p.arb_spread_mwh + "/MWh × " + p.arb_hours_per_year + " hrs"
                      + (market === "emc" ? " × " + (p.duration_hours || 2) + "h÷2" : "")}
                    result={fmtD(r.arbitrage_value)} color="#0ea5e9" />
                )}

                {/* Reserves — RTO + VI */}
                {mods.reserves && (
                  <FRow num={12} formula="Reserve_value = MW × 1000 × Delivery × Eligible × $/kW-yr"
                    inputs={p.mw_flex + " × 1000 × " + fmtPct(p.delivery_factor) + " × " + fmtPct(p.reserve_eligible_pct) + " × $" + p.reserve_rate_kw_yr}
                    result={fmtD(r.reserve_value) + "/yr"} color="#f97316" />
                )}

                {/* Capital deferral — all markets */}
                {mods.cap_defer && (<>
                  <FRow num={11} formula="Cap_deferral_full = CapEx × (1 − 1/(1+WACC)^Years)"
                    inputs={"$" + (p.capex / 1e6).toFixed(0) + "M × " + fmtPct(p.wacc) + " × " + p.years_deferral + " yrs"}
                    result={fmtD(r.capital_deferral_full)} color="#f59e0b" />
                  <FRow num="11b" formula={mods.redispatch ? "Cap_deferral_realized = Cap_deferral_full × Reduction_fraction" : "Cap_deferral_realized = Cap_deferral_full × min(1, MW_eff_CP / Threshold)"}
                    inputs={fmtD(r.capital_deferral_full) + " × " + fmtPct(r.deferral_realized) + " realization"}
                    result={fmtD(r.capital_deferral_value)} color="#f59e0b" highlight={true} />
                </>)}

                {/* Aggregations */}
                <FRow num="Σ1" formula="Addressable_annual = sum of recurring annual streams"
                  inputs={"PCD + Capacity + CP + Arb + Reserves"}
                  result={fmtD(r.addressable_annual) + "/yr"} color="#22c55e" />
                <FRow num="Σ2" formula="Total_value = Addressable_annual + Cap_deferral (one-time NPV)"
                  inputs={fmtD(r.addressable_annual) + " + " + fmtD(r.capital_deferral_value)}
                  result={fmtD(r.total_value)} color="#22c55e" highlight={true} />
              </Panel>
              <Panel title="Value Composition" accent="#8b5cf6">
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={barData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#0f1c2a" />
                    <XAxis dataKey="name" stroke="#1e3a5a" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#7a90a8" }} />
                    <YAxis stroke="#1e3a5a" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#7a90a8" }}
                      tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "K"} />
                    <Tooltip contentStyle={{ background: "#0b1520", border: "1px solid #0f1c2a", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}
                      formatter={(v) => [fmtD(v)]} />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                      {barData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </>
          )}

          {/* ══ OPTIMAL MW TAB ══ */}
          {tab === "optimal" && !optimal && (
            <Panel title="Optimal MW" accent="#a78bfa">
              <div style={{ color: "#3d5068", fontFamily: "monospace", fontSize: 12, padding: 20 }}>
                No optimal point found — adjust the MW Redispatch or Topology Leverage sliders to generate a sweep.
              </div>
            </Panel>
          )}
          {tab === "optimal" && optimal && (
            <>
              <Panel title={optimal.regime === "linear_value" ? "Deployment Plan — Linear-Value Market (EMC)" : "Optimal MW — Incorporating Topology Leverage"} accent="#a78bfa">
                {optimal.regime === "linear_value" && (
                  <div style={{ background: "#a78bfa12", border: "1px solid #a78bfa30", borderRadius: 5, padding: "10px 12px", marginBottom: 12, fontSize: 11, fontFamily: "monospace", color: "#7a90a8", lineHeight: 1.7 }}>
                    <span style={{ color: "#a78bfa", fontWeight: 700 }}>Linear-value regime detected.</span>{" "}
                    Marginal $/kW-yr is constant across MW (CP avoidance + arbitrage scale linearly with deployment).
                    There is no diminishing-returns optimum — the deployment ceiling is set by site availability,
                    capital, and CP-load addressable on the system. Optimal MW shown below = your current input;
                    treat as the planned pilot or program size.
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                  {[
                    mods.redispatch
                      ? { label: "MW to fully relieve constraint", value: r.mw_to_fully_relieve.toFixed(1) + " MW", sub: "at " + p.topology_leverage + "x leverage", color: "#06b6d4" }
                      : { label: "Dependable CP reduction",        value: (p.mw_flex * p.delivery_factor * p.cp_coincidence).toFixed(1) + " MW", sub: "MW × Delivery × CP coincidence", color: "#16a34a" },
                    { label: optimal.regime === "linear_value" ? "Planned deployment (= input)" : "Optimal MW (value threshold)",
                      value: optimal.mw + " MW",
                      sub: optimal.regime === "linear_value" ? "linear value — no diminishing-returns gate" : "marginal value above " + p.threshold_pct + "% of peak",
                      color: "#a78bfa" },
                    { label: "Value at optimal",               value: fmtD(optimal.addressable_annual),         sub: "annual addressable revenue", color: "#22c55e" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: "#070d14", border: "1px solid " + item.color + "30", borderLeft: "2px solid " + item.color, borderRadius: 5, padding: "10px 12px" }}>
                      <div style={{ fontSize: 9, color: "#3d5068", fontFamily: "monospace", marginBottom: 3 }}>{item.label}</div>
                      <div style={{ fontSize: 18, fontFamily: "monospace", color: item.color, fontWeight: 700 }}>{item.value}</div>
                      <div style={{ fontSize: 9, color: "#3d5068", marginTop: 2 }}>{item.sub}</div>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={230}>
                  <ComposedChart data={sweepChart} margin={{ top: 10, right: 55, left: 10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#0f1c2a" />
                    <XAxis dataKey="mw" stroke="#1e3a5a" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#7a90a8" }}
                      label={{ value: "MW Flex Load Installed", position: "insideBottom", offset: -12, fill: "#3d5068", fontSize: 10 }} />
                    <YAxis yAxisId="dollars" orientation="left" stroke="#22c55e"
                      tick={{ fontSize: 10, fontFamily: "monospace", fill: "#22c55e" }}
                      tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "K"} />
                    <YAxis yAxisId="marginal" orientation="right" stroke="#06b6d4"
                      tick={{ fontSize: 10, fontFamily: "monospace", fill: "#06b6d4" }}
                      tickFormatter={(v) => "$" + v.toFixed(0)} />
                    <Tooltip contentStyle={{ background: "#0b1520", border: "1px solid #0f1c2a", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}
                      formatter={(v, name) => ({
                        addressable_annual: [fmtD(v), "Addressable Revenue"],
                        total_value: [fmtD(v), "Total Value Stack"],
                        marginal_per_kw: ["$" + v.toFixed(0) + "/kW-yr", "Marginal Value"],
                      }[name] || [v, name])}
                      labelFormatter={(l) => l + " MW"} />
                    {p.mw_redisp > 0 && r.mw_to_fully_relieve > 0 && (
                      <ReferenceLine yAxisId="dollars" x={r.mw_to_fully_relieve} stroke="#06b6d4" strokeWidth={1} strokeDasharray="3 2"
                        label={{ value: "full relief", position: "top", fill: "#06b6d4", fontSize: 9 }} />
                    )}
                    <ReferenceLine yAxisId="dollars" x={optimal.mw} stroke="#a78bfa" strokeWidth={2} strokeDasharray="6 3"
                      label={{ value: optimal.mw + " MW OPTIMAL", position: "insideTopRight", fill: "#a78bfa", fontSize: 9 }} />
                    <ReferenceLine yAxisId="marginal" y={optimal.cutoff_value} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" />
                    <Area yAxisId="dollars" type="monotone" dataKey="addressable_annual" stroke="#22c55e" fill="#22c55e15" strokeWidth={2} dot={false} />
                    <Line yAxisId="dollars" type="monotone" dataKey="total_value" stroke="#f97316" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                    <Line yAxisId="marginal" type="monotone" dataKey="marginal_per_kw" stroke="#06b6d4" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Panel>

              {/* MW Decision Table */}
              <Panel title="MW Decision Table" accent="#3b82f6">
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1e3a5a" }}>
                        {["MW", "Redisp Equiv.", "Relief %", "Addressable Rev.", "Total Value", "Marginal $/kW-yr", "Decision"].map((h) => (
                          <th key={h} style={{ padding: "5px 8px", color: "#4a7090", fontWeight: 600, textAlign: "right", fontSize: 10 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sweep.filter((s) => s.mw % 2 === 0 || s.mw === 1).map((s, i) => {
                        const isOpt  = optimal && s.mw === optimal.mw;
                        const above  = optimal && s.marginal_per_kw >= optimal.cutoff_value;
                        const isFull = s.reduction_fraction >= 1.0;
                        const sc = isOpt ? "#a78bfa" : above ? "#22c55e" : "#ef4444";
                        const sl = isOpt ? "OPTIMAL" : isFull ? "SATURATED" : above ? "DEPLOY" : "DIMINISHING";
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid #0a1520", background: isOpt ? "#a78bfa10" : "transparent" }}>
                            <td style={{ padding: "4px 8px", color: isOpt ? "#a78bfa" : "#e2e8f0", fontWeight: isOpt ? 700 : 400, textAlign: "right" }}>{s.mw}</td>
                            <td style={{ padding: "4px 8px", color: "#06b6d4", textAlign: "right" }}>{p.mw_redisp > 0 ? Math.min(s.mw_redisp_equivalent, p.mw_redisp).toFixed(0) + " MW" : "—"}</td>
                            <td style={{ padding: "4px 8px", color: s.reduction_fraction >= 1 ? "#22c55e" : "#f59e0b", textAlign: "right" }}>{p.mw_redisp > 0 ? fmtPct(s.reduction_fraction) : "—"}</td>
                            <td style={{ padding: "4px 8px", color: "#22c55e", textAlign: "right" }}>{fmtD(s.addressable_annual)}</td>
                            <td style={{ padding: "4px 8px", color: "#f97316", textAlign: "right" }}>{fmtD(s.total_value)}</td>
                            <td style={{ padding: "4px 8px", color: above ? "#22c55e" : "#ef4444", textAlign: "right" }}>${s.marginal_per_kw.toFixed(0)}</td>
                            <td style={{ padding: "4px 8px", textAlign: "right" }}>
                              <span style={{ fontSize: 9, background: sc + "18", color: sc, border: "1px solid " + sc + "44", borderRadius: 3, padding: "2px 6px" }}>{sl}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          {/* ══ INCENTIVE TAB ══ */}
          {tab === "incentive" && (!optimal || !optIncentive) && (
            <Panel title="Incentive Model" accent="#f472b6">
              <div style={{ color: "#3d5068", fontFamily: "monospace", fontSize: 12, padding: 20 }}>
                No optimal point found — adjust the MW Redispatch or Topology Leverage sliders to generate an incentive model.
              </div>
            </Panel>
          )}
          {tab === "incentive" && optimal && optIncentive && (
            <>
              <Panel title={"Incentive Model — At Optimal " + optimal.mw + " MW Deployment"} accent="#f472b6">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
                  {[
                    market === "emc"
                      ? { label: "Enrolled Sites",   value: optIncentive.units + " sites", sub: "at " + (p.site_kw || 500) + " kW/site × " + (p.duration_hours || 2) + "h", color: "#e2e8f0" }
                      : { label: "Units Required",   value: optIncentive.units + " units", sub: "at " + p.hvac_unit_kw + " kW/unit", color: "#e2e8f0" },
                    { label: "Gross Install Cost",            value: fmtD(optIncentive.gross),       sub: "before incentives",                           color: "#ef4444" },
                    { label: "ITC Credit (" + fmtPct(p.itc_pct) + ")", value: fmtD(optIncentive.itc), sub: "48E Clean Electricity ITC — owner receives directly", color: "#22c55e" },
                    market === "emc"
                      ? { label: "No Utility Rebate", value: "—", sub: "utility rebate N/A for BESS sites", color: "#3d5068" }
                      : { label: "Utility Rebate (" + fmtPct(p.utility_incentive_pct) + ")", value: fmtD(optIncentive.rebate), sub: "funded from avoided cost pool", color: "#3b82f6" },
                    { label: "Net Cost to Owner",             value: fmtD(optIncentive.net),         sub: "after ITC",                                   color: "#f59e0b" },
                    { label: "Value Pool (" + p.contract_years + "yr)", value: fmtD(optIncentive.pool), sub: "addressable revenue × contract term",      color: "#8b5cf6" },
                  ].map((item, i) => (
                    <div key={i} style={{ background: "#070d14", border: "1px solid " + item.color + "25", borderLeft: "2px solid " + item.color, borderRadius: 5, padding: "10px 12px" }}>
                      <div style={{ fontSize: 9, color: "#2d4a63", fontFamily: "monospace", marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 15, fontFamily: "monospace", color: item.color, fontWeight: 700 }}>{item.value}</div>
                      <div style={{ fontSize: 9, color: "#3d5068", marginTop: 2 }}>{item.sub}</div>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={incentiveChart} margin={{ top: 5, right: 20, left: 10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#0f1c2a" />
                    <XAxis dataKey="mw" stroke="#1e3a5a" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#7a90a8" }}
                      label={{ value: "MW Deployed", position: "insideBottom", offset: -12, fill: "#3d5068", fontSize: 10 }} />
                    <YAxis stroke="#1e3a5a" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#7a90a8" }}
                      tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "K"} />
                    <Tooltip contentStyle={{ background: "#0b1520", border: "1px solid #0f1c2a", borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}
                      formatter={(v, name) => [fmtD(v), { gross: "Gross Cost", net: "Net Owner Cost", pool: "Utility Value Pool (8yr)" }[name] || name]}
                      labelFormatter={(l) => l + " MW"} />
                    {optimal && <ReferenceLine x={optimal.mw} stroke="#a78bfa" strokeWidth={1} strokeDasharray="4 2"
                      label={{ value: "OPTIMAL", position: "top", fill: "#a78bfa", fontSize: 9 }} />}
                    <Bar dataKey="gross" fill="#ef444422" stroke="#ef4444" strokeWidth={1} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="net"   fill="#f59e0b80" stroke="#f59e0b" strokeWidth={1} radius={[2, 2, 0, 0]} />
                    <Line type="monotone" dataKey="pool" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Panel>

              <Panel title="Self-Financing Incentive Logic" accent="#22c55e">
                {(market === "emc" ? [
                  [
                    "Step 1 — CP avoidance creates the value pool",
                    "At " + optimal.mw + " MW deployed (" + optIncentive.units + " sites), the fleet delivers " + fmtD(r.cp_avoidance_value) + "/yr in G&T demand charge avoidance. That avoided cost — paid by the cooperative to the G&T — is the funding source for the program."
                  ],
                  [
                    "Step 2 — ITC covers " + fmtPct(p.itc_pct || 0.30) + " of site cost upfront",
                    "48E Clean Electricity ITC applies to BESS equipment and installation. Site owner receives this as a tax credit reducing net capital cost from " + fmtD(optIncentive.gross) + " to " + fmtD(optIncentive.net) + "."
                  ],
                  [
                    "Step 3 — Dual-revenue contract funds GridFlex operations",
                    "GridFlex receives an NWA payment from the cooperative (funded by G&T savings) plus a share of on-site demand charge savings at each enrolled facility. Enrolled facilities contribute zero upfront capital — GridFlex owns and finances the BESS fleet."
                  ],
                  [
                    "Step 4 — The alignment",
                    "The cooperative reduces G&T costs, defers distribution upgrades, and has a single vendor. Enrolled facilities host BESS at no upfront cost and see reduced on-site demand charges. GridFlex earns from owning, operating, and verifying the fleet. The G&T savings and on-site demand reduction create the value — no party subsidizes another."
                  ],
                ] : [
                  [
                    "Step 1 — Topology targeting creates the value pool",
                    "By deploying at the optimal node (" + p.topology_leverage + "x leverage), " + optimal.mw + " MW of flex load relieves " + Math.min(r.mw_redisp_equivalent, p.mw_redisp).toFixed(0) + " MW of redispatch. Annual production cost delta = " + fmtD(optimal.production_cost_delta) + ". That's the utility's savings — and the funding source for incentives."
                  ],
                  [
                    "Step 2 — ITC covers " + fmtPct(p.itc_pct) + " of unit cost upfront",
                    "48E Clean Electricity ITC applies to equipment and installation. Building owner receives this as a tax credit. No utility budget involved."
                  ],
                  [
                    "Step 3 — Utility rebate is self-funded by avoided cost",
                    "The " + fmtPct(p.utility_incentive_pct) + " utility rebate (" + fmtD(optIncentive.rebate) + ") is funded directly from the production cost savings. Over " + p.contract_years + " years the utility value pool is " + fmtD(optIncentive.pool) + " — the rebate is a fraction of avoided cost returned to building owners."
                  ],
                  [
                    "Step 4 — Net owner cost after incentives",
                    "After ITC (" + fmtD(optIncentive.itc) + ") and utility rebate (" + fmtD(optIncentive.rebate) + "), the net cost to the building owner is " + fmtD(optIncentive.net) + " for " + optIncentive.units + " units delivering " + optimal.mw + " MW of flexible capacity."
                  ],
                  [
                    "Step 5 — The alignment",
                    "The utility saves on production cost, defers capital, and funds the rebate from avoided cost. The load owner gets upgraded flex load assets at reduced net cost. GridFlex earns from structuring and validating the engagement. No party subsidizes another — the constraint relief creates the value."
                  ],
                ]).map(([title, body], i) => (
                  <div key={i} style={{ borderBottom: "1px solid #0f1c2a", paddingBottom: 10, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#e2e8f0", fontFamily: "monospace", marginBottom: 3 }}>{title}</div>
                    <div style={{ fontSize: 10, color: "#3d5068", lineHeight: 1.7 }}>{body}</div>
                  </div>
                ))}
              </Panel>
            </>
          )}

          {/* ══ CONTRACT STRUCTURE TAB ══ */}
          {tab === "contract" && (
            <>
              {!contract ? (
                <Panel title="Contract Structure" accent="#34d399">
                  <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace" }}>Enter CP rate and MW to see contract outputs.</div>
                </Panel>
              ) : market === "emc" ? (
                <>
                  {/* EMC dual-revenue contract view */}
                  <Panel title="Revenue Stack — GridFlex Annual Income" accent="#34d399">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                      {[
                        { label: "NWA — Utility Payment", value: fmtD(contract.nwa_annual), sub: fmtPct(p.gridflex_rate_pct) + " of G&T avoided cost/yr", color: "#06b6d4" },
                        { label: "BTM Savings Share", value: fmtD(contract.gridflex_btm_revenue), sub: fmtPct(p.gridflex_btm_share_pct || 0.80) + " of facility demand savings/yr", color: "#16a34a" },
                        { label: "Service / Mgmt Fee", value: fmtD(contract.service_fee_annual), sub: "$" + (p.service_fee_kw_yr || 0) + "/kW-yr on " + (optimal?.mw || 0) + " MW enrolled", color: "#a78bfa" },
                      ].map((m) => (
                        <div key={m.label} style={{ background: "#050b12", border: "1px solid " + m.color + "33", borderLeft: "3px solid " + m.color, borderRadius: 6, padding: "12px 14px" }}>
                          <div style={{ fontSize: 9, color: m.color, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>{m.value}</div>
                          <div style={{ fontSize: 10, color: "#3d5068", marginTop: 3 }}>{m.sub}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: "#34d39910", border: "1px solid #34d39930", borderRadius: 5, padding: "10px 12px", fontSize: 11, fontFamily: "monospace" }}>
                      <span style={{ color: "#3d5068" }}>Total GridFlex annual revenue: </span>
                      <span style={{ color: "#34d399", fontWeight: 700, fontSize: 14 }}>{fmtD(contract.total_gf_revenue_annual)}</span>
                      <span style={{ color: "#3d5068" }}> = NWA {fmtD(contract.nwa_annual)} + BTM {fmtD(contract.gridflex_btm_revenue)} + Fees {fmtD(contract.service_fee_annual)}</span>
                    </div>
                  </Panel>

                  <Panel title="Capital Structure — GridFlex Balance Sheet" accent="#f59e0b">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                      {[
                        { label: "Gross BESS Capex", value: fmtD(contract.gross_capex), sub: contract.sites + " sites × $" + fmtD(Math.round(contract.gross_capex / contract.sites)) + "/site", color: "#ef4444" },
                        { label: "ITC Credit (" + fmtPct(p.itc_pct || 0.30) + ")", value: "–" + fmtD(contract.itc_credit), sub: "48E — reduces GridFlex net capex", color: "#22c55e" },
                        { label: "Facility Upfront (" + fmtPct(p.facility_upfront_pct || 0) + ")", value: "–" + fmtD(contract.facility_upfront_amount), sub: "facility contribution → lower BTM share", color: "#06b6d4" },
                        { label: "GridFlex Net Capex", value: fmtD(contract.gridflex_net_capex), sub: "amount GridFlex finances at " + fmtPct(p.debt_rate_pct || 0.08), color: "#f59e0b" },
                      ].map((m) => (
                        <div key={m.label} style={{ background: "#050b12", border: "1px solid " + m.color + "33", borderLeft: "3px solid " + m.color, borderRadius: 6, padding: "11px 13px" }}>
                          <div style={{ fontSize: 9, color: m.color, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>{m.value}</div>
                          <div style={{ fontSize: 10, color: "#3d5068", marginTop: 3 }}>{m.sub}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 5, padding: "9px 12px", fontSize: 11, fontFamily: "monospace" }}>
                      <span style={{ color: "#3d5068" }}>Annual debt service ({fmtPct(p.debt_rate_pct || 0.08)}, {p.debt_term_years || 10} yr): </span>
                      <span style={{ color: "#ef4444", fontWeight: 700 }}>{fmtD(contract.annual_debt_service)}/yr</span>
                    </div>
                  </Panel>

                  <Panel title={"GridFlex Net Margin — At Optimal " + optimal?.mw + " MW"} accent="#a78bfa">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                      {[
                        { label: "Total Revenue", value: fmtD(contract.total_gf_revenue_annual), sub: "NWA + BTM share + fees", color: "#34d399" },
                        { label: "Annual Debt Service", value: "–" + fmtD(contract.annual_debt_service), sub: fmtPct(p.debt_rate_pct || 0.08) + " × " + (p.debt_term_years || 10) + "yr on " + fmtD(contract.gridflex_net_capex), color: "#ef4444" },
                        { label: "GridFlex Net Margin", value: fmtD(contract.gf_net_margin_annual), sub: contract.gf_net_margin_annual >= 0 ? "annual after debt service" : "⚠ negative — adjust terms", color: contract.gf_net_margin_annual >= 0 ? "#a78bfa" : "#ef4444" },
                      ].map((m) => (
                        <div key={m.label} style={{ background: "#050b12", border: "1px solid " + m.color + "33", borderLeft: "3px solid " + m.color, borderRadius: 6, padding: "12px 14px" }}>
                          <div style={{ fontSize: 9, color: m.color, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>{m.value}</div>
                          <div style={{ fontSize: 10, color: "#3d5068", marginTop: 3 }}>{m.sub}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: "#3d5068", fontFamily: "monospace", marginBottom: 8 }}>CONTRACT TERM COMPARISON</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                      <thead>
                        <tr>{["Term", "Total Revenue/yr", "Debt Service/yr", "Net Margin/yr", "Cumulative Net"].map(h => (
                          <th key={h} style={{ textAlign: h === "Term" ? "left" : "right", fontSize: 9, color: "#3d5068", padding: "5px 8px", borderBottom: "1px solid #0f1c2a" }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {[3, 5, 10, 15].map(yrs => {
                          const isActive = yrs === p.contract_years;
                          return (
                            <tr key={yrs} style={{ background: isActive ? "#a78bfa10" : "transparent", borderBottom: "1px solid #0a1520" }}>
                              <td style={{ padding: "6px 8px", color: isActive ? "#a78bfa" : "#7a90a8", fontWeight: isActive ? 700 : 400 }}>{yrs} yr{isActive ? " ◀" : ""}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: "#34d399" }}>{fmtD(contract.total_gf_revenue_annual)}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: "#ef4444" }}>–{fmtD(contract.annual_debt_service)}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: contract.gf_net_margin_annual >= 0 ? "#a78bfa" : "#ef4444" }}>{fmtD(contract.gf_net_margin_annual)}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: "#f59e0b", fontWeight: 700 }}>{fmtD(contract.gf_net_margin_annual * yrs)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Panel>

                  <Panel title="Facility Economics — What the Building Owner Sees" accent="#16a34a">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                      {[
                        { label: "Upfront Contribution", value: fmtD(contract.facility_upfront_amount), sub: fmtPct(p.facility_upfront_pct || 0) + " of " + fmtD(contract.gross_capex) + " project cost", color: "#ef4444" },
                        { label: "Annual BTM Savings", value: fmtD(contract.facility_btm_savings), sub: fmtPct(1 - (p.gridflex_btm_share_pct || 0.80)) + " of demand charge reduction", color: "#16a34a" },
                        { label: "Service Fee Paid", value: "–" + fmtD(contract.service_fee_annual), sub: "$" + (p.service_fee_kw_yr || 0) + "/kW-yr to GridFlex", color: "#3d5068" },
                      ].map((m) => (
                        <div key={m.label} style={{ background: "#050b12", border: "1px solid " + m.color + "33", borderLeft: "3px solid " + m.color, borderRadius: 6, padding: "12px 14px" }}>
                          <div style={{ fontSize: 9, color: m.color, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>{m.value}</div>
                          <div style={{ fontSize: 10, color: "#3d5068", marginTop: 3 }}>{m.sub}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: "#16a34a10", border: "1px solid #16a34a30", borderRadius: 5, padding: "9px 12px", fontSize: 11, fontFamily: "monospace" }}>
                      <div style={{ color: "#3d5068", marginBottom: 3 }}>Full demand charge savings generated: <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{fmtD(contract.btm_savings_annual)}/yr</span></div>
                      <div style={{ color: "#3d5068" }}>Facility keeps <span style={{ color: "#16a34a", fontWeight: 700 }}>{fmtD(contract.facility_btm_savings)}/yr</span> — GridFlex keeps <span style={{ color: "#34d399", fontWeight: 700 }}>{fmtD(contract.gridflex_btm_revenue)}/yr</span></div>
                    </div>
                  </Panel>

                  <Panel title="Payment Flow — How the Money Moves" accent="#34d399">
                    <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace", lineHeight: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                        <div style={{ background: "#06b6d420", border: "1px solid #06b6d440", borderRadius: 4, padding: "4px 10px", color: "#06b6d4", fontSize: 10, fontWeight: 700 }}>EMC</div>
                        <div style={{ color: "#34d399", fontSize: 10 }}>── NWA {fmtD(contract.nwa_annual)}/yr ──▶</div>
                        <div style={{ background: "#34d39920", border: "1px solid #34d39940", borderRadius: 4, padding: "4px 10px", color: "#34d399", fontSize: 10, fontWeight: 700 }}>GRIDFLEX</div>
                        <div style={{ color: "#16a34a", fontSize: 10 }}>◀── BTM {fmtD(contract.gridflex_btm_revenue)}/yr + Fee {fmtD(contract.service_fee_annual)}/yr ──</div>
                        <div style={{ background: "#16a34a20", border: "1px solid #16a34a40", borderRadius: 4, padding: "4px 10px", color: "#16a34a", fontSize: 10, fontWeight: 700 }}>FACILITIES</div>
                      </div>
                      <div style={{ fontSize: 10, color: "#3d5068", lineHeight: 1.8, borderTop: "1px solid #0f1c2a", paddingTop: 8 }}>
                        <div>• EMC pays GridFlex for G&T demand savings it actually realizes — no upfront program cost.</div>
                        <div>• Facilities pay GridFlex a service fee and share BTM savings; receive the BESS at no upfront hardware cost (unless contributing equity).</div>
                        <div>• GridFlex nets {fmtD(contract.gf_net_margin_annual)}/yr after debt service — {fmtD(contract.total_contract)} over the {p.contract_years}-yr term.</div>
                        <div>• EMC retains {fmtD(contract.utility_net_annual)}/yr in net G&T savings vs. absorbing full demand charge drag.</div>
                      </div>
                    </div>
                  </Panel>
                </>
              ) : (
                <>
                  {/* RTO / VI original contract view */}
                  <Panel title="NWA Contract — Rate Structure" accent="#34d399">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                      {[
                        { label: "Utility Avoided Cost", value: "$" + Math.round(contract.avoided_kw_yr) + "/kW-yr", sub: "production cost delta at optimal MW", color: "#06b6d4" },
                        { label: "GridFlex Contract Rate", value: "$" + Math.round(contract.gridflex_rate_kw_yr) + "/kW-yr", sub: fmtPct(p.gridflex_rate_pct) + " of avoided cost", color: "#34d399" },
                        { label: "Utility Net Savings", value: "$" + Math.round(contract.utility_net_kw_yr) + "/kW-yr", sub: "retained by utility vs. building wire", color: "#a78bfa" },
                      ].map((m) => (
                        <div key={m.label} style={{ background: "#050b12", border: "1px solid " + m.color + "33", borderLeft: "3px solid " + m.color, borderRadius: 6, padding: "12px 14px" }}>
                          <div style={{ fontSize: 9, color: m.color, fontFamily: "monospace", letterSpacing: "0.12em", marginBottom: 6 }}>{m.label}</div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>{m.value}</div>
                          <div style={{ fontSize: 10, color: "#3d5068", marginTop: 4 }}>{m.sub}</div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                  <Panel title={"GridFlex Economics — At Optimal " + optimal?.mw + " MW"} accent="#34d399">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                      {[
                        { label: "Gross Contract Revenue", value: fmtD(contract.gridflex_annual), sub: "annual — paid by utility", color: "#34d399" },
                        { label: "Facility Incentive Out", value: fmtD(contract.facility_annual), sub: "$" + p.facility_incentive_kw_yr + "/kW-yr bill credit", color: "#f472b6" },
                        { label: "GridFlex Net Margin", value: fmtD(contract.margin_annual), sub: "annual after facility payments", color: "#a78bfa" },
                        { label: "Total Contract Value", value: fmtD(contract.total_contract), sub: p.contract_years + "-year term", color: "#f59e0b" },
                      ].map((m) => (
                        <div key={m.label} style={{ background: "#050b12", border: "1px solid " + m.color + "33", borderLeft: "3px solid " + m.color, borderRadius: 6, padding: "12px 14px" }}>
                          <div style={{ fontSize: 9, color: m.color, fontFamily: "monospace", letterSpacing: "0.12em", marginBottom: 6 }}>{m.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>{m.value}</div>
                          <div style={{ fontSize: 10, color: "#3d5068", marginTop: 4 }}>{m.sub}</div>
                        </div>
                      ))}
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                      <thead><tr>{["Term", "GF Gross/yr", "Facility Out/yr", "GF Margin/yr", "Cumulative"].map(h => (
                        <th key={h} style={{ textAlign: h === "Term" ? "left" : "right", fontSize: 9, color: "#3d5068", padding: "5px 8px", borderBottom: "1px solid #0f1c2a" }}>{h}</th>
                      ))}</tr></thead>
                      <tbody>{[3, 5, 10].map(yrs => {
                        const isActive = yrs === p.contract_years;
                        return (
                          <tr key={yrs} style={{ background: isActive ? "#34d39910" : "transparent", borderBottom: "1px solid #0a1520" }}>
                            <td style={{ padding: "6px 8px", color: isActive ? "#34d399" : "#7a90a8", fontWeight: isActive ? 700 : 400 }}>{yrs} yr{isActive ? " ◀" : ""}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: "#e2e8f0" }}>{fmtD(contract.gridflex_annual)}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: "#f472b6" }}>{fmtD(contract.facility_annual)}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: "#a78bfa" }}>{fmtD(contract.margin_annual)}</td>
                            <td style={{ padding: "6px 8px", textAlign: "right", color: "#f59e0b", fontWeight: 700 }}>{fmtD(contract.margin_annual * yrs)}</td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </Panel>
                </>
              )}
            </>
          )}

          {/* ══ ASSUMPTIONS TAB ══ */}
          {tab === "assumptions" && (
            <Panel title="Key Assumptions — What Would Break This Model" accent="#ef4444">
              {[
                mods.redispatch && {
                  a: "Topology leverage = " + p.topology_leverage + "x",
                  note: "Most critical assumption in the model. A " + p.topology_leverage + "x leverage means 1 MW of load shed at the target node relieves " + p.topology_leverage + " MW of redispatch. MUST be validated against actual PTDF data from the network model (PSS/E or similar) before presenting to a utility as anything more than screening-grade. Operational experience identifying the right node is the proxy at this stage — label it explicitly."
                },
                mods.redispatch && {
                  a: "Reduction fraction = " + fmtPct(r.reduction_fraction),
                  note: r.reduction_fraction > 0.7
                    ? "HIGH — the model assumes proportional relief up to 100%. Real topology may be nonlinear — small MW increments near the constraint boundary can have outsized or undersized effects. Validate with contingency modeling before committing to a utility."
                    : "Within credible screening range. Label as engineering estimate pending contingency model validation."
                },
                {
                  a: "Delivery factor = " + fmtPct(p.delivery_factor) + (mods.redispatch ? " | Coincidence factor = " + fmtPct(p.coincidence_factor) : " | CP coincidence = " + fmtPct(p.cp_coincidence)),
                  note: "Delivery factor derates ALL revenue streams that depend on dispatchable performance: reserves, CP avoidance, arbitrage. NERC/PJM ancillary products carry non-performance penalties — using nameplate would overstate value. ELCC accreditation already encodes resource adequacy contribution for capacity revenue, so capacity is not double-derated by delivery."
                },
                mods.redispatch && {
                  a: "Coincidence factor direction",
                  note: "This parameter is the fraction of binding hours where flex is operational and dispatchable, NOT the fraction of flex hours that overlap binding. Direction matters: night-shift load with no overlap = 0%; matched-shift with full availability = 100%."
                },
                mods.curtailment && {
                  a: "Curtailment attribution = " + fmtPct(p.curt_attrib),
                  note: "Requires constraint logs to validate. The share of zone curtailment caused by this specific constraint varies widely. Engineering estimate is acceptable at screening grade — label it explicitly in any utility presentation and flag it as field-validatable from ISO/RTO curtailment records."
                },
                mods.redispatch && {
                  a: "Redispatch differential = $" + p.price_diff + "/MWh",
                  note: "Validate against actual out-of-merit dispatch records or ISO/RTO public data (OASIS, MISO public reports) for the specific constraint zone. This number can vary significantly by season, time of day, and generation mix. Present as a range."
                },
                mods.cap_defer && {
                  a: "Capital deferral realization = " + fmtPct(r.deferral_realized),
                  note: (mods.redispatch
                    ? "Scaled by constraint relief (reduction fraction). At full relief, full NPV; at partial relief, linear approximation. Real deferral is often binary — the project either moves out or it doesn't. Use this as a screening-grade estimate; firm it up with the utility's own load-growth + planning data."
                    : "Scaled by CP-coincident MW vs. " + p.mw_deferral_threshold + " MW threshold. Distribution upgrades are deferred when peak load is held below the equipment rating's growth crossing. Validate the threshold against the coop's own planning study.")
                },
                mods.cap_defer && {
                  a: "Capital deferral years = " + p.years_deferral + " year" + (p.years_deferral > 1 ? "s" : ""),
                  note: "Load growth uncertainty is high. A 1-year error shifts NPV materially. Deferral timing depends on load growth trajectory, coincident peak trends, and utility planning assumptions — all sourced from the utility's own IRP or capital plan. Present as a sensitivity range."
                },
                mods.capacity && {
                  a: "Capacity ELCC = " + fmtPct(p.capacity_accreditation),
                  note: "ELCC reflects the resource adequacy contribution of the flex load. PJM's published ELCC class accreditations for summer-peaking DR are typically 50–70%. Penalty exposure for non-performance is NOT in this revenue line — that's a separate risk overlay."
                },
              ].filter(Boolean).map((item, i) => (
                <div key={i} style={{ borderBottom: "1px solid #0f1c2a", paddingBottom: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#e2e8f0", fontFamily: "monospace", marginBottom: 3 }}>{item.a}</div>
                  <div style={{ fontSize: 10, color: "#3d5068", lineHeight: 1.7 }}>{item.note}</div>
                </div>
              ))}
            </Panel>
          )}

        </div>
      </div>
    </div>
  );
}
