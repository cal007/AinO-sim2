// --- Config ---
const DEPT_NAMES = ["Sales", "Ops", "Finance", "Product"];
const MODES = { NORMAL: "Normal", TENSION: "Tension", CRISIS: "Crisis" };

// --- Helpers ---
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

export const DEFAULT_CONFIG = {
  ticks: 60,
  gamingRate: 0.02,
  gamingDecay: { Normal: 0.01, Tension: 0.02, Crisis: 0.03 },
  shadowNoise: 0.02,
  thresholds: {
    tension: 0.25,
    crisis: 0.50,
    reEscalation: 2,
    latency: 14
  },
  shockDurationMs: 150
};

// --- Department init ---
export function initDept(name) {
  return {
    name,
    kpi: 0.5,
    reality: 0.5,
    gaming: 0,
    shadowMetric: 0.5,
    latency: 0,
    reEscalations: 0
  };
}

// --- Baseline step ---
export function stepBaselineDept(dept, cfg, shock) {
  const realityDrift = rand(-0.03, 0.03) + (shock ? rand(-0.08, 0) : 0);
  const newReality = clamp(dept.reality + realityDrift, 0, 1);

  const gamingPressure = 0.015 + dept.gaming * 0.01;
  const newKpi = clamp(dept.kpi + gamingPressure + rand(-0.01, 0.01), 0, 1);

  const newGaming = clamp(dept.gaming + cfg.gamingRate, 0, 1);

  return { ...dept, reality: newReality, kpi: newKpi, gaming: newGaming };
}

// --- AïnO step ---
export function stepAinoDept(dept, cfg, shock, mode) {
  const realityDrift = rand(-0.03, 0.03) + (shock ? rand(-0.08, 0) : 0);
  const newReality = clamp(dept.reality + realityDrift, 0, 1);

  const shadowNoise = rand(-cfg.shadowNoise, cfg.shadowNoise);
  const newShadow = clamp(newReality + shadowNoise, 0, 1);

  const modeFactors = {
    Normal: { pressure: 1.0, decay: cfg.gamingDecay.Normal },
    Tension: { pressure: 0.6, decay: cfg.gamingDecay.Tension },
    Crisis: { pressure: 0.3, decay: cfg.gamingDecay.Crisis }
  };
  const f = modeFactors[mode];

  const gamingPressure = 0.015 * f.pressure + dept.gaming * 0.005 * f.pressure;
  const newKpi = clamp(dept.kpi + gamingPressure + rand(-0.01, 0.01), 0, 1);

  const newGaming = clamp(dept.gaming + cfg.gamingRate - f.decay, 0, 1);

  // Latency & re-escalations
  const divergence = Math.abs(newKpi - newShadow);
  let newLatency = dept.latency + 1;
  let newReEsc = dept.reEscalations;

  if (divergence > cfg.thresholds.tension) {
    if (newLatency > cfg.thresholds.latency) {
      newReEsc++;
      newLatency = 0;
    }
  } else {
    newLatency = 0;
  }

  return {
    ...dept,
    reality: newReality,
    kpi: newKpi,
    gaming: newGaming,
    shadowMetric: newShadow,
    latency: newLatency,
    reEscalations: newReEsc
  };
}

// --- Mode logic ---
export function computeMode(depts, cfg, prevMode) {
  const avgDiv =
    depts.reduce((s, d) => s + Math.abs(d.kpi - d.shadowMetric), 0) /
    depts.length;

  const maxReEsc = Math.max(...depts.map(d => d.reEscalations));

  if (avgDiv >= cfg.thresholds.crisis || maxReEsc >= cfg.thresholds.reEscalation)
    return MODES.CRISIS;

  if (avgDiv >= cfg.thresholds.tension) return MODES.TENSION;

  return MODES.NORMAL;
}

// --- Org health ---
export function computeOrgHealth(depts) {
  const avgDiv =
    depts.reduce((s, d) => s + Math.abs(d.kpi - d.reality), 0) / depts.length;
  const avgGaming = depts.reduce((s, d) => s + d.gaming, 0) / depts.length;
  return clamp(1 - avgDiv * 0.9 - avgGaming * 0.3, 0, 1);
}

// --- Initial state ---
export function createInitialState() {
  return {
    tick: 0,
    baselineDepts: DEPT_NAMES.map(initDept),
    ainoDepts: DEPT_NAMES.map(initDept),
    mode: MODES.NORMAL,
    captureRisk: 0,
    shockActive: false,
    history: {
      baseHealth: [],
      ainoHealth: [],
      divergence: [],
      mode: []
    }
  };
}

// --- Tick ---
export function runTick(state, cfg) {
  if (state.tick >= cfg.ticks) return state;

  const shock = state.shockActive;

  const newBaseline = state.baselineDepts.map(d =>
    stepBaselineDept(d, cfg, shock)
  );
  const newAino = state.ainoDepts.map(d =>
    stepAinoDept(d, cfg, shock, state.mode)
  );

  const newMode = computeMode(newAino, cfg, state.mode);

  const maxReEsc = Math.max(...newAino.map(d => d.reEscalations));
  const riskDelta =
    newMode === MODES.CRISIS ? 0.01 :
    newMode === MODES.TENSION ? 0.005 :
    -0.003;

  const newCapture = clamp(
    state.captureRisk + riskDelta + maxReEsc * 0.001,
    0,
    1
  );

  const bh = computeOrgHealth(newBaseline);
  const ah = computeOrgHealth(newAino);
  const div =
    newAino.reduce((s, d) => s + Math.abs(d.kpi - d.shadowMetric), 0) /
    newAino.length;

  const modeIntensity =
    newMode === MODES.NORMAL ? 0.2 :
    newMode === MODES.TENSION ? 0.6 : 1.0;

  return {
    ...state,
    tick: state.tick + 1,
    baselineDepts: newBaseline,
    ainoDepts: newAino,
    mode: newMode,
    captureRisk: newCapture,
    history: {
      baseHealth: [...state.history.baseHealth, bh],
      ainoHealth: [...state.history.ainoHealth, ah],
      divergence: [...state.history.divergence, div],
      mode: [...state.history.mode, modeIntensity]
    }
  };
}
