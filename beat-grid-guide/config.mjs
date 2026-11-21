// Configuration model for Beat Grid Guide.
// A pattern is a fraction M/N: "每拍均分 N 份、以 M 为步长"，位置 = k·M/N
// （k=1,2,…，只落在当前拍内）。整拍层为特殊的 1/1（只标整数拍）。
export const SCHEMA_VERSION = 1;

const PRESETS = [
  // id, name, numerator, denominator, color, thickness, opacity, style
  ['whole', '整拍 1/1', 1, 1, '#f2efe9', 1.8, 1.0, 'solid'],
  ['half', '1/2', 1, 2, '#ff4d4d', 1.6, 0.85, 'solid'],
  ['third', '1/3', 1, 3, '#38bdf8', 1.2, 0.75, 'dashed'],
  ['quarter', '1/4', 1, 4, '#fbbf24', 1.2, 0.75, 'solid'],
  ['sixth', '1/6', 1, 6, '#a78bfa', 1.0, 0.6, 'dotted'],
  ['eighth', '1/8', 1, 8, '#34d399', 1.0, 0.6, 'dotted'],
  ['twelfth', '1/12', 1, 12, '#fb7185', 1.0, 0.45, 'dotted'],
  ['sixteenth', '1/16', 1, 16, '#22d3ee', 1.0, 0.3, 'dotted'],
  ['twentyFourth', '1/24', 1, 24, '#a3e635', 1.0, 0.3, 'dotted'],
];

// Custom denominators alternate between these two colours (dashed, 80%).
const CUSTOM_COLORS = ['#f472b6', '#2dd4bf'];
const STYLES = ['solid', 'dashed', 'dotted'];
const MODES = ['auto', 'recolor', 'overlay'];
const SNAP_MODES = ['highlights', 'system'];

function clampNumber(value, min, max, round = n => n, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return round(Math.min(max, Math.max(min, number)));
}

function normalizeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function makePattern(id, name, numerator, denominator, color, thickness, opacity, style, custom = false) {
  return { id, name, numerator, denominator, enabled: false, snap: false, color, thickness, opacity, style, mode: 'auto', custom };
}

export function createDefaultConfig() {
  const config = {
    schemaVersion: SCHEMA_VERSION,
    enabled: false,
    horizontal: {
      enabled: false,
      renderMode: 'auto',
      patterns: PRESETS.map(preset => makePattern(...preset)),
    },
    vertical: {
      enabled: false,
      period: 2,
      highlight: { color: '#4fc3f7', thickness: 1.4, opacity: 0.9, style: 'solid' },
      center: { enabled: false, color: '#ffffff', thickness: 2.0, opacity: 1.0, style: 'solid' },
      snapX: false,
    },
    snap: { enabled: false, mode: 'highlights' },
    debug: false,
    tutorialSeen: false,
  };
  // 整拍线默认开启（有意破例）：高亮即吸附。
  const whole = config.horizontal.patterns.find(pattern => pattern.denominator === 1);
  if (whole) { whole.enabled = true; whole.snap = true; }
  return config;
}

function normalizePattern(pattern) {
  if (!pattern || typeof pattern !== 'object') return null;
  const denominator = clampNumber(pattern.denominator, 1, 512, n => Math.round(n), 1);
  if (denominator < 1) return null;
  const maxNumerator = denominator <= 1 ? 1 : denominator - 1;
  const numerator = clampNumber(pattern.numerator, 1, maxNumerator, n => Math.round(n), 1);
  const id = typeof pattern.id === 'string' && /^[a-z][a-z0-9-]*$/.test(pattern.id) ? pattern.id : 'custom-' + numerator + '-' + denominator;
  const enabled = pattern.enabled === true;
  return {
    id,
    name: typeof pattern.name === 'string' && pattern.name ? pattern.name.slice(0, 40) : numerator + '/' + denominator,
    numerator,
    denominator,
    enabled,
    // 方案 B：高亮即吸附，snap 始终跟随 enabled。
    snap: enabled,
    color: normalizeColor(pattern.color, '#4fc3f7'),
    thickness: clampNumber(pattern.thickness, 0.5, 12, n => Math.round(n * 10) / 10, 1),
    opacity: clampNumber(pattern.opacity, 0.05, 1, n => Math.round(n * 100) / 100, 1),
    style: STYLES.includes(pattern.style) ? pattern.style : 'solid',
    mode: MODES.includes(pattern.mode) ? pattern.mode : 'auto',
    custom: pattern.custom === true,
  };
}

function mergeStyle(target, source) {
  if (!source || typeof source !== 'object') return;
  target.color = normalizeColor(source.color, target.color);
  target.thickness = clampNumber(source.thickness, 0.5, 12, n => Math.round(n * 10) / 10, target.thickness);
  target.opacity = clampNumber(source.opacity, 0.05, 1, n => Math.round(n * 100) / 100, target.opacity);
  target.style = STYLES.includes(source.style) ? source.style : target.style;
}

function mergeHorizontal(target, source) {
  if (!source || typeof source !== 'object') return;
  if (typeof source.enabled === 'boolean') target.enabled = source.enabled;
  if (MODES.includes(source.renderMode)) target.renderMode = source.renderMode;
  if (Array.isArray(source.patterns)) {
    const list = [];
    const seen = new Set();
    for (const raw of source.patterns) {
      const pattern = normalizePattern(raw);
      if (!pattern || seen.has(pattern.id)) continue;
      seen.add(pattern.id);
      list.push(pattern);
    }
    if (list.length) {
      if (!list.some(pattern => pattern.denominator === 1)) {
        const whole = normalizePattern({
          id: 'whole', name: '整拍 1/1', numerator: 1, denominator: 1, enabled: true,
          color: '#fbf4f4', thickness: 1.8, opacity: 1, style: 'solid', mode: 'auto',
        });
        if (whole) list.unshift(whole);
      }
      target.patterns = list;
    }
  }
}

function mergeVertical(target, source) {
  if (!source || typeof source !== 'object') return;
  if (typeof source.enabled === 'boolean') target.enabled = source.enabled;
  if (Number.isFinite(Number(source.period))) target.period = clampNumber(source.period, 1, 64, n => Math.round(n), 2);
  if (typeof source.snapX === 'boolean') target.snapX = source.snapX;
  if (typeof source.center?.enabled === 'boolean') target.center.enabled = source.center.enabled;
  mergeStyle(target.highlight, source.highlight);
  mergeStyle(target.center, source.center);
}

function mergeSnap(target, source) {
  if (!source || typeof source !== 'object') return;
  if (typeof source.enabled === 'boolean') target.enabled = source.enabled;
  if (SNAP_MODES.includes(source.mode)) target.mode = source.mode;
}

export function normalizeConfig(raw) {
  const config = createDefaultConfig();
  if (!raw || typeof raw !== 'object') return config;
  if (typeof raw.enabled === 'boolean') config.enabled = raw.enabled;
  if (typeof raw.debug === 'boolean') config.debug = raw.debug;
  if (typeof raw.tutorialSeen === 'boolean') config.tutorialSeen = raw.tutorialSeen;
  mergeHorizontal(config.horizontal, raw.horizontal);
  mergeVertical(config.vertical, raw.vertical);
  mergeSnap(config.snap, raw.snap);
  config.schemaVersion = SCHEMA_VERSION;
  return config;
}

export function loadConfig(api) {
  let raw = {};
  try { raw = api.storage.read({}) ?? {}; } catch (error) { api.log?.('[beat-grid-guide] 读取配置失败', error); }
  return normalizeConfig(raw);
}

export function saveConfig(api, config) {
  try { api.storage.write(config); } catch (error) { api.log?.('[beat-grid-guide] 保存配置失败', error); }
}

export function addCustomPattern(config, numerator, denominator) {
  const den = clampNumber(denominator, 2, 512, n => Math.round(n), 0);
  if (!Number.isFinite(den) || den < 2) return null;
  const num = Math.round(Number(numerator));
  if (!Number.isFinite(num) || num < 1 || num >= den) return null;
  const existing = config.horizontal.patterns.find(pattern => pattern.numerator === num && pattern.denominator === den);
  if (existing) return existing;
  let id = 'custom-' + num + '-' + den;
  let suffix = 1;
  while (config.horizontal.patterns.some(pattern => pattern.id === id)) id = 'custom-' + num + '-' + den + '-' + suffix++;
  const customCount = config.horizontal.patterns.filter(pattern => pattern.custom).length;
  const color = CUSTOM_COLORS[customCount % CUSTOM_COLORS.length];
  const pattern = makePattern(id, num + '/' + den, num, den, color, 1.1, 0.8, 'dashed', true);
  config.horizontal.patterns.push(pattern);
  return pattern;
}

export function removePattern(config, id) {
  const index = config.horizontal.patterns.findIndex(pattern => pattern.id === id);
  if (index >= 0) config.horizontal.patterns.splice(index, 1);
}
