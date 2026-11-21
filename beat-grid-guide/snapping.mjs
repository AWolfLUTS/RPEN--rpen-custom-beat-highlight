// Overrides the timeline's time-quantisation with the union of the user's
// selected beat types. When disabled, every wrapper is a transparent pass-through.
import { beatValue, fromNumber } from './beat-util.mjs';
import { nearestSnapBeat, snapEnabled } from './grid-model.mjs';

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

  function snapNote(timeline, note) {
    calls += 1;
    const config = getConfig();
    if (!snapEnabled(config) || !note || typeof note !== 'object') return note;
    try {
      const start = beatValue(note.startTime);
      const end = beatValue(note.endTime);
      const division = Number(timeline.division) || 0;
      const snappedStart = Number.isFinite(start) ? nearestSnapBeat(start, config, division) : start;
      let snappedEnd = Number.isFinite(end) ? nearestSnapBeat(end, config, division) : end;
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
        return snapNote(this, result);
      } catch (error) { report(error); return result; }
    });
  }

  // EventInteraction.delta() computes event-drag quantization inline (not via a
  // timeline method), so it needs its own wrapper.
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
