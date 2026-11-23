// 吸附模块：用“原生网格 ∪ 用户选中的节拍型”重写时间轴的量化结果。
// Overrides the timeline's time-quantisation with the union of the user's
// selected beat types. When disabled, every wrapper is a transparent pass-through.
import { beatValue, fromNumber } from './beat-util.mjs';
import { nearestSnapBeat, snapEnabled } from './grid-model.mjs';

// 吸附模块：包装时间轴的量化方法，把吸附从“原生网格”扩展到“原生网格 ∪ 高亮线”。
// 关闭时每个包装都是透明直通（不改原生行为）。
export function createSnapper(api, getConfig) {
  const disposers = [];
  const patched = new WeakSet();
  const patchedInteraction = new WeakSet();
  let patchedTimeline = null;
  let patchedGlobal = null;
  const report = (() => {
    let count = 0;
    return error => { if (count++ < 3) api.log?.('[beat-grid-guide] 吸附异常', error); };
  })();
  let calls = 0;
  let logged = 0;

  // 对单个拍值做吸附（按当前模式）；未启用时原样返回。
  function snapBeat(timeline, beat) {
    calls += 1;
    const config = getConfig();
    if (!snapEnabled(config) || !Number.isFinite(beat)) return beat;
    const snapped = nearestSnapBeat(beat, config, Number(timeline.division) || 0);
    if (Math.abs(snapped - beat) > 1e-9 && logged < 5) {
      logged += 1;
      api.log?.('[beat-grid-guide] 吸附', Number(beat).toFixed(4), '->', Number(snapped).toFixed(4));
    }
    return snapped;
  }

  // 对整条音符做吸附：只吸附被拖动的那一端（拖尾不动头、拖头不动尾、整体移动才两端都吸）。
  function snapNote(timeline, note, kind) {
    calls += 1;
    const config = getConfig();
    if (!snapEnabled(config) || !note || typeof note !== 'object') return note;
    try {
      const start = beatValue(note.startTime);
      const end = beatValue(note.endTime);
      const division = Number(timeline.division) || 0;
      // 只吸附被拖动的那一端：拖尾不动头、拖头不动尾、整体移动才两端都吸附。
      const snapStart = kind !== 'endTime';
      const snapEnd = kind !== 'startTime';
      const snappedStart = snapStart && Number.isFinite(start) ? nearestSnapBeat(start, config, division) : start;
      let snappedEnd = snapEnd && Number.isFinite(end) ? nearestSnapBeat(end, config, division) : end;
      if (Number.isFinite(snappedStart) && Number.isFinite(snappedEnd) && snappedEnd < snappedStart) snappedEnd = snappedStart;
      if (Number.isFinite(snappedStart) && Math.abs(snappedStart - start) < 1e-9
        && Number.isFinite(snappedEnd) && Math.abs(snappedEnd - end) < 1e-9) return note;
      return {
        ...note,
        startTime: Number.isFinite(snappedStart) ? fromNumber(snappedStart) : note.startTime,
        endTime: Number.isFinite(snappedEnd) ? fromNumber(snappedEnd) : note.endTime,
      };
    } catch (error) { report(error); return note; }
  }

  // 包装时间轴的量化方法：原生量化之后再叠加自定义吸附。
  function patchTimeline(timeline) {
    if (!timeline || patched.has(timeline)) return;
    patched.add(timeline);
    const patch = (key, wrapper) => {
      try { disposers.push(api.patch(timeline, key, wrapper)); }
      catch (error) { api.log?.('[beat-grid-guide] 无法挂接吸附 ' + key, error); }
    };
    patch('snappedBeat', previous => function () {
      const result = previous.apply(this, arguments);
      try { return snapBeat(this, result); } catch (error) { report(error); return result; }
    });
    patch('noteBeatAt', previous => function () {
      const result = previous.apply(this, arguments);
      try { return snapBeat(this, result); } catch (error) { report(error); return result; }
    });
    patch('eventBeatAt', previous => function () {
      const result = previous.apply(this, arguments);
      if (!arguments[2]) return result;
      try { return snapBeat(this, result); } catch (error) { report(error); return result; }
    });
    patch('movedNote', previous => function (note) {
      const result = previous.call(this, note);
      try {
        if (!['move', 'startTime', 'endTime'].includes(this.drag?.kind)) return result;
        return snapNote(this, result, this.drag?.kind);
      } catch (error) { report(error); return result; }
    });
  }

  // EventInteraction.delta() computes event-drag quantization inline (not via a
  // timeline method), so it needs its own wrapper.
  // 事件拖拽的量化在 EventInteraction.delta() 里内联计算，需要单独包装。
  function patchInteraction(interaction) {
    if (!interaction || patchedInteraction.has(interaction)) return;
    patchedInteraction.add(interaction);
    try {
      disposers.push(api.patch(interaction, 'delta', previous => function () {
        calls += 1;
        const config = getConfig();
        if (!snapEnabled(config)) return previous.call(this);
        try {
          const drag = this.drag;
          if (!drag?.anchor) return 0;
          const timeline = this.timeline;
          const start = drag.anchor;
          const factor = timeline.factorForLine(drag.lineIndex ?? timeline.getSession().lineIndex);
          const scroll = timeline.tempo.seconds(timeline.origin, factor) - (drag.originSeconds ?? timeline.tempo.seconds(timeline.origin, factor));
          const targetSeconds = timeline.tempo.seconds(start, factor) + (drag.start.y - drag.current.y) / timeline.scale + scroll;
          const target = timeline.tempo.beat(targetSeconds, factor);
          if (!Number.isFinite(target)) return previous.call(this);
          const snapped = nearestSnapBeat(target, config, Number(timeline.division) || 0);
          return snapped - beatValue(start);
        } catch (error) { report(error); return previous.call(this); }
      }));
    } catch (error) { api.log?.('[beat-grid-guide] 无法挂接事件吸附', error); }
  }

  // 时间轴实例可能被重建/切换：发现新实例就重新挂接。
  function reconcile() {
    const timeline = api.editor.timeline;
    if (timeline && timeline !== patchedTimeline) { patchedTimeline = timeline; patchTimeline(timeline); }
    let globalTimeline = null;
    try { globalTimeline = api.editor.globalEvents?.timeline ?? null; } catch (error) { globalTimeline = null; }
    if (globalTimeline && globalTimeline !== patchedGlobal) { patchedGlobal = globalTimeline; patchTimeline(globalTimeline); }
    patchInteraction(patchedTimeline?.eventInteraction);
    patchInteraction(patchedGlobal?.eventInteraction);
  }

  reconcile();

  return {
    reconcile,
    getStats: () => ({ calls, active: snapEnabled(getConfig()) }),
    dispose() {
      for (let index = disposers.length - 1; index >= 0; index--) {
        try { disposers[index]?.(); } catch (error) { /* ignore */ }
      }
      disposers.length = 0;
    },
  };
}
