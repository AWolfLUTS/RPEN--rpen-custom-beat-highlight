// Pure geometry/position helpers. This module owns all beat math so renderer
// and snapping share one source of truth.

// Mirrors RPEN core/edit-grid.mjs verticalGrid(count).
export function verticalGrid(count = 11) {
  const safe = Math.max(2, Math.round(count));
  return { spacing: 1350 / (safe - 1), first: -(safe - 1) / 2, last: (safe - 1) / 2 };
}

export function patternStyle(pattern) {
  return {
    key: pattern.color + '|' + pattern.thickness + '|' + pattern.opacity + '|' + pattern.style,
    color: pattern.color,
    thickness: pattern.thickness,
    opacity: pattern.opacity,
    dash: pattern.style === 'dashed' ? [4, 3] : pattern.style === 'dotted' ? [1, 3] : [],
    // 整拍层最后绘制，压在其他细分之上。
    order: pattern.denominator === 1 ? 1 : 0,
  };
}

// Visible beat range, derived from the timeline's own tick generator so it
// respects per-line BPM factors and the note-view flow mapping.
export function visibleBeatRange(timeline, height, lineIndex) {
  try {
    let first;
    let last;
    for (const tick of timeline.gridTicks(height, lineIndex)) {
      if (!Number.isFinite(tick.beat)) continue;
      if (first === undefined) first = tick.beat;
      last = tick.beat;
    }
    if (first !== undefined) return { lo: Math.floor(first) - 1, hi: Math.ceil(last) + 1 };
  } catch (error) { /* fall through */ }
  try {
    const a = timeline.beatAt(0);
    const b = timeline.beatAt(height);
    return { lo: Math.floor(Math.min(a, b)) - 2, hi: Math.ceil(Math.max(a, b)) + 2 };
  } catch (error) {
    return { lo: 0, hi: 1 };
  }
}

// 节拍型 "M/N" 在当前拍内的偏移：k·M/N（k=1,2,… 且 k·M < N）。整拍为 [0]。
function patternOffsets(pattern) {
  const denominator = Math.round(pattern.denominator);
  if (denominator <= 1) return [0];
  const numerator = Math.max(1, Math.round(pattern.numerator || 1));
  const offsets = [];
  for (let k = 1; k * numerator < denominator; k++) offsets.push((k * numerator) / denominator);
  return offsets;
}

// All highlighted horizontal positions within a beat range. Larger step (M/N)
// claims shared positions first, so 1/2 wins over 1/4 at 1/2.
export function computeHorizontalPositions(config, division, range) {
  const patterns = config.horizontal.patterns
    .filter(pattern => pattern.enabled && Number.isFinite(pattern.denominator) && pattern.denominator >= 1)
    .slice()
    .sort((a, b) => (b.numerator / b.denominator) - (a.numerator / a.denominator));
  if (!patterns.length) return [];
  const claimed = new Map();
  for (const pattern of patterns) {
    const style = patternStyle(pattern);
    const offsets = patternOffsets(pattern);
    for (let beatIndex = range.lo; beatIndex <= range.hi; beatIndex++) {
      for (const offset of offsets) {
        const beat = beatIndex + offset;
        if (beat < range.lo || beat > range.hi) continue;
        const key = Math.round(beat * 1e6);
        if (claimed.has(key)) continue;
        claimed.set(key, { beat, style });
      }
    }
  }
  return [...claimed.values()].sort((a, b) => a.beat - b.beat);
}

// Highlighted vertical line indices. Symmetric around the centre lane, every
// `period` lanes. The centre lane uses its own style when enabled.
export function computeVerticalEntries(config, gridCount) {
  const vertical = config.vertical;
  if (!vertical.enabled || !(gridCount >= 2)) return [];
  const period = Math.max(1, Math.round(vertical.period) || 2);
  const centre = (gridCount - 1) / 2;
  const entries = [];
  for (let index = 0; index < gridCount; index++) {
    const distance = Math.abs(index - centre);
    if (Math.round(distance) % period !== 0) continue;
    const isCentre = distance < 1e-6;
    if (isCentre && !vertical.center.enabled) continue;
    entries.push({ index, isCentre });
  }
  return entries;
}

export function verticalStyle(config, isCentre) {
  const source = isCentre ? config.vertical.center : config.vertical.highlight;
  return patternStyle({ color: source.color, thickness: source.thickness, opacity: source.opacity, style: source.style });
}

// Nearest snap position under the active snap mode.
// - "highlights": 只吸附勾选了「高亮」的节拍型（方案 B：高亮即吸附）。
// - "system": 只吸附原生 1/division 细网格。
export function nearestSnapBeat(beat, config, division) {
  if (!Number.isFinite(beat) || !config.snap.enabled) return beat;
  if (config.snap.mode === 'system') return nearestDivision(beat, division);
  return nearestHighlighted(beat, config);
}

function nearestHighlighted(beat, config) {
  const patterns = config.horizontal.patterns.filter(pattern =>
    pattern.enabled && Number.isFinite(pattern.denominator) && pattern.denominator >= 1);
  if (!patterns.length) return beat;
  let best = beat;
  let bestDistance = Infinity;
  const base = Math.floor(beat) - 1;
  const top = Math.floor(beat) + 2;
  for (const pattern of patterns) {
    const offsets = patternOffsets(pattern);
    for (let beatIndex = base; beatIndex <= top; beatIndex++) {
      for (const offset of offsets) {
        const candidate = beatIndex + offset;
        const distance = Math.abs(candidate - beat);
        if (distance < bestDistance) { bestDistance = distance; best = candidate; }
      }
    }
  }
  return best;
}

function nearestDivision(beat, division) {
  if (!Number.isFinite(division) || division < 1) return beat;
  const baseDivision = Math.round(division);
  let best = beat;
  let bestDistance = Infinity;
  const base = Math.floor(beat) - 1;
  const top = Math.floor(beat) + 2;
  for (let beatIndex = base; beatIndex <= top; beatIndex++) {
    for (let k = 0; k < baseDivision; k++) {
      const candidate = beatIndex + k / baseDivision;
      const distance = Math.abs(candidate - beat);
      if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    }
  }
  return best;
}

export function snapEnabled(config) {
  return Boolean(config.enabled && config.snap.enabled);
}
