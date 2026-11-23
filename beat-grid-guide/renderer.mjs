// 渲染器：在 RPEN 原生时间轴网格之上叠加高亮线（横线/竖线）。
// Renders the highlighted horizontal/vertical grid lines on top of RPEN's own
// timeline grid. Purely additive: the native grid is never modified.
import {
  computeHorizontalPositions, computeVerticalEntries, verticalGrid, verticalStyle, visibleBeatRange,
} from './grid-model.mjs';

// 渲染模块：在 RPEN 原生网格之上叠加高亮线。只叠加、不改原生网格。
export function createRenderer(api, getConfig, getVersion) {
  const disposers = [];
  const patched = new WeakSet();
  const cache = new Map();
  let patchedTimeline = null;
  let patchedGlobal = null;

  const report = (() => {
    let count = 0;
    return error => { if (count++ < 3) api.log?.('[beat-grid-guide] 渲染异常', error); };
  })();

  // 清空位置缓存（配置或版本变化时调用）。
  function bumpCache() { cache.clear(); }

  // 带缓存的位置计算：同一 key 只算一次，超过 32 条整体清空，避免无限增长。
  function cachedPositions(key, compute) {
    let value = cache.get(key);
    if (value === undefined) {
      value = compute();
      if (cache.size > 32) cache.clear();
      cache.set(key, value);
    }
    return value;
  }

  // 构造“拍 → y 坐标”的映射函数：兼容多线布局与流动视图（一拍可能对应多个 y）。
  function verticalFn(timeline, height, lineIndex) {
    if (lineIndex !== undefined && typeof timeline.verticalForLine === 'function') {
      return beat => timeline.verticalForLine(beat, lineIndex, height);
    }
    if (timeline.noteView?.flow) {
      let range = null;
      try { range = timeline.noteView.beatRange?.(height) ?? null; } catch (error) { range = null; }
      if (range) {
        return beat => beat < timeline.origin - 1e-8
          ? NaN
          : [1, -1].map(side => timeline.vertical(beat, height, side)).filter(value => value >= 0 && value <= height);
      }
    }
    return beat => timeline.vertical(beat, height);
  }

  // 按样式分组批量绘制横线（同一样式只设一次画笔）。
  function paintPositions(context, positions, yForBeat, left, right, height) {
    if (!positions.length) return;
    const groups = new Map();
    for (const position of positions) {
      const mapped = yForBeat(position.beat);
      const list = Array.isArray(mapped) ? mapped : [mapped];
      for (const y of list) {
        if (!Number.isFinite(y) || y < -2 || y > height + 2) continue;
        let group = groups.get(position.style.key);
        if (!group) { group = { style: position.style, ys: [] }; groups.set(position.style.key, group); }
        group.ys.push(y);
      }
    }
    const ordered = [...groups.values()].sort((a, b) => (a.style.order ?? 0) - (b.style.order ?? 0));
    for (const { style, ys } of ordered) {
      if (!ys.length) continue;
      context.save();
      try {
        context.strokeStyle = style.color;
        context.lineWidth = style.thickness;
        context.globalAlpha = style.opacity;
        context.setLineDash(style.dash);
        context.beginPath();
        for (const y of ys) { context.moveTo(left, y); context.lineTo(right, y); }
        context.stroke();
      } finally {
        context.restore();
      }
    }
  }

  // 绘制横线高亮：计算可见范围与位置后交给 paintPositions。
  function drawHorizontal(timeline, context, left, width, height, lineIndex) {
    const config = getConfig();
    if (!config.enabled || !config.horizontal.enabled) return;
    if (!context || !(width > 0) || !(height > 0)) return;
    const division = Number(timeline.division) || 0;
    const range = visibleBeatRange(timeline, height, lineIndex);
    const key = 'h|' + division + '|' + range.lo + '|' + range.hi + '|' + getVersion();
    const positions = cachedPositions(key, () => computeHorizontalPositions(config, division, range));
    if (!positions.length) return;
    return paintPositions(context, positions, verticalFn(timeline, height, lineIndex), left, left + width, height);
  }

  // 绘制竖线高亮：在音符视图的每块画布上按序号画竖线，支持多线分屏。
  function drawVertical(timeline) {
    const config = getConfig();
    if (!config.enabled || !config.vertical.enabled) return;
    const canvas = timeline.notesCanvas;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!(width > 0) || !(height > 0)) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const gridCount = Math.round(Number(timeline.gridCount) || 0);
    if (!(gridCount >= 2)) return;
    const entries = computeVerticalEntries(config, gridCount);
    if (!entries.length) return;
    const grid = verticalGrid(gridCount);

    let panels = null;
    const session = timeline.getSession?.();
    if (session?.multiLineActive && session?.multiLineMode === 'notes') {
      try {
        const layout = timeline.multiLineLayout?.(width, 'notes');
        if (layout && layout.count > 1 && Array.isArray(layout.indices) && layout.last > layout.first) {
          panels = [];
          for (let panel = layout.first; panel < layout.last; panel++) panels.push(layout.indices[panel]);
        }
      } catch (error) { panels = null; }
    }
    if (!panels) panels = [session?.lineIndex ?? 0];

    for (const lineIndex of panels) {
      const groups = new Map();
      for (const entry of entries) {
        const lane = (entry.index + grid.first) * grid.spacing;
        let x;
        try { x = timeline.noteHorizontal(lane, lineIndex); } catch (error) { continue; }
        if (!Number.isFinite(x) || x < -2 || x > width + 2) continue;
        const style = verticalStyle(config, entry.isCentre);
        let group = groups.get(style.key);
        if (!group) { group = { style, xs: [] }; groups.set(style.key, group); }
        group.xs.push(x);
      }
      for (const { style, xs } of groups.values()) {
        context.save();
        try {
          context.strokeStyle = style.color;
          context.lineWidth = style.thickness;
          context.globalAlpha = style.opacity;
          context.setLineDash(style.dash);
          context.beginPath();
          for (const x of xs) { context.moveTo(x, 0); context.lineTo(x, height); }
          context.stroke();
        } finally {
          context.restore();
        }
      }
    }
  }

  // 包装原生的 grid / gridForLine / draw：先让原生画完，再叠加我们的高亮。
  function patchTimeline(timeline) {
    if (!timeline || patched.has(timeline)) return;
    patched.add(timeline);
    const patch = (key, wrapper) => {
      try { disposers.push(api.patch(timeline, key, wrapper)); }
      catch (error) { api.log?.('[beat-grid-guide] 无法挂接 ' + key, error); }
    };
    patch('grid', previous => function () {
      const result = previous.apply(this, arguments);
      try { drawHorizontal(this, arguments[0], 0, arguments[1], arguments[2], undefined); }
      catch (error) { report(error); }
      return result;
    });
    patch('gridForLine', previous => function () {
      const result = previous.apply(this, arguments);
      try { drawHorizontal(this, arguments[0], arguments[1], arguments[2], arguments[3], arguments[5]); }
      catch (error) { report(error); }
      return result;
    });
    patch('draw', previous => function () {
      const result = previous.apply(this, arguments);
      try { drawVertical(this); }
      catch (error) { report(error); }
      return result;
    });
  }

  // 时间轴实例可能被重建/切换：发现新实例就重新挂接。
  function reconcile() {
    const timeline = api.editor.timeline;
    if (timeline && timeline !== patchedTimeline) { patchedTimeline = timeline; patchTimeline(timeline); }
    let globalTimeline = null;
    try { globalTimeline = api.editor.globalEvents?.timeline ?? null; } catch (error) { globalTimeline = null; }
    if (globalTimeline && globalTimeline !== patchedGlobal) { patchedGlobal = globalTimeline; patchTimeline(globalTimeline); }
  }

  reconcile();

  return {
    reconcile,
    invalidate: bumpCache,
    dispose() {
      for (let index = disposers.length - 1; index >= 0; index--) {
        try { disposers[index]?.(); } catch (error) { /* ignore */ }
      }
      disposers.length = 0;
    },
  };
}
