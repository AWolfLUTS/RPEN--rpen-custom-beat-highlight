// Settings panel + launcher button.
// Launcher sits in the editor toolbar; the panel is a draggable/resizable
// floating window styled with the editor's own CSS variables.
import { addCustomPattern, removePattern } from './config.mjs';

const STYLE_LABELS = { solid: '实线', dashed: '虚线', dotted: '点线' };
// 取色浮层的 9 个预设色（与默认节拍型配色相近但不完全相同）。
const SWATCH_COLORS = ['#efe9df', '#ff6060', '#4aaeff', '#ffc23d', '#b18cff', '#3dd6a0', '#ff7f96', '#2fe0f0', '#b6f04a'];
const MIN_WIDTH = 450;
const MIN_HEIGHT = 700;

// 轻量 DOM 构造器：el('div', { class: 'x', text: 'hi' }, child...)。
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

// 把键盘事件转成快捷键字符串（如 Ctrl+Shift+M → "CTRL&SHIFT&M"）。
function fromKeyEvent(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('CTRL');
  if (event.altKey) parts.push('ALT');
  if (event.shiftKey) parts.push('SHIFT');
  let key = String(event.key || '').toUpperCase();
  const map = { ' ': 'SPACE', ARROWLEFT: 'LEFTARROW', ARROWRIGHT: 'RIGHTARROW', ARROWUP: 'UPARROW', ARROWDOWN: 'DOWNARROW' };
  key = map[key] || key;
  if (!key || ['CONTROL', 'SHIFT', 'ALT', 'META'].includes(key)) return '';
  parts.push(key);
  return parts.join('&');
}

export function createPanel(api, config, onChange, options = {}) {
  let commitTimer = 0;
  let drag = null;
  let currentControls = null;
  let tutorial = null;
  let cancelShortcutRecording = null;

  // 防抖提交：连续改动时只在停止 50ms 后触发一次 onChange。
  function commit() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      try { onChange(); } catch (error) { api.log?.('[beat-grid-guide] 更新失败', error); }
    }, 50);
  }

  // Sliding switch: input followed by track; CSS uses `:checked + .bgg-track`.
  // 滑动开关的隐藏 checkbox：change 时回调新状态。
  function switchInput(checked, onToggle) {
    const input = el('input', { type: 'checkbox', class: 'bgg-switch-input' });
    input.checked = Boolean(checked);
    input.addEventListener('change', () => onToggle(input.checked));
    return input;
  }

  // 滑动开关外壳。视觉全在 CSS：`.bgg-switch-input`（隐藏 checkbox）+ `.bgg-track`（灰轨）+ `.bgg-track::after`（圆点）。
  // 开启态由 `input:checked + .bgg-track` 驱动（黄色 + 圆点平移），见 style.css 的 `.bgg-track` 区块。
  // 一行开关：文字 + 滑动开关，返回节点与 input 供外部同步。
  function toggleRow(text, checked, onToggle) {
    const input = switchInput(checked, onToggle);
    const node = el('label', { class: 'bgg-toggle-row' },
      el('span', { class: 'bgg-toggle-text', text }), input, el('span', { class: 'bgg-track' }));
    return { node, input };
  }

  // Inline shortcut badge: shows the current key, click to re-capture.
  // 快捷键徽标：显示当前键位，点击进入录制（Esc 取消 / Backspace 清除）。
  function shortcutBadge(settingKey) {
    const badge = el('button', { class: 'bgg-shortcut', type: 'button', title: '点击重设快捷键（Esc 取消，Backspace 清除）' }); 
    function sync() {
      let value = '';
      try { value = api.settings?.get?.(settingKey) || ''; } catch (error) { value = ''; }
      badge.textContent = value || '＋';
      badge.dataset.empty = value ? '0' : '1';
    }
    sync();
    badge.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (badge.classList.contains('recording')) return;
      cancelShortcutRecording?.();
      badge.classList.add('recording');
      const previous = badge.textContent;
      badge.textContent = '…';
      const onKey = keyEvent => {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        window.removeEventListener('keydown', onKey, true);
        cancelShortcutRecording = null;
        badge.classList.remove('recording');
        if (keyEvent.key === 'Escape') { badge.textContent = previous; return; }
        const value = keyEvent.key === 'Backspace' ? '' : fromKeyEvent(keyEvent);
        Promise.resolve(api.settings?.set?.(settingKey, value)).then(sync).catch(() => { badge.textContent = previous; });
      };
      window.addEventListener('keydown', onKey, true);
      // 关面板/卸载时取消录制，避免下一次按键被误拦截。
      cancelShortcutRecording = () => {
        window.removeEventListener('keydown', onKey, true);
        badge.classList.remove('recording');
        badge.textContent = previous;
        cancelShortcutRecording = null;
      };
    });
    return { node: badge, sync };
  }

  // 取色：色块按钮 + 2×5 浮层（前 9 预设色 + 第 10 格「笔」自定义）。
  let activeColorPop = null;
  // 关闭当前打开的取色浮层（全局单例）。
  function closeColorPop() {
    if (!activeColorPop) return;
    const close = activeColorPop;
    activeColorPop = null;
    close();
  }
  // 取色控件：色块按钮 + 2×5 浮层（前 9 预设色 + 第 10 格「笔」打开原生取色器）。
  function colorField(source) {
    const field = el('div', { class: 'bgg-color-field' });
    const swatch = el('button', { type: 'button', class: 'bgg-color-swatch', title: '颜色' });
    swatch.style.background = source.color;
    const native = el('input', { type: 'color', class: 'bgg-color-native' });
    native.value = source.color;
    native.addEventListener('input', () => {
      source.color = native.value;
      swatch.style.background = native.value;
      commit();
    });
    const pop = el('div', { class: 'bgg-color-pop' });
    pop.hidden = true;
    for (const hex of SWATCH_COLORS) {
      const cell = el('button', { type: 'button', class: 'bgg-swatch', title: hex });
      cell.style.background = hex;
      cell.addEventListener('click', () => {
        source.color = hex;
        swatch.style.background = hex;
        commit();
        closeColorPop();
      });
      pop.append(cell);
    }
    const custom = el('button', { type: 'button', class: 'bgg-swatch bgg-swatch-custom', title: '自定义颜色', text: '✏' });
    custom.addEventListener('click', () => {
      closeColorPop();
      native.click();
    });
    pop.append(custom);

    function openPop() {
      closeColorPop();
      pop.hidden = false;
      const rect = swatch.getBoundingClientRect();
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      let left = rect.left + rect.width / 2 - pw / 2;
      left = Math.max(4, Math.min(left, window.innerWidth - pw - 4));
      let top = rect.bottom + 4;
      if (top + ph > window.innerHeight - 4) top = rect.top - ph - 4;
      pop.style.left = left + 'px';
      pop.style.top = Math.max(4, top) + 'px';
      const onDoc = event => { if (!field.contains(event.target)) closeColorPop(); };
      const onKey = event => { if (event.key === 'Escape') closeColorPop(); };
      document.addEventListener('pointerdown', onDoc, true);
      document.addEventListener('keydown', onKey, true);
      activeColorPop = () => {
        pop.hidden = true;
        document.removeEventListener('pointerdown', onDoc, true);
        document.removeEventListener('keydown', onKey, true);
      };
    }
    swatch.addEventListener('click', () => {
      if (pop.hidden) openPop(); else closeColorPop();
    });

    field.append(swatch, native, pop);
    return field;
  }

  // 一组样式输入（颜色/粗细/透明度/线型）。返回 4 个元素：可放入网格行或 .bgg-style-row。
  // 一组样式输入（颜色/粗细/透明度/线型），返回 4 个元素供网格行复用。
  function styleInputs(source) {
    const color = colorField(source);
    const thickness = el('input', {
      type: 'number', class: 'bgg-thickness', min: '0.5', max: '12', step: '0.1',
      value: String(source.thickness), title: '粗细',
    });
    thickness.addEventListener('input', () => {
      const value = Number(thickness.value);
      if (Number.isFinite(value)) { source.thickness = Math.min(12, Math.max(0.5, value)); commit(); }
    });
    const opacity = el('input', {
      type: 'range', class: 'bgg-opacity', min: '0.05', max: '1', step: '0.05',
      value: String(source.opacity), title: '透明度',
    });
    opacity.addEventListener('input', () => { source.opacity = Number(opacity.value); commit(); });
    const style = el('select', { class: 'bgg-style' });
    for (const key of ['solid', 'dashed', 'dotted']) style.append(new Option(STYLE_LABELS[key], key));
    style.value = source.style;
    style.addEventListener('change', () => { source.style = style.value; commit(); });
    return [color, thickness, opacity, style];
  }

  // 竖线区用：返回一行内联样式输入。
  function styleEditor(source) {
    return el('div', { class: 'bgg-style-row' }, ...styleInputs(source));
  }

  // 竖线区：标签 + 与横线列表同列宽对齐的样式行。
  // 竖线区用：标签 + 与横线列表同列宽对齐的样式行。
  function styleGrid(label, source) {
    return el('div', { class: 'bgg-style-grid' },
      el('span', { class: 'bgg-style-grid-label', text: label }),
      ...styleInputs(source));
  }

  // 节拍型列表的一行：拍型名 + 高亮开关 + 样式输入 + 删除按钮（1/1、1/2 不可删）。
  function patternRow(pattern) {
    const row = el('div', { class: 'bgg-pattern' });
    const toggle = switchInput(pattern.enabled, value => {
      pattern.enabled = value;
      pattern.snap = value; // 方案 B：高亮即吸附
      commit();
    });
    row.append(
      el('span', { class: 'bgg-pattern-name', text: pattern.name }),
      el('label', { class: 'bgg-mini' }, toggle, el('span', { class: 'bgg-track' })),
      ...styleInputs(pattern),
    );
    const deletable = pattern.denominator !== 1 && pattern.id !== 'half' && config.horizontal.patterns.length > 2;
    if (deletable) {
      const remove = el('button', { class: 'bgg-del', title: '删除该条', text: '×' });
      remove.addEventListener('click', () => { removePattern(config, pattern.id); rebuild(); commit(); });
      row.append(remove);
    } else {
      row.append(el('span'));
    }
    return row;
  }

  // ── 分段控件（吸附模式）的 JS 侧 ──────────────────────────────
  // 结构：灰色凹槽 .bgg-segment + 黄色滑块 .bgg-seg-thumb + 两个文字标签 .bgg-seg-label。
  // 交互：拖动滑块或点击任意一侧，松手时停靠到最近一侧；文字颜色由 data-mode 决定。
  // 滑块位置用 CSS 变量 --thumb-x（0% / 100% / 拖动时的像素值），详见 style.css 注释。
  // 吸附模式分段控件：灰色凹槽 + 黄色滑块 + 两个文字标签，支持拖动/点击停靠。
  function modeSegment() {
    const thumb = el('div', { class: 'bgg-seg-thumb' });
    const left = el('span', { class: 'bgg-seg-label', 'data-side': 'left', text: '仅高亮' });
    const right = el('span', { class: 'bgg-seg-label', 'data-side': 'right', text: '仅原生' });
    const wrap = el('div', { class: 'bgg-segment' }, thumb, left, right);

    const apply = nativeMode => {
      wrap.dataset.mode = nativeMode ? 'native' : 'highlights';
      wrap.style.setProperty('--thumb-x', nativeMode ? '100%' : '0%');
      config.snap.mode = nativeMode ? 'system' : 'highlights';
    };
    apply(config.snap.mode === 'system');

    wrap.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const rect = wrap.getBoundingClientRect();
      const half = Math.max(1, (rect.width - 6) / 2);
      const thumbRect = thumb.getBoundingClientRect();
      const inside = event.clientX >= thumbRect.left - 4 && event.clientX <= thumbRect.right + 4;
      event.preventDefault();
      event.stopPropagation();
      if (!inside) {
        // 点在一侧：按轨道中线判断左右。
        apply(event.clientX - rect.left - 3 > half);
        commit();
        return;
      }
      // 抓住滑块：记录抓取偏移，避免滑块“跳到鼠标左沿”。
      const grabOffset = event.clientX - thumbRect.left;
      let lastRaw = thumbRect.left - rect.left - 3;
      thumb.style.transition = 'none';
      wrap.dataset.dragging = '1';
      const onMove = e => {
        const raw = e.clientX - grabOffset - rect.left - 3;
        lastRaw = raw;
        wrap.style.setProperty('--thumb-x', Math.max(0, Math.min(half, raw)) + 'px');
        e.preventDefault();
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        thumb.style.transition = '';
        delete wrap.dataset.dragging;
        apply(lastRaw > half / 2);
        commit();
      };
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
    });

    return { node: wrap, sync() { apply(config.snap.mode === 'system'); } };
  }

  // 复用教程弹窗样式的确认框。
  // 确认框（复用教程弹窗样式）：点「确定」才执行 onConfirm。
  function confirmDialog(message, onConfirm) {
    const cancel = el('button', { class: 'bgg-tutorial-close', text: '取消' });
    const ok = el('button', { class: 'bgg-tutorial-close bgg-confirm-danger', text: '确定' });
    const card = el('div', { class: 'bgg-tutorial' },
      el('div', { class: 'bgg-tutorial-title', text: '确认' }),
      el('div', { class: 'bgg-tutorial-body' }, el('p', { text: message })),
      el('div', { class: 'bgg-tutorial-footer' }, cancel, ok));
    const overlay = el('div', { class: 'bgg-tutorial-overlay', 'data-mod-interactive': 'true' }, card);
    const dismiss = () => { try { overlay.remove(); } catch (error) { /* ignore */ } };
    cancel.addEventListener('click', dismiss);
    ok.addEventListener('click', () => { dismiss(); try { onConfirm(); } catch (error) { api.log?.('[beat-grid-guide] 确认操作失败', error); } });
    overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
    api.mount(overlay);
  }

  // 构建面板主体：总开关、横线、竖线、吸附、诊断、关于等分区。
  function buildBody() {
    const controls = {};

    const masterBadge = shortcutBadge('toggle-key');
    const masterToggle = toggleRow('总开关', config.enabled, value => { config.enabled = value; commit(); });
    controls.master = masterToggle.input;
    controls.badgeMaster = masterBadge.sync;
    const masterRow = el('div', { class: 'bgg-row-with-badge' }, masterToggle.node, masterBadge.node);

    const horizontalToggle = toggleRow('启用横线高亮', config.horizontal.enabled, value => { config.horizontal.enabled = value; commit(); });
    controls.horizontal = horizontalToggle.input;

    const verticalToggle = toggleRow('启用竖线高亮', config.vertical.enabled, value => { config.vertical.enabled = value; commit(); });
    controls.vertical = verticalToggle.input;

    const period = el('input', {
      type: 'number', class: 'bgg-number', min: '1', max: '64', step: '1', value: String(config.vertical.period),
    });
    period.addEventListener('input', () => {
      const value = Number(period.value);
      if (Number.isFinite(value)) { config.vertical.period = Math.min(64, Math.max(1, Math.round(value))); commit(); }
    });

    const centreToggle = toggleRow('单独强调中心线（x=0）', config.vertical.center.enabled, value => { config.vertical.center.enabled = value; commit(); });
    controls.center = centreToggle.input;

    const snapToggle = toggleRow('吸附功能总开关', config.snap.enabled, value => { config.snap.enabled = value; commit(); });
    controls.snap = snapToggle.input;
    const snapBadge = shortcutBadge('snap-mode-key');
    controls.badgeSnap = snapBadge.sync;
    const mode = modeSegment();
    controls.syncMode = mode.sync;

    const debugToggle = toggleRow('输出诊断日志到控制台', config.debug, value => { config.debug = value; commit(); });
    controls.debug = debugToggle.input;

    const patternsHost = el('div', { class: 'bgg-patterns' }, ...config.horizontal.patterns.map(patternRow));
    const patternHead = el('div', { class: 'bgg-pattern-head' },
      el('span', { text: '拍型' }),
      el('span', { text: '是否高亮' }),
      el('span', { text: '颜色' }),
      el('span', { text: '粗细' }),
      el('span', { text: '透明度' }),
      el('span', { text: '线型' }),
      el('span', { class: 'bgg-head-del', text: '删除该条' }));

    const numerator = el('input', { type: 'number', class: 'bgg-denominator', min: '1', max: '511', step: '1', placeholder: '分子' });
    const denominator = el('input', { type: 'number', class: 'bgg-denominator', min: '2', max: '512', step: '1', placeholder: '分母' });
    const addButton = el('button', { class: 'bgg-add', text: '添加' });
    addButton.addEventListener('click', () => {
      const num = Number(numerator.value);
      const den = Number(denominator.value);
      if (!Number.isFinite(den) || den < 2) { api.notify?.('分母需 ≥ 2', 'warning'); return; }
      if (!Number.isFinite(num) || num < 1 || num >= den) { api.notify?.('分子需在 1 与 分母-1 之间', 'warning'); return; }
      addCustomPattern(config, num, den);
      numerator.value = '';
      denominator.value = '';
      rebuild();
      commit();
    });

    // 恢复默认：全部拆成独立按钮。
    const resetRow = el('div', { class: 'bgg-reset-row' });
    for (const [label, part] of [['窗口大小', 'size'], ['快捷键', 'shortcuts'], ['横线配置', 'horizontal'], ['竖线配置', 'vertical'], ['吸附配置', 'snap']]) {
      const item = el('button', { class: 'bgg-add', text: '恢复默认' + label });
      item.addEventListener('click', () => {
        try { options.resetPart?.(part); } catch (error) { api.log?.('[beat-grid-guide] 恢复默认失败', error); }
      });
      resetRow.append(item);
    }
    const resetAll = el('button', { class: 'bgg-reset', text: '恢复全部默认' });
    resetAll.addEventListener('click', () => {
      confirmDialog('确定要恢复全部默认吗？会重置所有配置与面板尺寸，且无法撤销。', () => {
        try { onChange('reset'); } catch (error) { api.log?.('[beat-grid-guide] 恢复默认失败', error); }
      });
    });
    resetRow.append(resetAll);

    currentControls = controls;
    return el('div', { class: 'bgg-body' },
      masterRow,

      el('div', { class: 'bgg-section' },
        el('div', { class: 'bgg-section-title', text: '横线（节拍细分）' }),
        horizontalToggle.node,
        patternHead,
        patternsHost,
        el('p', { class: 'bgg-hint', text: '每拍内按所选节拍型绘制高亮线；相邻节拍过近时可能会导致难以辨别，请酌情添加。' }),
        el('div', { class: 'bgg-add-row' },
          el('span', { class: 'bgg-add-label', text: '自定义节奏型' }),
          numerator,
          el('span', { class: 'bgg-add-label', text: '/' }),
          denominator,
          addButton),
        el('p', { class: 'bgg-hint', text: '格式 分子/分母：每拍均分「分母」份、以「分子」为步长；如 3/4 只标 3/4 处一条。' }),
      ),

      el('div', { class: 'bgg-section' },
        el('div', { class: 'bgg-section-title', text: '竖线（音符 X 坐标，居中对称）' }),
        verticalToggle.node,
        el('label', { class: 'bgg-field' }, el('span', { text: '每隔 M 根高亮一根' }), period),
        styleGrid('高亮线样式', config.vertical.highlight),
        centreToggle.node,
        styleGrid('中心线样式', config.vertical.center),
        el('p', { class: 'bgg-hint', text: '以 x=0 为中心向两侧对称，用于确认音符横向位置。' }),
      ),

      el('div', { class: 'bgg-section' },
        el('div', { class: 'bgg-section-title', text: '吸附' }),
        snapToggle.node,
        el('div', { class: 'bgg-mode-head' },
          el('span', { class: 'bgg-sub-label', text: '吸附模式' }),
          snapBadge.node),
        mode.node,
        el('p', { class: 'bgg-hint', text: '仅高亮：吸附到启动「高亮」的线；仅原生：吸附到原生细网格。相邻节拍过近可能导致吸附错位或无效，请合理搭配节拍型、避免位置过于密集。' }),
      ),

      el('div', { class: 'bgg-section' },
        el('div', { class: 'bgg-section-title', text: '诊断' }),
        debugToggle.node,
        el('p', { class: 'bgg-hint', text: '用于排查挂接问题，平时无需开启。' }),
        resetRow,
      ),

      el('div', { class: 'bgg-section' },
        el('div', { class: 'bgg-section-title', text: '关于' }),
        el('div', { class: 'bgg-about-grid' },
          el('span', { class: 'bgg-about-label', text: '作者' }),
          el('span', { class: 'bgg-about-value', text: '一只仰望星空的小狼' }),
          el('span', { class: 'bgg-about-label', text: 'GitHub' }),
          el('a', {
            class: 'bgg-about-value',
            href: 'https://github.com/AWolfLUTS/RPEN--rpen-custom-beat-highlight',
            target: '_blank',
            rel: 'noopener noreferrer',
            text: 'github.com/AWolfLUTS/RPEN--rpen-custom-beat-highlight',
          }),
          el('span', { class: 'bgg-about-label', text: '版本' }),
          el('span', { class: 'bgg-about-value', text: 'v' + (api.manifest?.version || '1.2.1') }),
        ),
      ),
    );
  }

  const contentHost = el('div', { class: 'bgg-content' });
  const status = el('div', { class: 'bgg-status', text: '未启用（需打开总开关）' });
  const heightBar = el('div', { class: 'bgg-heightbar', title: '拖动调整高度' });
  const widthBar = el('div', { class: 'bgg-widthbar', title: '拖动调整大小' });

  const close = el('button', { class: 'bgg-close', title: '关闭', text: '×' });
  const head = el('div', { class: 'bgg-head' },
    el('span', { class: 'bgg-title', text: '自定义节拍高亮' }), close);

  const panel = el('div', { class: 'bgg-panel', 'data-mod-interactive': 'true' }, head, contentHost, status, heightBar, widthBar);
  panel.hidden = true;

  // ── 面板尺寸/位置 ──────────────────────────────────────────
  // 宽度默认 450（窄屏自适应），可拖右下角把手在 [450, 屏幕1/3] 内调整；高度在 [MIN_HEIGHT, 窗口高度] 内。
  // 面板默认/最小宽度（窄屏自适应到屏宽）。
  function fixedWidth() { return Math.min(MIN_WIDTH, window.innerWidth); }
  // 面板最大宽度：不超过屏幕宽度的一半。
  function maxWidth() { return Math.max(MIN_WIDTH, Math.floor(window.innerWidth / 2)); }

  // 把面板尺寸与位置钳制在屏幕内（拖拽/缩放/窗口变化后调用）。
  function clampPanel() {
    if (panel.hidden) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(fixedWidth(), panel.offsetWidth), maxWidth());
    const height = Math.min(Math.max(MIN_HEIGHT, panel.offsetHeight), vh);
    panel.style.width = width + 'px';
    panel.style.height = height + 'px';
    const rect = panel.getBoundingClientRect();
    const left = Math.min(Math.max(0, rect.left), Math.max(0, vw - width));
    const top = Math.min(Math.max(0, rect.top), Math.max(0, vh - height));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  // 恢复默认尺寸与位置（宽 450、高 700、靠右上方）。
  function resetSize() {
    const width = fixedWidth();
    panel.style.width = width + 'px';
    panel.style.height = MIN_HEIGHT + 'px';
    panel.style.maxHeight = 'none';
    panel.style.left = 'calc(100vw - ' + (width + 12) + 'px)';
    panel.style.top = '70px';
    clampPanel();
  }

  // 拖动标题栏时移动面板。
  function onDragMove(event) {
    if (!drag) return;
    panel.style.left = (drag.left + event.clientX - drag.x) + 'px';
    panel.style.top = (drag.top + event.clientY - drag.y) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    event.preventDefault();
  }
  // 结束拖动并钳制位置。
  function endDrag() {
    drag = null;
    document.removeEventListener('pointermove', onDragMove, true);
    document.removeEventListener('pointerup', endDrag, true);
    document.removeEventListener('pointercancel', endDrag, true);
    clampPanel();
  }
  // 按下标题栏开始拖动（避开按钮/输入控件）。
  function startDrag(event) {
    if (event.button !== 0) return;
    if (event.target.closest?.('button, input, select, textarea, a, label')) return;
    const rect = panel.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    event.preventDefault();
    event.stopPropagation();
    document.addEventListener('pointermove', onDragMove, true);
    document.addEventListener('pointerup', endDrag, true);
    document.addEventListener('pointercancel', endDrag, true);
  }
  head.addEventListener('pointerdown', startDrag);

  // 底部居中横条：上下拖动改变高度（宽度固定，不再有右下角斜向把手）。
  heightBar.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    const state = { y: event.clientY, height: rect.height, top: rect.top };
    event.preventDefault();
    event.stopPropagation();
    const move = e => {
      const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - state.top);
      const height = Math.min(maxHeight, Math.max(MIN_HEIGHT, state.height + (e.clientY - state.y)));
      panel.style.height = height + 'px';
      panel.style.maxHeight = 'none';
    };
    const up = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      clampPanel();
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
  });

  // 右下角把手：同时调整宽高（窗口左上角为锚点，向右下扩展）。
  widthBar.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    const state = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, left: rect.left, top: rect.top };
    event.preventDefault();
    event.stopPropagation();
    const move = e => {
      const limitWidth = Math.min(maxWidth(), window.innerWidth - state.left);
      const width = Math.min(limitWidth, Math.max(fixedWidth(), state.width + (e.clientX - state.x)));
      const limitHeight = Math.max(MIN_HEIGHT, window.innerHeight - state.top);
      const height = Math.min(limitHeight, Math.max(MIN_HEIGHT, state.height + (e.clientY - state.y)));
      panel.style.width = width + 'px';
      panel.style.height = height + 'px';
      panel.style.left = state.left + 'px';
      panel.style.top = state.top + 'px';
      panel.style.maxHeight = 'none';
    };
    const up = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      clampPanel();
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
  });

  // 显示面板：重建主体并钳制位置。
  function show() {
    panel.hidden = false;
    if (!panel.style.left) { panel.style.left = 'calc(100vw - ' + (MIN_WIDTH + 12) + 'px)'; panel.style.top = '70px'; }
    rebuild();
    clampPanel();
    launcher?.classList.add('active');
  }
  // 隐藏面板：同时取消快捷键录制与取色浮层。
  function hide() { cancelShortcutRecording?.(); closeColorPop(); panel.hidden = true; launcher?.classList.remove('active'); }
  // 切换面板显示/隐藏。
  function toggle() { if (panel.hidden) show(); else hide(); }

  close.addEventListener('click', () => hide());

  let launcher = null;
  // 在工具条「吸附」旁创建「网格」按钮，点开设置面板。
  function createLauncher() {
    const button = el('button', {
      type: 'button', class: 'bgg-toolbar-button', 'data-mod-interactive': 'true',
      title: '自定义节拍高亮（打开设置）', text: '网格',
    });
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toggle(); });
    const toolbar = typeof document !== 'undefined' ? document.querySelector('.editor-toolbar') : null;
    if (toolbar) {
      api.mount(button, toolbar);
      const anchor = document.querySelector('#snap-x')?.closest('label')
        ?? document.querySelector('#grid-count')?.closest('label');
      if (anchor && anchor.parentElement === toolbar) toolbar.insertBefore(button, anchor.nextSibling);
    } else {
      button.classList.add('bgg-fab');
      api.mount(button);
    }
    return button;
  }

  // 刷新底部状态行（启用/吸附/响应次数）。
  function refreshStatus() {
    const stats = typeof options.getStats === 'function' ? options.getStats() : { calls: 0, active: false };
    status.dataset.active = '0';
    if (!config.enabled) { status.textContent = '未启用（需打开总开关）'; return; }
    if (!config.snap.enabled) { status.textContent = '吸附已关闭'; return; }
    status.dataset.active = '1';
    if (config.snap.mode === 'system') { status.textContent = '吸附：仅原生（原生细网格） · 已响应 ' + stats.calls + ' 次'; return; }
    const names = config.horizontal.patterns.filter(p => p.enabled && p.denominator > 1).map(p => p.name);
    status.textContent = '吸附：仅高亮' + (names.length ? '（' + names.join('、') + '）' : '（未选择节拍型）') + ' · 已响应 ' + stats.calls + ' 次';
  }

  // 重建面板主体，并保留当前滚动位置。
  function rebuild() {
    const scrollTop = contentHost.scrollTop;
    contentHost.replaceChildren(buildBody());
    contentHost.scrollTop = scrollTop;
    refreshStatus();
  }

  // 把配置状态同步回面板控件（命令/快捷键变化时用）；不重建，保留滚动位置。
  // In-place sync (no rebuild, keeps scroll position) for shortcut-driven changes.
  function sync() {
    const controls = currentControls;
    if (!controls) return;
    controls.master.checked = config.enabled;
    controls.horizontal.checked = config.horizontal.enabled;
    controls.vertical.checked = config.vertical.enabled;
    controls.center.checked = config.vertical.center.enabled;
    controls.snap.checked = config.snap.enabled;
    controls.debug.checked = config.debug;
    controls.syncMode?.();
    controls.badgeMaster?.();
    controls.badgeSnap?.();
    refreshStatus();
  }

  // 显示新手教程弹窗（首次启用自动弹一次）。
  function showTutorial() {
    if (tutorial) { try { tutorial.remove(); } catch (error) { /* ignore */ } tutorial = null; }
    const closeButton = el('button', { class: 'bgg-tutorial-close', text: '知道了' });
    const card = el('div', { class: 'bgg-tutorial' },
      el('div', { class: 'bgg-tutorial-title', text: '新手教程 · 自定义节拍高亮' }),
      el('div', { class: 'bgg-tutorial-body' },
        el('p', { text: '你好！这个模组用于给制谱网格添加不同节奏型的自定义高亮与吸附，相关说明如下：' }),
        el('ul', {},
          el('li', { text: '总开关：控制整个模组是否生效（默认快捷键 M，点按开关附近半透明按钮即可修改），关闭后全部功能不生效。' }),
          el('li', { text: '横线区域：自定义每拍内的细分高亮线。每个节拍型均按照「分子/分母」，如 1/4、3/4；勾选「高亮」即显示，可自定义颜色透明度等属性。' }),
          el('li', { text: '竖线区域：音符视图的 X 坐标参考线，以中心对称、每隔 M 根高亮一根。' }),
          el('li', { text: '吸附功能总开关：打开后吸附全部已开启的高亮线。模式：「仅高亮」仅吸附到高亮线，「仅原生」仅吸附到原生细网格（默认快捷键 N 切换，点按开关附近半透明按钮即可修改）。' }),
          el('li', { text: '其他提示：相邻节拍过近可能导致吸附错位，请合理搭配节拍型、避免位置过于密集。' }),
        ),
        el('p', { text: '可在模组管理器点击「重看新手教程」再次查看本说明。' }),
      ),
      el('div', { class: 'bgg-tutorial-footer' }, closeButton));
    const overlay = el('div', { class: 'bgg-tutorial-overlay', 'data-mod-interactive': 'true' }, card);
    const dismiss = () => { try { overlay.remove(); } catch (error) { /* ignore */ } if (tutorial === overlay) tutorial = null; };
    closeButton.addEventListener('click', dismiss);
    overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
    api.mount(overlay);
    tutorial = overlay;
  }

  rebuild();
  launcher = createLauncher();
  api.mount(panel);
  const timer = api.interval?.(() => { if (!panel.hidden) refreshStatus(); }, 800);
  const onWindowResize = api.listen?.(window, 'resize', () => clampPanel());

  return {
    show, hide, toggle,
    refresh() { rebuild(); },
    sync,
    resetSize,
    showTutorial,
    dispose() {
      clearTimeout(commitTimer);
      cancelShortcutRecording?.();
      closeColorPop();
      try { timer?.(); } catch (error) { /* ignore */ }
      try { onWindowResize?.(); } catch (error) { /* ignore */ }
      if (tutorial) { try { tutorial.remove(); } catch (error) { /* ignore */ } tutorial = null; }
      for (const node of [panel, launcher]) { try { node?.remove?.(); } catch (error) { /* ignore */ } }
    },
  };
}
