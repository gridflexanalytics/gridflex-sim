import { useState, useMemo } from "react";
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, BarChart, Bar, Cell,
  ComposedChart, Area,
} from "recharts";

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  // Module 2 — Base Case
  h_bind: 320,
  mw_redisp: 100,
  price_diff: 55,
  mwh_curt: 45000,
  curt_attrib: 0.35,
  curt_mwh_value: 48,
  // Module 3 — Topology Leverage
  topology_leverage: 8,
  // Module 4 — Intervention
  mw_flex: 10,
  delivery_factor: 0.70,
  coincidence_factor: 0.80,
  curt_mitigation: 0.45,
  // Module 6 — Capital Deferral
  capex: 28000000,
  wacc: 0.07,
  years_deferral: 3,
  // Module 7 — Building Incentive
  hvac_unit_cost: 45000,
  hvac_unit_kw: 15,
  itc_pct: 0.35,
  utility_incentive_pct: 0.20,
  // Optimal MW threshold
  threshold_pct: 20,
  // Module 5 — Dispatch Timing
  forecast_peak_hour: 15,
  window_hours: 2,
  // Module 8 — Contract Structure
  contract_years: 5,
  gridflex_rate_pct: 0.70,
  facility_incentive_kw_yr: 50,
};

// ── Model ─────────────────────────────────────────────────────────────────────

function runModel(p) {
  const mw_effective = p.mw_flex * p.delivery_factor * p.coincidence_factor;
  const mw_redisp_equivalent = mw_effective * p.topology_leverage;
  const reduction_fraction = p.mw_redisp > 0
    ? Math.min(mw_redisp_equivalent / p.mw_redisp, 1.0)
    : 0;
  const leverageDenom = p.topology_leverage * p.delivery_factor * p.coincidence_factor;
  const mw_to_fully_relieve = leverageDenom > 0
    ? p.mw_redisp / leverageDenom
    : 0;

  const e_redisp_base = p.mw_redisp * p.h_bind;
  const e_redisp_saved = e_redisp_base * reduction_fraction;
  const redispatch_value = e_redisp_saved * p.price_diff;

  const curtailment_attrib = p.mwh_curt * p.curt_attrib;
  const curtailment_recovered = curtailment_attrib * p.curt_mitigation * reduction_fraction;
  const curtailment_value = curtailment_recovered * p.curt_mwh_value;

  const production_cost_delta = redispatch_value + curtailment_value;
  const capital_deferral_value =
    p.capex * (1 - 1 / Math.pow(1 + p.wacc, p.years_deferral));
  const total_value = production_cost_delta + capital_deferral_value;
  const dollars_per_kw_yr =
    p.mw_flex > 0 ? production_cost_delta / (p.mw_flex * 1000) : 0;

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
    capital_deferral_value,
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
      const delta_val = r.production_cost_delta - prevR.production_cost_delta;
      marginal_per_kw = delta_kw > 0 ? delta_val / delta_kw : 0;
    }
    return {
      mw,
      production_cost_delta: r.production_cost_delta,
      total_value: r.total_value,
      dollars_per_kw_yr: r.dollars_per_kw_yr,
      marginal_per_kw: Math.max(0, marginal_per_kw),
      reduction_fraction: r.reduction_fraction,
      mw_redisp_equivalent: r.mw_redisp_equivalent,
    };
  });
}

function findOptimal(sweep, threshold_pct) {
  if (!sweep.length) return null;
  const peakMarginal = sweep[0].marginal_per_kw;
  const cutoff = peakMarginal * (threshold_pct / 100);
  let optimal = sweep[0];
  for (let i = 1; i < sweep.length; i++) {
    if (sweep[i].marginal_per_kw >= cutoff) optimal = sweep[i];
    else break;
  }
  return { ...optimal, cutoff_value: cutoff, peak_marginal: peakMarginal };
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
  return sweep.map((s) => {
    const units = p.hvac_unit_kw > 0 ? Math.max(1, Math.ceil((s.mw * 1000) / p.hvac_unit_kw)) : 1;
    const gross = units * p.hvac_unit_cost;
    const itc = gross * p.itc_pct;
    const rebate = gross * p.utility_incentive_pct;
    const net = gross - itc - rebate;
    const pool = s.production_cost_delta * 8;
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

function Panel({ title, accent, children, badge }) {
  return (
    <div style={{ background: "#0b1520", border: "1px solid #0f1c2a", borderTop: "2px solid " + (accent || "#1e3a5a"), borderRadius: 8, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #0f1c2a" }}>
        <div style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: "0.12em", color: accent || "#3b82f6", textTransform: "uppercase" }}>{title}</div>
        {badge && <div style={{ fontSize: 9, fontFamily: "monospace", color: badge.color, background: badge.color + "18", border: "1px solid " + badge.color + "44", borderRadius: 3, padding: "2px 7px" }}>{badge.text}</div>}
      </div>
      {children}
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
  const [p, setP] = useState(DEFAULTS);
  const [tab, setTab] = useState("leverage");
  const [utilityName, setUtilityName] = useState("");
  const set = (k) => (v) => setP((prev) => ({ ...prev, [k]: v }));

  const r = useMemo(() => runModel(p), [p]);
  const sweep = useMemo(() => computeSweep(p), [p]);
  const optimal = useMemo(() => findOptimal(sweep, p.threshold_pct), [sweep, p.threshold_pct]);
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
    const facility_kw_yr = p.facility_incentive_kw_yr;
    const margin_kw_yr = gridflex_rate_kw_yr - facility_kw_yr;
    const gridflex_annual = optMW_kw * gridflex_rate_kw_yr;
    const facility_annual = optMW_kw * facility_kw_yr;
    const margin_annual = gridflex_annual - facility_annual;
    const utility_net_kw_yr = avoided_kw_yr - gridflex_rate_kw_yr;
    const utility_net_annual = optMW_kw * utility_net_kw_yr;
    const rim_pass = gridflex_rate_kw_yr < avoided_kw_yr;
    return {
      avoided_kw_yr, gridflex_rate_kw_yr, facility_kw_yr, margin_kw_yr,
      gridflex_annual, facility_annual, margin_annual,
      utility_net_kw_yr, utility_net_annual, rim_pass,
      total_3yr: margin_annual * 3,
      total_5yr: margin_annual * 5,
      total_10yr: margin_annual * 10,
      total_contract: margin_annual * p.contract_years,
    };
  }, [optimal, p.gridflex_rate_pct, p.facility_incentive_kw_yr, p.contract_years]);

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

  <div class="title">Constraint Relief via Topology-Targeted Flex Load</div>
  <div class="subtitle">Production Cost Delta Analysis &amp; Engagement Proposal</div>

  <div class="highlight-box">
    <div class="hl-label">The Core Concept</div>
    <div class="hl-text">
      At the right node on the network, 1 MW of flexible load shed can relieve <strong>${p.topology_leverage}x</strong> more redispatch than it would at an untargeted location — because of its Power Transfer Distribution Factor (PTDF) relative to the binding constraint.
      GridFlex identifies these nodes, quantifies the production cost delta, and structures the engagement so the utility's own avoided costs fund the program.
    </div>
  </div>

  <div class="section">
    <div class="section-head">The Constraint — What It's Costing You Today</div>
    <div class="grid3">
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
    </div>
    <div style="margin-top:10px;">
      <table>
        <tr><th>Cost Component</th><th style="text-align:right;">Annual Cost</th></tr>
        <tr><td class="td-label">Redispatch (out-of-merit dispatch cost)</td><td class="td-value">${eRedisp}</td></tr>
        <tr><td class="td-label">Attributable curtailment losses (${Math.round(p.curt_attrib * 100)}% attribution)</td><td class="td-value">${eCurt}</td></tr>
        <tr style="background:#fef2f2;"><td class="td-label" style="font-weight:600;">Total Annual Production Cost Drag</td><td class="td-value" style="color:#dc2626;">${eTotalDrag}</td></tr>
      </table>
    </div>
  </div>

  <div class="section">
    <div class="section-head">The GridFlex Approach — Topology Leverage</div>
    <div class="grid3">
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
    </div>
  </div>

  <div class="section">
    <div class="section-head">Dispatch Protocol — BA Forecast-Based Thermal Pre-cool</div>
    <div class="grid3">
      <div class="card amber">
        <div class="card-label">Forecast Peak</div>
        <div class="card-value">${fmtHour(p.forecast_peak_hour)}</div>
        <div class="card-sub">BA daily load forecast peak</div>
      </div>
      <div class="card blue">
        <div class="card-label">Pre-cool Window</div>
        <div class="card-value">${fmtHour(p.forecast_peak_hour - p.window_hours)} – ${fmtHour(p.forecast_peak_hour)}</div>
        <div class="card-sub">thermal storage charges; compressor at full load</div>
      </div>
      <div class="card green">
        <div class="card-label">Dispatch Window</div>
        <div class="card-value">${fmtHour(p.forecast_peak_hour)} – ${fmtHour(p.forecast_peak_hour + p.window_hours)}</div>
        <div class="card-sub">near-zero electrical draw; cooling from stored thermal mass</div>
      </div>
    </div>
    <div style="font-size:11px; color:#475569; margin-top:10px; line-height:1.7;">
      Each morning, the operator pulls the BA load forecast, identifies the expected peak hour, and sets the dispatch schedule.
      Units pre-cool during the charge window — storing thermal energy in the Blue Frontier desiccant system.
      During the dispatch window, the compressor runs at minimal load while the building is cooled from stored thermal mass, delivering near-zero electrical demand precisely coincident with the constraint binding window.
      Signal delivery: OpenADR automated dispatch or manual schedule. Peak timing is consistent day-to-day but forecast-confirmed each morning for maximum value capture.
    </div>
  </div>

  <div class="section">
    <div class="section-head">Full Value Stack — At Optimal ${optMW} MW Deployment</div>
    <table>
      <tr><th>Value Component</th><th style="text-align:right;">Annual Value</th></tr>
      <tr><td class="td-label">Production cost delta (redispatch savings)</td><td class="td-value">${fmtD(optimal ? optimal.production_cost_delta : r.production_cost_delta)}</td></tr>
      <tr><td class="td-label">Capital deferral — NPV of ${p.years_deferral}-year delay on $${(p.capex / 1e6).toFixed(0)}M project (${Math.round(p.wacc * 100)}% WACC)</td><td class="td-value">${fmtD(r.capital_deferral_value)}</td></tr>
      <tr style="background:#f0fdf4;"><td class="td-label" style="font-weight:600;">Total Value Stack</td><td class="td-value" style="color:#16a34a;">${optTotal}</td></tr>
    </table>
  </div>

  <div class="poc-box">
    <div class="poc-label">Proof of Concept Proposal — ${pocMW} MW Pilot</div>
    <div class="poc-text">
      GridFlex proposes a <strong>${pocMW} MW flex load pilot</strong> at the highest-leverage node in the constraint corridor.
      At ${p.topology_leverage}x topology leverage, this delivers <strong>${(pocMW * p.delivery_factor * p.coincidence_factor * p.topology_leverage).toFixed(1)} MW of redispatch equivalent</strong> — enough to produce a measurable, auditable production cost delta of approximately <strong>${fmtD(pocR.production_cost_delta)} per year</strong>.
      Results are validated against actual EMS dispatch logs and ISO/RTO public data. If the pilot validates, Phase 2 scales to the full ${optMW} MW optimal deployment.
    </div>
  </div>

  <div class="section">
    <div class="section-head">Contract Structure — ${p.contract_years}-Year NWA Agreement</div>
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
  </div>

  <div class="section">
    <div class="section-head">Assumptions &amp; Validation Notes</div>
    <div style="font-size:11px; color:#475569; line-height:1.8;">
      Topology leverage factor (${p.topology_leverage}x) requires validation against network PTDF data for the specific constraint corridor.
      Price differential ($${p.price_diff}/MWh) and binding hours (${p.h_bind} hrs/year) should be confirmed from OASIS data or utility dispatch records.
      Capital deferral timing assumes ${p.years_deferral}-year load growth trajectory per utility IRP.
      All values presented as analytical estimates pending data confirmation in Phase 1.
    </div>
  </div>

  <div class="footer">
    <div class="footer-left">
      <strong>Joshua Yackee</strong><br/>
      GridFlex Analytics<br/>
      scgssolutions@gmail.com<br/>
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
    { name: "Redispatch",  value: r.redispatch_value,       color: "#3b82f6" },
    { name: "Curtailment", value: r.curtailment_value,      color: "#8b5cf6" },
    { name: "Cap Deferral",value: r.capital_deferral_value, color: "#f59e0b" },
    { name: "TOTAL",       value: r.total_value,            color: "#f97316" },
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
          <div style={{ fontSize: 11, color: "#7a90a8" }}>
            {p.mw_flex} MW flex load shed × {p.topology_leverage}x leverage = {(p.mw_flex * p.delivery_factor * p.coincidence_factor * p.topology_leverage).toFixed(1)} MW redispatch equivalent —
            fully relieves constraint at <span style={{ color: "#06b6d4" }}>{r.mw_to_fully_relieve.toFixed(1)} MW installed</span>
          </div>
          <div style={{ fontSize: 10, fontFamily: "monospace", color: confColor, background: confColor + "15", border: "1px solid " + confColor + "40", borderRadius: 4, padding: "2px 8px" }}>
            {r.reduction_fraction >= 1.0 ? "CONSTRAINT FULLY RELIEVED" : fmtPct(r.reduction_fraction) + " CONSTRAINT RELIEVED"}
          </div>
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
            style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.08em", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}
          >
            GENERATE ONE-PAGER ↗
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "305px 1fr", gap: 15, padding: 15, maxWidth: 1380, margin: "0 auto" }}>

        {/* ── LEFT: INPUTS ── */}
        <div>

          {/* Module 3 — Topology Leverage */}
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

          {/* Module 2 — Base Case */}
          <Panel title="Module 2 — Base Case (Constrained)" accent="#3b82f6">
            <Slider label="Redispatch Required to Relieve Constraint" value={p.mw_redisp}
              display={p.mw_redisp + " MW"} onChange={set("mw_redisp")} min={1} max={500} step={5}
              note="Total MW of generation redispatch needed WITHOUT flexible load" />
            <Slider label="Binding Hours / Year" value={p.h_bind} display={p.h_bind + " hrs"}
              onChange={set("h_bind")} min={50} max={2000} step={10} note="Hours/yr constraint actually binds" />
            <Slider label="Redispatch Price Differential" value={p.price_diff} display={"$" + p.price_diff + "/MWh"}
              onChange={set("price_diff")} min={10} max={150} step={1} note="Cost gap: constrained gen vs. substitute gen" />
            <Slider label="Total Zone Curtailment" value={p.mwh_curt} display={(p.mwh_curt / 1000).toFixed(0) + "K MWh"}
              onChange={set("mwh_curt")} min={1000} max={500000} step={1000} note="Annual curtailment in zone" />
            <Slider label="Curtailment Attribution" value={p.curt_attrib} display={fmtPct(p.curt_attrib)}
              onChange={set("curt_attrib")} min={0.05} max={1.0} step={0.05} note="Share caused by this constraint" />
            <Slider label="Curtailed Energy Value" value={p.curt_mwh_value} display={"$" + p.curt_mwh_value + "/MWh"}
              onChange={set("curt_mwh_value")} min={10} max={120} step={1} note="Marginal value of recovered energy" />
          </Panel>

          {/* Module 4 — Flex Load Intervention */}
          <Panel title="Module 4 — Flex Load Intervention" accent="#8b5cf6">
            <Slider label="Installed Flexible Load" value={p.mw_flex} display={p.mw_flex + " MW"}
              onChange={set("mw_flex")} min={1} max={100} step={1}
              note={"MW of flex load at target node (" + r.mw_to_fully_relieve.toFixed(1) + " MW fully relieves constraint)"} />
            <Slider label="Delivery Factor" value={p.delivery_factor} display={fmtPct(p.delivery_factor)}
              onChange={set("delivery_factor")} min={0.3} max={1.0} step={0.05} note="Probability load responds when dispatched" />
            <Slider label="Coincidence Factor" value={p.coincidence_factor} display={fmtPct(p.coincidence_factor)}
              onChange={set("coincidence_factor")} min={0.2} max={1.0} step={0.05} note="Overlap of flex hours with constraint hours" />
            <Slider label="Curtailment Mitigation" value={p.curt_mitigation} display={fmtPct(p.curt_mitigation)}
              onChange={set("curt_mitigation")} min={0.05} max={1.0} step={0.05} note="Share of attributed curtailment recoverable" />
          </Panel>

          {/* Module 5 — Dispatch Timing */}
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
              Coincidence factor ({fmtPct(p.coincidence_factor)}) reflects how often this dispatch window overlaps with actual binding hours.
              Set higher when BA forecast is reliable and peak timing is consistent day-to-day.
            </div>
          </Panel>

          {/* Module 6 — Capital Deferral */}
          <Panel title="Module 6 — Capital Deferral" accent="#f59e0b">
            <Slider label="Infrastructure Project Cost" value={p.capex / 1e6} display={"$" + (p.capex / 1e6).toFixed(0) + "M"}
              onChange={(v) => set("capex")(v * 1e6)} min={1} max={200} step={1} note="Substation / feeder / interface upgrade cost" />
            <Slider label="WACC" value={p.wacc} display={fmtPct(p.wacc)}
              onChange={set("wacc")} min={0.03} max={0.12} step={0.005} note="Utility weighted average cost of capital" />
            <Slider label="Deferral Years" value={p.years_deferral} display={p.years_deferral + " yrs"}
              onChange={set("years_deferral")} min={1} max={10} step={1} note="Years the upgrade can be delayed" />
          </Panel>

          {/* Module 7 — Building Incentive */}
          <Panel title="Module 7 — Flex Load Incentive" accent="#f472b6">
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
          </Panel>

          {/* Module 8 — Contract Structure */}
          <Panel title="Module 8 — Contract Structure" accent="#34d399" badge={{ text: "NWA CONTRACT", color: "#34d399" }}>
            <Slider label="Contract Term" value={p.contract_years} display={p.contract_years + " yrs"}
              onChange={set("contract_years")} min={3} max={10} step={1} note="NWA contract length — longer term justifies higher rate" />
            <Slider label="GridFlex Rate (% of avoided cost)" value={p.gridflex_rate_pct} display={fmtPct(p.gridflex_rate_pct)}
              onChange={set("gridflex_rate_pct")} min={0.40} max={0.85} step={0.05} note="Utility pays GridFlex this share — utility keeps the rest as net savings" />
            <Slider label="Facility Incentive ($/kW-yr)" value={p.facility_incentive_kw_yr} display={"$" + p.facility_incentive_kw_yr + "/kW-yr"}
              onChange={set("facility_incentive_kw_yr")} min={10} max={100} step={5} note="Monthly bill credit to facility — funded from GridFlex contract revenue" />
          </Panel>

        </div>

        {/* ── RIGHT: RESULTS ── */}
        <div>

          {/* Summary metric row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 9, marginBottom: 14 }}>
            <MBox label="Redispatch Equiv." value={Math.min(r.mw_redisp_equivalent, p.mw_redisp).toFixed(1) + " MW"}
              sub={r.mw_effective.toFixed(1) + " MW shed × " + p.topology_leverage + "x leverage"}
              color="#06b6d4" tag="TOPOLOGY OUTPUT" />
            <MBox label="Constraint Relieved" value={fmtPct(r.reduction_fraction)}
              sub={"Fully relieved at " + r.mw_to_fully_relieve.toFixed(1) + " MW installed"}
              color={r.reduction_fraction >= 1.0 ? "#22c55e" : "#f59e0b"} tag="RELIEF FRACTION" />
            <MBox label="Production Cost Delta" value={fmtD(r.production_cost_delta)}
              sub={"Redisp: " + fmtD(r.redispatch_value) + " | Curt: " + fmtD(r.curtailment_value)}
              color="#22c55e" tag="ANNUAL BENEFIT" />
            <MBox label="Capital Deferral (NPV)" value={fmtD(r.capital_deferral_value)}
              sub={p.years_deferral + " yrs @ " + fmtPct(p.wacc)}
              color="#f59e0b" tag="STRUCTURAL OVERLAY" />
            <MBox label="Optimal Deployment" value={optimal ? optimal.mw + " MW" : "—"}
              sub={optimal ? fmtD(optimal.production_cost_delta) + "/yr" : ""}
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
              <Panel title="Formula Sequence — With Topology Leverage" accent="#22c55e">
                <FRow num={1} formula="MW_effective = MW_flex × Delivery × Coincidence"
                  inputs={p.mw_flex + " × " + p.delivery_factor + " × " + p.coincidence_factor}
                  result={r.mw_effective.toFixed(2) + " MW dependable shed"} color="#22c55e" />
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
                <FRow num={7} formula="Curtailment_attrib = MWh_curt × Attribution"
                  inputs={fmtMWh(p.mwh_curt) + " × " + fmtPct(p.curt_attrib)}
                  result={fmtMWh(r.curtailment_attrib)} color="#8b5cf6" />
                <FRow num={8} formula="Curtailment_recovered = Attrib × Mitigation × Reduction"
                  inputs={fmtMWh(r.curtailment_attrib) + " × " + fmtPct(p.curt_mitigation) + " × " + fmtPct(r.reduction_fraction)}
                  result={fmtMWh(r.curtailment_recovered)} color="#8b5cf6" />
                <FRow num={9} formula="Curtailment_value = Recovered × $/MWh"
                  inputs={fmtMWh(r.curtailment_recovered) + " × $" + p.curt_mwh_value}
                  result={fmtD(r.curtailment_value)} color="#8b5cf6" />
                <FRow num={10} formula="Production_cost_delta = Redispatch_value + Curtailment_value"
                  inputs={fmtD(r.redispatch_value) + " + " + fmtD(r.curtailment_value)}
                  result={fmtD(r.production_cost_delta)} color="#22c55e" />
                <FRow num={11} formula="Capital_deferral = CapEx × (1 − 1/(1+WACC)^Years)"
                  inputs={"$" + (p.capex / 1e6).toFixed(0) + "M × " + fmtPct(p.wacc) + " × " + p.years_deferral + " yrs"}
                  result={fmtD(r.capital_deferral_value)} color="#f59e0b" />
                <FRow num={12} formula="Total_value = Production_cost_delta + Capital_deferral"
                  inputs={fmtD(r.production_cost_delta) + " + " + fmtD(r.capital_deferral_value)}
                  result={fmtD(r.total_value)} color="#f97316" />
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
              <Panel title="Optimal MW — Incorporating Topology Leverage" accent="#a78bfa">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                  {[
                    { label: "MW to fully relieve constraint", value: r.mw_to_fully_relieve.toFixed(1) + " MW", sub: "at " + p.topology_leverage + "x leverage", color: "#06b6d4" },
                    { label: "Optimal MW (value threshold)",   value: optimal.mw + " MW",                      sub: "marginal value above " + p.threshold_pct + "% of peak", color: "#a78bfa" },
                    { label: "Value at optimal",               value: fmtD(optimal.production_cost_delta),     sub: "annual production cost delta", color: "#22c55e" },
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
                        production_cost_delta: [fmtD(v), "Production Cost Delta"],
                        total_value: [fmtD(v), "Total Value Stack"],
                        marginal_per_kw: ["$" + v.toFixed(0) + "/kW-yr", "Marginal Value"],
                      }[name] || [v, name])}
                      labelFormatter={(l) => l + " MW"} />
                    <ReferenceLine yAxisId="dollars" x={r.mw_to_fully_relieve} stroke="#06b6d4" strokeWidth={1} strokeDasharray="3 2"
                      label={{ value: "full relief", position: "top", fill: "#06b6d4", fontSize: 9 }} />
                    <ReferenceLine yAxisId="dollars" x={optimal.mw} stroke="#a78bfa" strokeWidth={2} strokeDasharray="6 3"
                      label={{ value: optimal.mw + " MW OPTIMAL", position: "insideTopRight", fill: "#a78bfa", fontSize: 9 }} />
                    <ReferenceLine yAxisId="marginal" y={optimal.cutoff_value} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 2" />
                    <Area yAxisId="dollars" type="monotone" dataKey="production_cost_delta" stroke="#22c55e" fill="#22c55e15" strokeWidth={2} dot={false} />
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
                        {["MW", "Redisp Equiv.", "Relief %", "Prod. Cost Delta", "Total Value", "Marginal $/kW-yr", "Decision"].map((h) => (
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
                            <td style={{ padding: "4px 8px", color: "#06b6d4", textAlign: "right" }}>{Math.min(s.mw_redisp_equivalent, p.mw_redisp).toFixed(0)} MW</td>
                            <td style={{ padding: "4px 8px", color: s.reduction_fraction >= 1 ? "#22c55e" : "#f59e0b", textAlign: "right" }}>{fmtPct(s.reduction_fraction)}</td>
                            <td style={{ padding: "4px 8px", color: "#22c55e", textAlign: "right" }}>{fmtD(s.production_cost_delta)}</td>
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
                    { label: "Units Required",                value: optIncentive.units + " units",  sub: "at " + p.hvac_unit_kw + " kW/unit",         color: "#e2e8f0" },
                    { label: "Gross Install Cost",            value: fmtD(optIncentive.gross),       sub: "before incentives",                           color: "#ef4444" },
                    { label: "ITC Credit (" + fmtPct(p.itc_pct) + ")", value: fmtD(optIncentive.itc), sub: "owner receives directly",                  color: "#22c55e" },
                    { label: "Utility Rebate (" + fmtPct(p.utility_incentive_pct) + ")", value: fmtD(optIncentive.rebate), sub: "funded from avoided cost pool", color: "#3b82f6" },
                    { label: "Net Cost to Owner",             value: fmtD(optIncentive.net),         sub: "after all incentives",                        color: "#f59e0b" },
                    { label: "Utility Value Pool (8yr)",      value: fmtD(optIncentive.pool),        sub: "production delta × 8yr — self-funding basis", color: "#8b5cf6" },
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
                {[
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
                    "The " + fmtPct(p.utility_incentive_pct) + " utility rebate (" + fmtD(optIncentive.rebate) + ") is funded directly from the production cost savings. Over 8 years the utility value pool is " + fmtD(optIncentive.pool) + " — the rebate is a fraction of avoided cost returned to building owners."
                  ],
                  [
                    "Step 4 — Net owner cost after incentives",
                    "After ITC (" + fmtD(optIncentive.itc) + ") and utility rebate (" + fmtD(optIncentive.rebate) + "), the net cost to the building owner is " + fmtD(optIncentive.net) + " for " + optIncentive.units + " units delivering " + optimal.mw + " MW of flexible capacity."
                  ],
                  [
                    "Step 5 — The alignment",
                    "The utility saves on production cost, defers capital, and funds the rebate from avoided cost. The load owner gets upgraded flex load assets at reduced net cost. GridFlex earns from structuring and validating the engagement. No party subsidizes another — the constraint relief creates the value."
                  ],
                ].map(([title, body], i) => (
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
                  <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace" }}>Run the model to see contract outputs.</div>
                </Panel>
              ) : (
                <>
                  <Panel title="NWA Contract — Rate Structure" accent="#34d399">
                    <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace", lineHeight: 1.8, marginBottom: 14 }}>
                      GridFlex holds a single NWA contract with the utility, priced as a share of the utility's own avoided cost.
                      The utility deals with one contract and one invoice. GridFlex handles facility incentive payments downstream.
                    </div>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: contract.rim_pass ? "#16a34a12" : "#dc262612", border: "1px solid " + (contract.rim_pass ? "#16a34a40" : "#dc262640"), borderRadius: 6 }}>
                      <div style={{ fontSize: 10, fontFamily: "monospace", color: contract.rim_pass ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                        RIM TEST: {contract.rim_pass ? "✓ PASS" : "✗ FAIL"}
                      </div>
                      <div style={{ fontSize: 10, color: "#7a90a8" }}>
                        — GridFlex rate (${Math.round(contract.gridflex_rate_kw_yr)}/kW-yr) is {contract.rim_pass ? "below" : "above"} utility avoided cost (${Math.round(contract.avoided_kw_yr)}/kW-yr)
                      </div>
                    </div>
                  </Panel>

                  <Panel title={"GridFlex Economics — At Optimal " + optimal.mw + " MW"} accent="#34d399">
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

                    <div style={{ fontSize: 10, color: "#3d5068", fontFamily: "monospace", marginBottom: 10 }}>CONTRACT TERM COMPARISON</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                      <thead>
                        <tr>
                          {["Term", "GridFlex Gross/yr", "Facility Out/yr", "GridFlex Margin/yr", "Total Contract Value"].map(h => (
                            <th key={h} style={{ textAlign: h === "Term" ? "left" : "right", fontSize: 9, color: "#3d5068", letterSpacing: "0.1em", padding: "6px 10px", borderBottom: "1px solid #0f1c2a" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[3, 5, 10].map(yrs => {
                          const isActive = yrs === p.contract_years;
                          return (
                            <tr key={yrs} style={{ background: isActive ? "#34d39910" : "transparent" }}>
                              <td style={{ padding: "8px 10px", color: isActive ? "#34d399" : "#7a90a8", fontWeight: isActive ? 700 : 400 }}>{yrs} years{isActive ? " ◀" : ""}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#e2e8f0" }}>{fmtD(contract.gridflex_annual)}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#f472b6" }}>{fmtD(contract.facility_annual)}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#a78bfa" }}>{fmtD(contract.margin_annual)}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: "#f59e0b", fontWeight: 700 }}>{fmtD(contract.margin_annual * yrs)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Panel>

                  <Panel title="Payment Flow — How the Money Moves" accent="#34d399">
                    <div style={{ fontSize: 11, color: "#7a90a8", fontFamily: "monospace", lineHeight: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                        <div style={{ background: "#06b6d420", border: "1px solid #06b6d440", borderRadius: 4, padding: "4px 10px", color: "#06b6d4", fontSize: 10, fontWeight: 700 }}>UTILITY</div>
                        <div style={{ color: "#34d399" }}>──── pays {fmtD(contract.gridflex_annual)}/yr ────▶</div>
                        <div style={{ background: "#34d39920", border: "1px solid #34d39940", borderRadius: 4, padding: "4px 10px", color: "#34d399", fontSize: 10, fontWeight: 700 }}>GRIDFLEX</div>
                        <div style={{ color: "#f472b6" }}>──── pays {fmtD(contract.facility_annual)}/yr ────▶</div>
                        <div style={{ background: "#f472b620", border: "1px solid #f472b640", borderRadius: 4, padding: "4px 10px", color: "#f472b6", fontSize: 10, fontWeight: 700 }}>FACILITIES</div>
                      </div>
                      <div style={{ fontSize: 10, color: "#3d5068", lineHeight: 1.8 }}>
                        Utility retains {fmtD(contract.utility_net_annual)}/yr in net savings vs. building the wire.
                        Facility bill credit offsets their Blue Frontier monthly payment.
                        GridFlex keeps {fmtD(contract.margin_annual)}/yr — {fmtD(contract.total_contract)} over the {p.contract_years}-year term.
                      </div>
                    </div>
                  </Panel>
                </>
              )}
            </>
          )}

          {/* ══ ASSUMPTIONS TAB ══ */}
          {tab === "assumptions" && (
            <Panel title="Key Assumptions — What Would Break This Model" accent="#ef4444">
              {[
                {
                  a: "Topology leverage = " + p.topology_leverage + "x",
                  note: "This is the most critical assumption in the model. A " + p.topology_leverage + "x leverage means 1 MW of load shed at the target node relieves " + p.topology_leverage + " MW of redispatch. This MUST be validated against actual PTDF data from the network model (PSS/E or similar) before presenting to a utility as anything more than screening-grade. Operational experience identifying the right node is the proxy at this stage — label it explicitly."
                },
                {
                  a: "Reduction fraction = " + fmtPct(r.reduction_fraction),
                  note: r.reduction_fraction > 0.7
                    ? "HIGH — the model assumes proportional relief up to 100%. Real topology may be nonlinear — small MW increments near the constraint boundary can have outsized or undersized effects. Validate with contingency modeling before committing to a utility."
                    : "Within credible screening range. Label as engineering estimate pending contingency model validation."
                },
                {
                  a: "Delivery factor = " + fmtPct(p.delivery_factor) + " | Coincidence factor = " + fmtPct(p.coincidence_factor),
                  note: "Combined effective MW = " + r.mw_effective.toFixed(1) + " MW. Real-world pilot deployments have demonstrated 60–80% peak suppression achievable with advanced flexible load systems under stress conditions. These defaults are conservative and defensible at screening grade."
                },
                {
                  a: "Curtailment attribution = " + fmtPct(p.curt_attrib),
                  note: "Requires constraint logs to validate. The share of zone curtailment caused by this specific constraint varies widely. Engineering estimate is acceptable at screening grade — label it explicitly in any utility presentation and flag it as field-validatable from ISO/RTO curtailment records."
                },
                {
                  a: "Redispatch differential = $" + p.price_diff + "/MWh",
                  note: "Validate against actual out-of-merit dispatch records or ISO/RTO public data (OASIS, MISO public reports) for the specific constraint zone. This number can vary significantly by season, time of day, and generation mix. Present as a range."
                },
                {
                  a: "Capital deferral = " + p.years_deferral + " year" + (p.years_deferral > 1 ? "s" : ""),
                  note: "Load growth uncertainty is high. A 1-year error shifts NPV materially. Deferral timing depends on load growth trajectory, coincident peak trends, and utility planning assumptions — all of which should be sourced from the utility's own IRP or capital plan. Present as a sensitivity range, not a point estimate."
                },
              ].map((item, i) => (
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
