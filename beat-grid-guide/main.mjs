// Beat Grid Guide — entry point.
// Enhance RPEN's timeline grid with beat-subdivision highlights and optional
// custom snapping. Everything is off until the user enables it in the panel.
import { createDefaultConfig, loadConfig, saveConfig } from './config.mjs';
import { createRenderer } from './renderer.mjs';
import { createSnapper } from './snapping.mjs';
import { createPanel } from './panel.mjs';

export function activate(api) {
  let config = loadConfig(api);
  let version = 0;

  const getConfig = () => config;
  const getVersion = () => version;

  // Load stylesheet before the panel mounts.
  try { api.style(api.package.text('style.css')); }
  catch (error) { api.log?.('[beat-grid-guide] 样式加载失败', error); }

  const renderer = createRenderer(api, getConfig, getVersion);
  const snapper = createSnapper(api, getConfig);

  function logProbe() {
    try {
      const timeline = api.editor.timeline;
      const globalTimeline = api.editor.globalEvents?.timeline;
      const methods = (target, names) => names.filter(name => typeof target?.[name] === 'function');
      api.log?.('[beat-grid-guide] 诊断', {
        version: api.version,
        hasTimeline: Boolean(timeline),
        timelineMethods: methods(timeline, ['grid', 'gridForLine', 'draw', 'noteBeatAt', 'eventBeatAt', 'movedNote', 'snappedBeat']),
        division: timeline?.division,
        gridCount: timeline?.gridCount,
        hasGlobalTimeline: Boolean(globalTimeline),
        globalMethods: methods(globalTimeline, ['grid', 'draw', 'noteBeatAt', 'eventBeatAt']),
      });
    } catch (error) { api.log?.('[beat-grid-guide] 诊断失败', error); }
  }

  // Reset restores every option to its off/default state, mutating the live
  // config object so the panel's captured references stay valid.
  function resetInPlace() {
    const fresh = createDefaultConfig();
    config.enabled = fresh.enabled;
    config.debug = fresh.debug;
    config.horizontal.enabled = fresh.horizontal.enabled;
    config.horizontal.renderMode = fresh.horizontal.renderMode;
    config.horizontal.patterns = fresh.horizontal.patterns;
    config.vertical.enabled = fresh.vertical.enabled;
    config.vertical.period = fresh.vertical.period;
    config.vertical.snapX = fresh.vertical.snapX;
    Object.assign(config.vertical.highlight, fresh.vertical.highlight);
    Object.assign(config.vertical.center, fresh.vertical.center);
    Object.assign(config.snap, fresh.snap);
  }

  function applyChange(kind) {
    if (kind === 'reset') { resetInPlace(); panel.resetSize(); }
    version += 1;
    saveConfig(api, config);
    renderer.invalidate();
    try { api.editor.invalidate(); } catch (error) { /* ignore */ }
    if (kind === 'reset') panel.refresh();
    else if (kind === 'command') panel.sync();
    if (config.debug) logProbe();
  }

  const panel = createPanel(api, config, applyChange, { getStats: snapper.getStats });

  // Commands: bind through manifest shortcuts, and expose a manager button.
  const offCommands = [];
  function registerCommand(definition) {
    try { offCommands.push(api.commands.register(definition)); }
    catch (error) { api.log?.('[beat-grid-guide] 命令注册失败', error); }
  }
  registerCommand({
    id: 'toggle',
    title: '启用/停用高亮',
    setting: 'toggle-key',
    run() { config.enabled = !config.enabled; applyChange('command'); },
  });
  registerCommand({
    id: 'toggle-snap-mode',
    title: '切换吸附模式（仅高亮/仅原生）',
    setting: 'snap-mode-key',
    run() { config.snap.mode = config.snap.mode === 'highlights' ? 'system' : 'highlights'; applyChange('command'); },
  });
  registerCommand({
    id: 'open-settings',
    title: '打开设置面板',
    run() { panel.show(); },
  });
  registerCommand({
    id: 'show-tutorial',
    title: '重看新手教程',
    run() { panel.showTutorial(); },
  });

  const offState = api.on?.('editor:state', () => {
    renderer.reconcile();
    snapper.reconcile();
  });
  const offChart = api.on?.('editor:chart', () => {
    renderer.reconcile();
    snapper.reconcile();
    renderer.invalidate();
  });
  const offSettings = api.settings?.onChange?.(() => {
    if (!panel.hidden) panel.sync();
  });

  // First run: show the beginner tutorial once.
  if (!config.tutorialSeen) {
    config.tutorialSeen = true;
    saveConfig(api, config);
    try { panel.showTutorial(); } catch (error) { api.log?.('[beat-grid-guide] 教程显示失败', error); }
  }

  if (config.debug) logProbe();

  return () => {
    try { offState?.(); } catch (error) { /* ignore */ }
    try { offChart?.(); } catch (error) { /* ignore */ }
    try { offSettings?.(); } catch (error) { /* ignore */ }
    for (const off of offCommands.reverse()) { try { off?.(); } catch (error) { /* ignore */ } }
    renderer.dispose();
    snapper.dispose();
    panel.dispose();
  };
}
