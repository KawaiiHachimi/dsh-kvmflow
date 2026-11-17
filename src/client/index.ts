/**
 * KVMFlow browser half: a native DSH main panel plus sidebar entry.
 *
 * The module is intentionally self-contained so the DSH client module loader
 * can evaluate it without a bundler. React comes from the browser module
 * table; Host operations go through the authenticated `/kvmflow` RPC channel.
 */
(window as any).__ModuleLoader__.load({
  id: 'dsh-kvmflow',
  factory(requireModule: (id: string) => any) {
    const React = requireModule('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useMemo = React.useMemo;
    const useCallback = React.useCallback;
    const useRef = React.useRef;

    const CSS = `
.kvmflow-root {
  container-type: inline-size;
  height: 100%;
  overflow: auto;
  padding: 14px 22px 64px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  box-sizing: border-box;
  font-size: 13px;
  line-height: 1.5;
}
.kvmflow-root * { box-sizing: border-box; }
.kvmflow-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; flex-wrap: nowrap; }
.kvmflow-head-main { min-width: 0; flex: 1 1 auto; overflow: hidden; }
.kvmflow-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.kvmflow-title { margin: 0; font-size: 18px; font-weight: 650; letter-spacing: -0.01em; line-height: 1.3; white-space: nowrap; }
.kvmflow-sub { margin: 1px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Device pill, selector, and Refresh stay on one line: each shrinks instead of
   wrapping, and the pill's text (already shown by the selector) drops first. */
.kvmflow-head-right { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0; flex: 0 1 auto; }
.kvmflow-pill-device { max-width: 10rem; min-width: 0; }
.kvmflow-pill-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.kvmflow-head-right .kvmflow-btn { flex: none; }
.kvmflow-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l1); margin: 6px 0 12px; }
.kvmflow-tab { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); padding: 6px 10px 7px; font: inherit; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; border-radius: 6px 6px 0 0; }
@media (hover: hover) {
  .kvmflow-tab:hover { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 70%, transparent); }
}
.kvmflow-tab.active { color: var(--dsw-alias-brand-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.kvmflow-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.kvmflow-grid { display: grid; gap: 14px; }
.kvmflow-grid.two { grid-template-columns: minmax(0, 2.1fr) minmax(280px, 0.75fr); align-items: start; }
/* Wide mode drops the side column so the screen owns the panel width, and caps
   its height so the controls below stay reachable. */
.kvmflow-grid.wide { grid-template-columns: minmax(0, 1fr); }
.kvmflow-grid.wide .kvmflow-screen-wrap { display: flex; justify-content: center; }
.kvmflow-grid.wide .kvmflow-screen-stage { width: 100%; }
.kvmflow-grid.wide .kvmflow-screen { width: 100%; }
@media (max-width: 980px) { .kvmflow-grid.two { grid-template-columns: minmax(0, 1fr); } }
.kvmflow-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 12px); padding: 14px 16px; }
.kvmflow-card + .kvmflow-card { margin-top: 12px; }
.kvmflow-card-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-weight: 600; font-size: 13px; margin: 0 0 10px; }
.kvmflow-card-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 400; }
.kvmflow-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kvmflow-col { display: flex; flex-direction: column; gap: 8px; }
.kvmflow-muted { color: var(--dsw-alias-label-secondary); }
.kvmflow-mono { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 12px; }
/* Buttons, selects, and text inputs share one height so a toolbar row lines up. */
.kvmflow-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
@media (hover: hover) {
  .kvmflow-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 70%, var(--dsw-alias-bg-base)); }
}
.kvmflow-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.kvmflow-btn:disabled { opacity: 0.45; cursor: default; }
.kvmflow-btn.primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); font-weight: 600; }
.kvmflow-btn.danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l1)); }
.kvmflow-btn.small { padding: 2px 7px; font-size: 11px; }
.kvmflow-input, .kvmflow-select, .kvmflow-textarea { width: 100%; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 6px 8px; font: inherit; font-size: 12px; outline: none; }
.kvmflow-input:focus, .kvmflow-select:focus, .kvmflow-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.kvmflow-textarea { min-height: 260px; resize: vertical; line-height: 1.55; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 12px; }
.kvmflow-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.kvmflow-field > label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kvmflow-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.kvmflow-form-grid .wide { grid-column: 1 / -1; }
.kvmflow-pill { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 1px 8px; font-size: 11px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); white-space: nowrap; }
.kvmflow-pill.ok { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, var(--dsw-alias-border-l1)); }
.kvmflow-pill.warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, var(--dsw-alias-border-l1)); }
.kvmflow-pill.err { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l1)); }
.kvmflow-pill.brand { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, var(--dsw-alias-border-l1)); }
.kvmflow-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); display: inline-block; }
.kvmflow-dot.on { background: var(--dsw-alias-state-success-primary); }
.kvmflow-dot.err { background: var(--dsw-alias-state-error-primary); }
.kvmflow-notice { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); border-radius: 8px; padding: 7px 10px; margin-bottom: 10px; font-size: 12px; display: flex; justify-content: space-between; gap: 12px; }
.kvmflow-notice.err { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l1)); }
.kvmflow-notice.ok { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, var(--dsw-alias-border-l1)); }
.kvmflow-screen-wrap { position: relative; background: #000; border-radius: 9px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); outline: none; touch-action: none; overscroll-behavior: contain; }
.kvmflow-screen-wrap:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent); }
.kvmflow-screen-stage { position: relative; display: block; line-height: 0; }
.kvmflow-screen { display: block; width: 100%; height: auto; background: #000; user-select: none; -webkit-user-drag: none; cursor: crosshair; }
.kvmflow-screen-target { position: absolute; border: 1px dashed color-mix(in srgb, var(--dsw-alias-brand-primary) 75%, transparent); border-radius: 2px; pointer-events: none; box-sizing: border-box; }
.kvmflow-screen-readout { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
.kvmflow-screen-empty { aspect-ratio: 16 / 9; display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary); font-size: 12px; background: var(--dsw-alias-bg-layer-2); }
/* Square icon control that lines up with the text buttons beside it. */
.kvmflow-icon-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; flex: none; padding: 5px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); cursor: pointer; }
@media (hover: hover) {
  .kvmflow-icon-btn:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 14%, var(--dsw-alias-bg-layer-2)); }
}
.kvmflow-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.kvmflow-icon-btn[aria-pressed='true'] { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1)); }
.kvmflow-screen-status { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kvmflow-inline-select { width: auto; flex: none; padding: 2px 6px; font-size: 11px; }
.kvmflow-log { max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 3px; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11px; }
.kvmflow-log-row { display: flex; gap: 8px; border-bottom: 1px dashed color-mix(in srgb, var(--dsw-alias-border-l1) 60%, transparent); padding-bottom: 3px; }
.kvmflow-log-time { color: var(--dsw-alias-label-secondary); flex: none; }
.kvmflow-log-row.err { color: var(--dsw-alias-state-error-primary); }
.kvmflow-log-row.warn { color: var(--dsw-alias-state-warn-primary); }
.kvmflow-steps { display: flex; flex-direction: column; gap: 8px; }
.kvmflow-step { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 9px 11px; background: var(--dsw-alias-bg-layer-2); }
.kvmflow-step.passed { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, var(--dsw-alias-border-l1)); }
.kvmflow-step.failed, .kvmflow-step.paused { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l1)); }
.kvmflow-step-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.kvmflow-step-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kvmflow-step-body { margin-top: 5px; display: flex; flex-direction: column; gap: 4px; }
.kvmflow-thumb-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.kvmflow-thumb { width: 170px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); display: block; background: #000; }
.kvmflow-empty { border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; padding: 26px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.kvmflow-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; font-size: 12px; }
.kvmflow-kv dt { color: var(--dsw-alias-label-secondary); }
.kvmflow-kv dd { margin: 0; }
.kvmflow-device { border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm, 8px); padding: 11px 13px; display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; background: var(--dsw-alias-bg-layer-1); flex-wrap: wrap; min-width: 0; }
.kvmflow-device > div:first-child { min-width: 0; flex: 1 1 160px; }
.kvmflow-device-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kvmflow-device.selected { border-color: var(--dsw-alias-brand-primary); }
.kvmflow-device-name { font-weight: 600; min-width: 0; }
.kvmflow-tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary); }
.kvmflow-split { height: 1px; background: var(--dsw-alias-border-l1); margin: 12px 0; }
.kvmflow-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
/* Every card keeps its controls in one wrapping row at the bottom of the body:
   a header row has no room for four buttons plus an armed confirmation. */
.kvmflow-card-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
.kvmflow-card-actions > .kvmflow-btn { flex: none; }
.kvmflow-card-actions > .kvmflow-confirm { flex: 1 1 100%; justify-content: flex-start; }
/* An even row of controls where the label lengths differ but the boxes do not. */
.kvmflow-form-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.kvmflow-form-actions > .kvmflow-btn { flex: none; }
.kvmflow-textarea.compact { min-height: 90px; }
.kvmflow-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kvmflow-code { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 11px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 2px 5px; }
.kvmflow-checkline { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.kvmflow-scroll-y { max-height: 440px; overflow: auto; padding-right: 2px; }
.kvmflow-busy { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kvmflow-spinner { width: 10px; height: 10px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent); border-top-color: var(--dsw-alias-brand-primary); animation: kvmflow-spin 0.8s linear infinite; }
@keyframes kvmflow-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .kvmflow-spinner { animation: none; } }
.kvmflow-thumb-error { display: inline-flex; align-items: center; justify-content: center; width: 130px; height: 74px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-xs, 4px); color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; padding: 4px; }
.kvmflow-confirm { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsw-alias-state-warn-primary); flex-wrap: wrap; justify-content: flex-end; }

.kvmflow-confirm-text { white-space: nowrap; }
.kvmflow-root.compact { padding: 12px 14px 40px; }
.kvmflow-device-select { flex: 0 1 auto; min-width: 7rem; max-width: 18rem; width: auto; }
@container (max-width: 720px) {
  /* The selector already names the device, so the pill's text goes first. */
  .kvmflow-pill-device { display: none; }
}
@container (max-width: 560px) {
  .kvmflow-grid.two { grid-template-columns: minmax(0, 1fr); }
  .kvmflow-sub { display: none; }
  .kvmflow-head-right { flex: 1 1 auto; justify-content: flex-end; }
  .kvmflow-device-select { flex: 1 1 auto; min-width: 0; max-width: none; }
  .kvmflow-thumb { width: 130px; }
  .kvmflow-title { font-size: 17px; }
}

`;

    function cn(...values: any[]): string {
      return values.filter(Boolean).join(' ');
    }

    // Mirrors src/host/view.ts. The client half cannot import the Host module
    // across the bundle boundary, so the same two formulas live here.
    function isFullFrameMapping(mapping: any): boolean {
      return mapping === undefined || mapping === null
        || (mapping.left === 0 && mapping.top === 0 && mapping.right === 1 && mapping.bottom === 1);
    }

    function clamp01(value: number): number {
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    }

    function frameToTargetPoint(mapping: any, x: number, y: number): { x: number; y: number } {
      if (isFullFrameMapping(mapping)) return { x: clamp01(x), y: clamp01(y) };
      return {
        x: clamp01((x - mapping.left) / Math.max(1e-6, mapping.right - mapping.left)),
        y: clamp01((y - mapping.top) / Math.max(1e-6, mapping.bottom - mapping.top)),
      };
    }

    /**
     * Find the target's screen inside a captured frame by trimming uniform black
     * bars. A frame that is entirely the target returns undefined; so does an
     * ambiguous result, because a wrong mapping is worse than no mapping.
     */
    function detectContentMapping(media: any): any {
      try {
        // Works for an <img> snapshot and for a <video> element.
        const naturalWidth = media.videoWidth || media.naturalWidth || media.width;
        const naturalHeight = media.videoHeight || media.naturalHeight || media.height;
        if (!(naturalWidth > 0) || !(naturalHeight > 0)) return undefined;
        const width = 360;
        const height = Math.max(8, Math.round(width * naturalHeight / naturalWidth));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context === null || context === undefined) return undefined;
        context.drawImage(media, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        const luma = (x: number, y: number): number => {
          const index = (y * width + x) * 4;
          return (data[index] + data[index + 1] + data[index + 2]) / 3;
        };
        const isBar = (x: number, y: number): boolean => luma(x, y) <= 22;
        const columnIsBar = (x: number): boolean => {
          let dark = 0;
          for (let y = 0; y < height; y += 1) if (isBar(x, y)) dark += 1;
          return dark / height >= 0.985;
        };
        const rowIsBar = (y: number): boolean => {
          let dark = 0;
          for (let x = 0; x < width; x += 1) if (isBar(x, y)) dark += 1;
          return dark / width >= 0.985;
        };
        const limitX = Math.floor(width * 0.3);
        const limitY = Math.floor(height * 0.3);
        let left = 0;
        while (left < limitX && columnIsBar(left)) left += 1;
        let right = width - 1;
        while (right > width - 1 - limitX && columnIsBar(right)) right -= 1;
        let top = 0;
        while (top < limitY && rowIsBar(top)) top += 1;
        let bottom = height - 1;
        while (bottom > height - 1 - limitY && rowIsBar(bottom)) bottom -= 1;
        if (right - left + 1 < width * 0.45 || bottom - top + 1 < height * 0.45) return undefined;
        let sum = 0;
        let count = 0;
        for (let y = top; y <= bottom; y += 2) {
          for (let x = left; x <= right; x += 2) {
            sum += luma(x, y);
            count += 1;
          }
        }
        const contentLuma = count === 0 ? 0 : sum / count;
        // An all-black frame would otherwise trim to a false 40% box.
        if (contentLuma < 12) return undefined;
        const mapping = {
          left: left / width,
          top: top / height,
          right: (right + 1) / width,
          bottom: (bottom + 1) / height,
        };
        if (mapping.left < 0.006) mapping.left = 0;
        if (mapping.top < 0.006) mapping.top = 0;
        if (mapping.right > 0.994) mapping.right = 1;
        if (mapping.bottom > 0.994) mapping.bottom = 1;
        if (isFullFrameMapping(mapping)) return undefined;
        const contentAspect = ((mapping.right - mapping.left) * naturalWidth) / ((mapping.bottom - mapping.top) * naturalHeight);
        if (contentAspect < 0.4 || contentAspect > 2.8) return undefined;
        return mapping;
      } catch (error) {
        return undefined;
      }
    }

    /** Resolve once the local description carries its candidates, or after a bounded wait. */
    function waitForIce(pc: any, timeoutMs = 1500): Promise<void> {
      return new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        let settled = false;
        const done = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (typeof pc.removeEventListener === 'function') pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        };
        const check = (): void => { if (pc.iceGatheringState === 'complete') done(); };
        const timer = setTimeout(done, timeoutMs);
        if (typeof pc.addEventListener === 'function') pc.addEventListener('icegatheringstatechange', check);
      });
    }

    function formatTime(at?: number): string {
      if (typeof at !== 'number' || at <= 0) return '';
      const date = new Date(at);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatDateTime(at?: number): string {
      if (typeof at !== 'number' || at <= 0) return '—';
      return new Date(at).toLocaleString();
    }

    function statusTone(status?: string): string {
      if (status === 'succeeded' || status === 'passed') return 'ok';
      if (status === 'failed' || status === 'aborted') return 'err';
      if (status === 'paused' || status === 'armed' || status === 'verifying') return 'warn';
      if (status === 'running' || status === 'acting' || status === 'precheck') return 'brand';
      return '';
    }

    function Btn(props: any): any {
      // Forward ARIA state so toggles announce themselves instead of only
      // changing their label.
      const aria: Record<string, unknown> = {};
      for (const key of Object.keys(props)) {
        if (key.startsWith('aria-')) aria[key] = props[key];
      }
      return h('button', {
        type: 'button',
        className: cn('kvmflow-btn', props.kind, props.className),
        onClick: props.onClick,
        disabled: props.disabled === true,
        title: props.title,
        ...aria,
      }, props.children);
    }

    function Pill(props: any): any {
      return h('span', { className: cn('kvmflow-pill', props.tone) }, props.children);
    }

    function Field(props: any): any {
      return h('div', { className: cn('kvmflow-field', props.className) },
        props.label === undefined ? null : h('label', null, props.label),
        props.children,
        props.hint === undefined ? null : h('span', { className: 'kvmflow-hint' }, props.hint),
      );
    }

    function Card(props: any): any {
      // `actions` is an in-title toolbar for viewer controls; anything longer than
      // one control belongs in a CardActions row under the title instead.
      const actions = Array.isArray(props.actions)
        ? props.actions.map((node: any, index: number) => (node === null || node === undefined ? null : h(React.Fragment, { key: index }, node)))
        : props.actions;
      return h('section', { className: cn('kvmflow-card', props.className), style: props.style },
        props.title === undefined ? null : h('h2', { className: 'kvmflow-card-title' },
          h('span', null, props.title, props.subtitle === undefined ? null : h('span', { className: 'kvmflow-card-sub' }, ` · ${props.subtitle}`)),
          actions === undefined ? null : h('div', { className: 'kvmflow-actions' }, actions),
        ),
        props.children,
      );
    }

    /** A card's controls, always in one wrapping row at the bottom of its body. */
    function CardActions(props: any): any {
      return h('div', { className: cn('kvmflow-card-actions', props.className) },
        props.children,
      );
    }

    function Empty(props: any): any {
      return h('div', { className: 'kvmflow-empty' }, props.children);
    }

    function Notice(props: any): any {
      if (props.message === undefined || props.message === null) return null;
      return h('div', {
        className: cn('kvmflow-notice', props.tone),
        role: props.tone === 'err' ? 'alert' : 'status',
      },
        h('span', null, props.message),
        h('span', { className: 'kvmflow-actions' },
          props.action === undefined ? null : h('button', {
            type: 'button',
            className: 'kvmflow-btn small',
            onClick: () => { props.action.onClick(); props.onClose(); },
          }, props.action.label),
          h('button', { type: 'button', className: 'kvmflow-btn small', 'aria-label': props.dismissLabel ?? 'Dismiss', title: props.dismissLabel ?? 'Dismiss', onClick: props.onClose }, '×'),
        ),
      );
    }

    /** Two-step destructive control: the first click arms, the second confirms. */
    function ConfirmButton(props: any): any {
      const [armed, setArmed] = useState(false);
      const timer = useRef();
      useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current); }, []);
      useEffect(() => {
        if (!armed) return undefined;
        timer.current = setTimeout(() => setArmed(false), 5000);
        return () => { if (timer.current !== undefined) clearTimeout(timer.current); };
      }, [armed]);
      if (!armed) {
        return h(Btn, {
          kind: props.kind,
          disabled: props.disabled,
          title: props.title,
          onClick: () => setArmed(true),
        }, props.children);
      }
      return h('span', { className: 'kvmflow-confirm' },
        h('span', { className: 'kvmflow-confirm-text' }, props.confirmLabel ?? 'Confirm?'),
        h(Btn, { kind: 'danger', disabled: props.disabled, onClick: () => { setArmed(false); props.onConfirm(); } }, props.confirmAction ?? 'Delete'),
        h(Btn, { onClick: () => setArmed(false) }, props.cancelLabel ?? 'Cancel'),
      );
    }

    function StepStatus(props: any): any {
      const status = props.status ?? 'pending';
      const label = props.t === undefined ? status : statusLabel(props.t, status);
      return h(Pill, { tone: statusTone(status), status }, label);
    }

    function ImageThumb(props: any): any {
      const [source, setSource] = useState(undefined);
      const [failed, setFailed] = useState(false);
      useEffect(() => {
        let alive = true;
        setSource(undefined);
        setFailed(false);
        if (typeof props.path !== 'string' || props.path === '') return undefined;
        props.shared.rpc('image.read', { path: props.path })
          .then((value: any) => { if (alive) setSource(`data:${value.mediaType};base64,${value.data}`); })
          .catch(() => { if (alive) setFailed(true); });
        return () => { alive = false; };
      }, [props.path]);
      if (typeof props.path !== 'string' || props.path === '') return null;
      if (failed) {
        return h('span', { className: 'kvmflow-thumb-error', title: props.path },
          props.shared.t('截图不可用', 'Screenshot unavailable'),
        );
      }
      if (source === undefined) return h('span', { className: 'kvmflow-hint' }, props.label ?? props.shared.t('载入中…', 'loading…'));
      return h('img', { className: 'kvmflow-thumb', src: source, alt: props.label ?? 'screen capture' });
    }

    /** Human-readable run and step status through the active locale. */
    function statusLabel(t: (zh: string, en: string) => string, status: string): string {
      const labels: Record<string, [string, string]> = {
        starting: ['启动中', 'starting'],
        armed: ['等待开机', 'armed'],
        running: ['执行中', 'running'],
        paused: ['已暂停', 'paused'],
        succeeded: ['已完成', 'succeeded'],
        failed: ['失败', 'failed'],
        aborted: ['已中止', 'aborted'],
        pending: ['待执行', 'pending'],
        precheck: ['检查前置条件', 'precheck'],
        acting: ['执行动作', 'acting'],
        verifying: ['验证画面', 'verifying'],
        passed: ['通过', 'passed'],
        skipped: ['跳过', 'skipped'],
      };
      const entry = labels[status];
      return entry === undefined ? status : t(entry[0], entry[1]);
    }

            /** Panel/tab glyph: the black monitor mark from icon.svg with its pink cursor. */
    function Icon(props: any): any {
      const size = typeof props.size === 'number' ? props.size : 18;
      // label-primary is black on the light theme and white on the dark one, so a
      // black line drawing stays legible in both instead of vanishing on dark.
      const stroke = 'var(--dsw-alias-label-primary)';
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 36 36',
        role: 'img',
        'aria-label': 'KVMFlow',
        focusable: 'false',
        fill: 'none',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        h('g', { stroke, strokeWidth: 2 },
          h('rect', { x: 4.5, y: 6.3, width: 27, height: 18.4, rx: 2.8 }),
          h('path', { d: 'M18 24.7L18 28.5' }),
          h('path', { d: 'M11.6 29.7L24.4 29.7' }),
        ),
        h('path', {
          d: 'M14.8 11.92L15.17 11.9L21.35 15.25L21.22 15.92L18.04 16.25L16.36 19.1L15.71 18.98L14.65 12.27Z',
          stroke: '#ec4899',
          strokeWidth: 1.4,
        }),
      );
    }

/** Outline glyph: corners point outward for the wide layout. */
    function IconExpand(props: any): any {
      const size = typeof props.size === 'number' ? props.size : 15;
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M4 9V4h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M15 4h5v5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M20 15v5h-5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M9 20H4v-5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    /** Outline glyph: corners point inward for the standard layout. */
    function IconCollapse(props: any): any {
      const size = typeof props.size === 'number' ? props.size : 15;
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M9 4v5H4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M20 9h-5V4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M15 20v-5h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M4 15h5v5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    function apply(ctx: any): void {
      // One subscription thunk and one snapshot reader for every panel instance:
      // a fresh arrow per render would resubscribe the whole page each time.
      const subscribeLocale = (listener: () => void) => ctx.locale.subscribe(listener);
      const readLocale = () => ctx.locale.getSnapshot();

      function useT(): (zh: string, en: string) => string {
        const snapshot = React.useSyncExternalStore(subscribeLocale, readLocale, readLocale);
        const active = typeof snapshot?.active === 'string' ? snapshot.active : 'en';
        // Stable identity while the locale is unchanged: an effect that lists the
        // translator would otherwise re-run on every render.
        return React.useCallback((zh: string, en: string) => (active.toLowerCase().startsWith('zh') ? zh : en), [active]);
      }

      async function rpc(method: string, params: any = {}, signal?: AbortSignal): Promise<any> {
        const response = await fetch(new URL('kvmflow/rpc', document.baseURI), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, params }),
          credentials: 'same-origin',
          ...(signal === undefined ? {} : { signal }),
        });
        const text = await response.text();
        let result: any;
        try {
          result = JSON.parse(text);
        } catch {
          throw new Error(`KVMFlow RPC ${method} returned HTTP ${response.status}`);
        }
        if (result === undefined || result.ok !== true) {
          const error = new Error(result?.error?.message ?? `KVMFlow RPC ${method} failed`);
          (error as any).code = result?.error?.code ?? 'kvmflow/rpc';
          throw error;
        }
        return result.value;
      }

      function Panel(props: any): any {
        const t = useT();
        const compact = props?.compact === true;
        const [state, setState] = useState(undefined);
        const [tab, setTab] = useState('live');
        const [deviceId, setDeviceIdState] = useState(() => {
          try { return window.localStorage.getItem('kvmflow.deviceId') ?? ''; } catch { return ''; }
        });
        const [busy, setBusy] = useState('');
        const [notice, setNotice] = useState(undefined);
        // Drafts live above the tab switch so an unsaved YAML edit or a half-typed
        // step never disappears when the user looks at another tab.
        const [workflowDraft, setWorkflowDraft] = useState({ id: '', yaml: '', dirty: false });
        const [recordDraft, setRecordDraft] = useState({ name: '', description: '', stepName: '', stepDesc: '' });
        const [promptFallback, setPromptFallback] = useState('');
        const [logs, setLogs] = useState([]);
        const log = useCallback((kind: 'info' | 'err' | 'warn', message: string) => {
          setLogs(current => [...current.slice(-119), { at: Date.now(), kind, message }]);
        }, []);
        const notify = useCallback((message: string, tone?: string, action?: { label: string; onClick: () => void }) => {
          setNotice({ message, tone, ...(action === undefined ? {} : { action }) });
          log(tone === 'err' ? 'err' : tone === 'ok' ? 'info' : 'warn', message);
        }, [log]);
        /** Hand one prompt to the agent in a new Session, or surface it for manual copy. */
        const handPrompt = useCallback(async (prompt: string, okMessage: string, errMessage: string) => {
          const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
          if (workspace !== undefined && typeof workspace.startSession === 'function') {
            workspace.startSession(undefined, { prompt, whenDraftExists: 'append' });
            setPromptFallback('');
            notify(okMessage, 'ok');
            return;
          }
          if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
            try {
              await navigator.clipboard.writeText(prompt);
              setPromptFallback('');
              notify(okMessage, 'ok');
              return;
            } catch (error: any) {
              // Fall through to the inline prompt.
            }
          }
          setPromptFallback(prompt);
          notify(errMessage, 'warn');
        }, [notify]);
        const setDeviceId = useCallback((id: string) => {
          setDeviceIdState(id);
          try { window.localStorage.setItem('kvmflow.deviceId', id); } catch { /* ignore */ }
        }, []);
        const refresh = useCallback(async () => {
          try {
            const next = await rpc('state');
            setState(next);
            if (deviceId === '' && typeof next.defaultDeviceId === 'string') setDeviceId(next.defaultDeviceId);
            if (deviceId !== '' && Array.isArray(next.devices) && !next.devices.some((device: any) => device.id === deviceId)) {
              setDeviceId(typeof next.defaultDeviceId === 'string' ? next.defaultDeviceId : '');
            }
          } catch (error: any) {
            setNotice({ message: error.message ?? String(error), tone: 'err' });
          }
        }, [deviceId, setDeviceId]);
        useEffect(() => {
          void refresh();
          const timer = setInterval(() => { void refresh(); }, 4000);
          return () => clearInterval(timer);
        }, [refresh]);
        const runRpc = useCallback(async (label: string, method: string, params: any = {}) => {
          setBusy(label);
          try {
            const value = await rpc(method, params);
            return value;
          } catch (error: any) {
            notify(error.message ?? String(error), 'err');
            return undefined;
          } finally {
            setBusy('');
          }
        }, [notify]);
        const probe = useCallback(async (id: string) => {
          if (id === '') {
            notify(t('请先选择设备。', 'Select a device first.'), 'warn');
            return;
          }
          const value = await runRpc(t('测试连接', 'Test connection'), 'device.probe', { deviceId: id });
          if (value === undefined) return;
          const probeValue = value.probe ?? {};
          if (probeValue.video === true) notify(t('连接成功，已获取画面信号。', 'Connected; video signal available.'), 'ok');
          else if (probeValue.reachable === false) notify(t('无法连接设备，请检查地址与网络。', 'Cannot reach the device; check the origin and network.'), 'err');
          else if (probeValue.authenticated === false) notify(t('设备可达但访问令牌被拒绝。', 'Device reachable but the access token was rejected.'), 'err');
          else notify(t('设备与令牌有效，但当前没有画面信号（目标机可能未开机）。', 'Device and token are valid, but there is no video signal (the target may be off).'), 'warn');
        }, [notify, runRpc, t]);
        const shared = useMemo(() => ({
          state, setState, tab, setTab, deviceId, setDeviceId, busy, setBusy, notify, log, logs, setLogs, refresh, rpc, runRpc, t,
          workflowDraft, setWorkflowDraft, recordDraft, setRecordDraft, handPrompt, probe,
        }), [state, tab, deviceId, busy, notify, log, logs, refresh, runRpc, t, workflowDraft, recordDraft, handPrompt, probe]);
        if (state === undefined) {
          return h('div', { className: 'kvmflow-root' }, h('style', null, CSS), h('div', { className: 'kvmflow-empty' }, busy || t('正在加载 KVMFlow…', 'Loading KVMFlow…')));
        }
        const tabs: Array<{ id: string; zh: string; en: string }> = [
          { id: 'live', zh: '实时画面', en: 'Live screen' },
          { id: 'devices', zh: '设备', en: 'Devices' },
          { id: 'recorder', zh: '录制器', en: 'Recorder' },
          { id: 'workflows', zh: '工作流', en: 'Workflows' },
          { id: 'runs', zh: '执行', en: 'Runs' },
        ];
        const selectedDevice = (state.devices ?? []).find((device: any) => device.id === deviceId);
        return h('div', { className: cn('kvmflow-root', compact ? 'compact' : '') },
          h('style', null, CSS),
          h('div', { className: 'kvmflow-head' },
            h('div', { className: 'kvmflow-head-main' },
              h('div', { className: 'kvmflow-title-row' },
                h('h1', { className: 'kvmflow-title' }, 'KVMFlow'),
                state.activeRun === undefined || state.activeRun === null ? null : h(Pill, { tone: statusTone(state.activeRun.status) }, `${state.activeRun.status} · ${state.activeRun.phase}`),
                state.activeRecording === undefined ? null : h(Pill, { tone: 'warn' }, t(`录制中 · ${state.activeRecording.eventCount} 事件`, `Recording · ${state.activeRecording.eventCount} events`)),
              ),
              h('p', { className: 'kvmflow-sub' },
                t('IP-KVM 控制、人工录制、AI 生成 YAML 工作流与逐步验证执行。', 'IP-KVM control, manual recording, AI-generated YAML workflows, and verified playback.'),
              ),
            ),
            h('div', { className: 'kvmflow-head-right' },
              h('span', {
                className: 'kvmflow-pill kvmflow-pill-device',
                title: selectedDevice === undefined ? t('未选择设备', 'No device') : selectedDevice.name,
              },
                h('span', { className: cn('kvmflow-dot', selectedDevice === undefined ? '' : 'on') }),
                h('span', { className: 'kvmflow-pill-text' }, selectedDevice === undefined ? t('未选择设备', 'No device') : selectedDevice.name),
              ),
              h('select', {
                className: 'kvmflow-select kvmflow-device-select',
                value: deviceId,
                onChange: (event: any) => setDeviceId(event.target.value),
                'aria-label': t('选择设备', 'Select device'),
                title: selectedDevice === undefined ? '' : `${selectedDevice.name} — ${selectedDevice.baseUrl}`,
              },
                h('option', { value: '' }, t('选择 KVM 设备…', 'Select a KVM device…')),
                (state.devices ?? []).map((device: any) => h('option', { key: device.id, value: device.id }, `${device.name} — ${device.baseUrl}`)),
              ),
              h(Btn, { onClick: () => { void refresh(); }, disabled: busy !== '' }, t('刷新', 'Refresh')),
              busy === '' ? null : h('span', { className: 'kvmflow-busy', role: 'status' }, h('span', { className: 'kvmflow-spinner' }), busy),
            ),
          ),
          h(Notice, {
            message: notice?.message,
            tone: notice?.tone,
            action: notice?.action,
            dismissLabel: t('关闭提示', 'Dismiss notice'),
            onClose: () => setNotice(undefined),
          }),
          promptFallback === '' ? null : h('div', { className: 'kvmflow-card', style: { marginBottom: '10px' } },
            h('div', { className: 'kvmflow-card-title' },
              h('span', null, t('复制这段提示词给 AI', 'Copy this prompt to the agent')),
              h(Btn, { small: true, onClick: () => setPromptFallback('') }, t('收起', 'Hide')),
            ),
            h('textarea', { className: 'kvmflow-textarea compact', readOnly: true, value: promptFallback, onFocus: (event: any) => event.target.select() }),
          ),
          h('div', {
            className: 'kvmflow-tabs',
            role: 'tablist',
            'aria-label': 'KVMFlow',
            onKeyDown: (event: any) => {
              const ids = tabs.map(entry => entry.id);
              const index = ids.indexOf(tab);
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                setTab(ids[(index + 1) % ids.length]);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                setTab(ids[(index - 1 + ids.length) % ids.length]);
              } else if (event.key === 'Home') {
                event.preventDefault();
                setTab(ids[0]);
              } else if (event.key === 'End') {
                event.preventDefault();
                setTab(ids[ids.length - 1]);
              }
            },
          },
            tabs.map(entry => h('button', {
              key: entry.id,
              type: 'button',
              role: 'tab',
              id: `kvmflow-tab-${entry.id}`,
              tabIndex: tab === entry.id ? 0 : -1,
              'aria-selected': tab === entry.id,
              'aria-controls': 'kvmflow-tabpanel',
              className: cn('kvmflow-tab', tab === entry.id ? 'active' : ''),
              onClick: () => setTab(entry.id),
            }, t(entry.zh, entry.en))),
          ),
          h('div', { role: 'tabpanel', id: 'kvmflow-tabpanel', 'aria-labelledby': `kvmflow-tab-${tab}` },
            tab === 'live' ? h(LiveTab, shared) : null,
            tab === 'devices' ? h(DevicesTab, shared) : null,
            tab === 'recorder' ? h(RecorderTab, shared) : null,
            tab === 'workflows' ? h(WorkflowsTab, shared) : null,
            tab === 'runs' ? h(RunsTab, shared) : null,
          ),
        );
      }

      function DevicesTab(shared: any): any {
        const { state, deviceId, setDeviceId, runRpc, refresh, busy, t } = shared;
        const selected = (state.devices ?? []).find((device: any) => device.id === deviceId);
        const [editingId, setEditingId] = useState('');
        const EMPTY_FORM = {
          name: '', baseUrl: '', token: '', notes: '',
          webUsername: '', webPassword: '',
        };
        const [form, setForm] = useState(EMPTY_FORM);
        useEffect(() => {
          if (selected === undefined) return;
          if (editingId !== selected.id) {
            setEditingId(selected.id);
            setForm({
              name: selected.name ?? '',
              baseUrl: selected.baseUrl ?? '',
              token: '',
              notes: selected.notes ?? '',
              webUsername: selected.username ?? '',
              webPassword: '',
            });
          }
        }, [selected?.id]);
        const reset = (): void => {
          setEditingId('');
          setForm(EMPTY_FORM);
        };
        const save = async (): Promise<void> => {
          if (editingId === '') {
            const value = await runRpc(t('添加设备', 'Add device'), 'device.add', {
              name: form.name,
              baseUrl: form.baseUrl,
              token: form.token,
              notes: form.notes,
              username: form.webUsername,
              ...(form.webPassword === '' ? {} : { password: form.webPassword }),
            });
            if (value !== undefined) {
              shared.notify(t('设备已添加', 'Device added'), 'ok');
              if (value.device?.id !== undefined) setDeviceId(value.device.id);
              reset();
              await refresh();
            }
          } else {
            // The frame mapping is detected from arriving frames, never typed:
            // saving the form must not overwrite a measurement.
            const patch: any = {
              id: editingId,
              name: form.name,
              baseUrl: form.baseUrl,
              notes: form.notes,
              username: form.webUsername,
            };
            if (typeof form.token === 'string' && form.token.trim() !== '') patch.token = form.token.trim();
            // An empty password field keeps the stored one, mirroring the token.
            if (typeof form.webPassword === 'string' && form.webPassword !== '') patch.password = form.webPassword;
            const value = await runRpc(t('保存设备', 'Save device'), 'device.update', patch);
            if (value !== undefined) {
              shared.notify(t('设备已保存', 'Device saved'), 'ok');
              setForm(current => ({ ...current, token: '' }));
              await refresh();
            }
          }
        };
        const remove = async (id: string): Promise<void> => {
          const value = await runRpc(t('删除设备', 'Remove device'), 'device.remove', { id });
          if (value !== undefined) {
            shared.notify(t('设备已删除', 'Device removed'), 'ok');
            if (deviceId === id) setDeviceId('');
            reset();
            await refresh();
          }
        };
        return h('div', { className: 'kvmflow-grid two' },
          h('div', null,
            h(Card, { title: t('KVM 设备', 'KVM devices'), subtitle: `${state.devices?.length ?? 0}` },
              (state.devices ?? []).length === 0
                ? h(Empty, null, t('还没有设备。请添加 Radxa Linkr 的地址和访问令牌（在窄屏或右侧栏中表单位于下方）。', 'No devices yet. Add a Radxa Linkr origin and access token in the add form.'))
                : h('div', { className: 'kvmflow-col' }, (state.devices ?? []).map((device: any) => h('div', {
                  key: device.id,
                  className: cn('kvmflow-device', device.id === deviceId ? 'selected' : ''),
                },
                  h('div', null,
                    h('div', { className: 'kvmflow-device-name' }, device.name),
                    h('div', { className: 'kvmflow-muted kvmflow-mono' }, device.baseUrl),
                    h('div', { className: 'kvmflow-hint' }, [
                      device.driver,
                      device.hasToken ? t('令牌已保存', 'token saved') : t('缺少令牌', 'token missing'),
                      device.hasWebCredentials ? t('视频账号已配置', 'video account set') : t('无视频账号', 'no video account'),
                      device.id === state.defaultDeviceId ? t('默认设备', 'default') : '',
                    ].filter(Boolean).join(' · ')),
                    device.notes ? h('div', { className: 'kvmflow-hint' }, device.notes) : null,
                    device.viewMapping === undefined ? null : h('div', { className: 'kvmflow-hint' }, t(
                      `画面映射：左 ${Math.round(device.viewMapping.left * 100)}% 上 ${Math.round(device.viewMapping.top * 100)}% 右 ${Math.round(device.viewMapping.right * 100)}% 下 ${Math.round(device.viewMapping.bottom * 100)}%`,
                      `view mapping: left ${Math.round(device.viewMapping.left * 100)}% top ${Math.round(device.viewMapping.top * 100)}% right ${Math.round(device.viewMapping.right * 100)}% bottom ${Math.round(device.viewMapping.bottom * 100)}%`,
                    )),
                  ),
                  h('div', { className: 'kvmflow-actions' },
                    h(Btn, { onClick: () => { setDeviceId(device.id); }, disabled: device.id === deviceId }, t('使用', 'Use')),
                    h(Btn, { onClick: () => { setEditingId(device.id); setForm({ name: device.name, baseUrl: device.baseUrl, token: '', notes: device.notes ?? '', webUsername: device.username ?? '', webPassword: '' }); } }, t('编辑', 'Edit')),
                    h(Btn, { onClick: () => { void shared.probe(device.id); }, disabled: busy !== '' }, t('测试', 'Test')),
                    h(ConfirmButton, {
                      kind: 'danger',
                      disabled: busy !== '',
                      confirmLabel: t('删除设备及其令牌？', 'Delete device and its token?'),
                      confirmAction: t('删除', 'Delete'),
                      cancelLabel: t('取消', 'Cancel'),
                      onConfirm: () => { void remove(device.id); },
                    }, t('删除', 'Remove')),
                  ),
                ))),
            ),
          ),
          h(Card, { title: editingId === '' ? t('添加设备', 'Add device') : t('编辑设备', 'Edit device') },
            h('div', { className: 'kvmflow-form-grid' },
              h(Field, { label: t('名称', 'Name'), className: 'wide' },
                h('input', { className: 'kvmflow-input', value: form.name, placeholder: 'Lab Linkr', onChange: (event: any) => setForm({ ...form, name: event.target.value }) }),
              ),
              h(Field, { label: t('地址', 'Origin'), className: 'wide' },
                h('input', { className: 'kvmflow-input', value: form.baseUrl, placeholder: 'http://192.168.1.100', onChange: (event: any) => setForm({ ...form, baseUrl: event.target.value }) }),
              ),
              h(Field, { label: t('访问令牌', 'Access token'), className: 'wide', hint: editingId === '' ? t('在 Linkr Web 控制台的“系统设置 → 访问令牌”中生成后粘贴到这里；保存为 devices.json（权限 0600）。', 'Generate one in the Linkr web console under System settings → Access tokens, then paste it here. Stored in devices.json with mode 0600.') : t('留空表示保留现有令牌。', 'Leave blank to keep the current token.') },
                h('input', { className: 'kvmflow-input', type: 'password', value: form.token, placeholder: editingId === '' ? 'radxa_linkr_…' : '••••••••', onChange: (event: any) => setForm({ ...form, token: event.target.value }) }),
              ),
              h(Field, { label: t('备注', 'Notes'), className: 'wide' },
                h('input', { className: 'kvmflow-input', value: form.notes, onChange: (event: any) => setForm({ ...form, notes: event.target.value }) }),
              ),
              h(Field, { label: t('Web 用户名（实时视频用）', 'Web username (for live video)'), className: 'wide', hint: t('只有实时视频需要 Web 账号；截图与键鼠用访问令牌即可。', 'Only live video needs the web account; snapshots and HID use the access token.') },
                h('input', { className: 'kvmflow-input', value: form.webUsername, autoComplete: 'off', onChange: (event: any) => setForm({ ...form, webUsername: event.target.value }) }),
              ),
              h(Field, { label: t('Web 密码', 'Web password'), className: 'wide', hint: editingId === '' ? t('与 Web 控制台登录密码相同，保存为 devices.json（0600）。', 'Same as the web console password; stored in devices.json (0600).') : t('留空表示保留现有密码。', 'Leave blank to keep the stored password.') },
                h('input', { className: 'kvmflow-input', type: 'password', value: form.webPassword, autoComplete: 'new-password', placeholder: editingId === '' ? '' : (selected?.hasWebCredentials ? '••••••••' : t('未设置', 'not set')), onChange: (event: any) => setForm({ ...form, webPassword: event.target.value }) }),
              ),
            ),
            h('div', { className: 'kvmflow-split' }),
            h('div', { className: 'kvmflow-form-actions' },
              h(Btn, { kind: 'primary', onClick: () => { void save(); }, disabled: busy !== '' || form.baseUrl.trim() === '' || (editingId === '' && form.token.trim() === '') }, editingId === '' ? t('添加', 'Add') : t('保存', 'Save')),
              editingId === '' ? null : h(Btn, { onClick: reset }, t('取消编辑', 'Cancel edit')),
            ),
            h('p', { className: 'kvmflow-hint', style: { marginTop: '10px' } },
              t('第一阶段使用 Radxa Linkr 公开 HTTP API：GET /api/public/snapshot 与 POST /api/public/control。', 'Stage one uses the Radxa Linkr public HTTP API: GET /api/public/snapshot and POST /api/public/control.'),
            ),
          ),
        );
      }

      function LiveTab(shared: any): any {
        const { state, deviceId, runRpc, rpc, log, logs, t, refresh } = shared;
        const device = (state.devices ?? []).find((entry: any) => entry.id === deviceId);
        // Wide mode gives the screen the whole panel instead of one grid column.
        const [wide, setWide] = useState(() => {
          try { return window.localStorage.getItem('kvmflow.wide') === '1'; } catch { return false; }
        });
        const toggleWide = useCallback(() => {
          setWide((current: boolean) => {
            const next = !current;
            try { window.localStorage.setItem('kvmflow.wide', next ? '1' : '0'); } catch { /* ignore */ }
            return next;
          });
        }, []);
        const [frame, setFrame] = useState(undefined);
        const [frameError, setFrameError] = useState('');
        const [live, setLive] = useState(true);
        const [pressed, setPressed] = useState({});
        const [text, setText] = useState('');
        // The target's screen inside the frame, when the frame is letterboxed.
        const [mapping, setMapping] = useState(device?.viewMapping);
        const [pointer, setPointer] = useState(undefined);
        // Real-time preview is WebRTC (needs the device's web account); JPEG
        // polling stays available and is the fallback when the peer fails.
        const [previewMode, setPreviewMode] = useState(() => {
          const stored = (() => {
            try { return window.localStorage.getItem('kvmflow.preview'); } catch { return null; }
          })();
          if (stored === 'video' || stored === 'snapshot') return stored;
          return device?.preview === 'snapshot' ? 'snapshot' : 'video';
        });
        const [videoStream, setVideoStream] = useState(undefined);
        const [videoError, setVideoError] = useState('');
        const [videoSize, setVideoSize] = useState(undefined);
        const [videoRetry, setVideoRetry] = useState(0);
        const videoRef = useRef(null);
        const detected = useRef({ size: '', persisted: JSON.stringify(device?.viewMapping ?? null) });

        useEffect(() => {
          setMapping(device?.viewMapping);
          detected.current = { size: '', persisted: JSON.stringify(device?.viewMapping ?? null) };
        }, [device?.id, JSON.stringify(device?.viewMapping ?? null)]);
        const applyDetected = useCallback(async (image: any) => {
          const size = `${image.naturalWidth}x${image.naturalHeight}`;
          if (detected.current.size === size) return;
          detected.current.size = size;
          const next = detectContentMapping(image);
          const serialized = JSON.stringify(next ?? null);
          setMapping(next);
          if (serialized === detected.current.persisted) return;
          detected.current.persisted = serialized;
          try {
            await rpc('device.update', { id: deviceId, viewMapping: next ?? null });
            log('info', next === undefined
              ? 'Frame covers the whole target screen; click mapping is 1:1.'
              : `Detected a letterboxed target area (${(next.right - next.left).toFixed(3)}×${(next.bottom - next.top).toFixed(3)} of the frame); mapping clicks to it.`);
          } catch (error: any) {
            shared.notify(error.message ?? String(error), 'err');
          }
        }, [deviceId, rpc, log, shared]);
        const screenRef = useRef(null);
        const captureInFlight = useRef(false);
        // The right Sidebar hides docked bodies by moving them off-frame rather
        // than unmounting, so capture also requires the screen to be on screen.
        const onScreen = useRef(true);
        const [onScreenState, setOnScreenState] = useState(true);
        // Linkr's public API allows 5 requests/second, shared by snapshots and
        // every HID event, so a faster preview costs input headroom. A 429 backs
        // off exponentially instead of hammering the limiter.
        const [frameIntervalMs, setFrameIntervalMs] = useState(() => {
          try {
            const stored = Number(window.localStorage.getItem('kvmflow.frameIntervalMs'));
            return Number.isFinite(stored) && stored >= 400 ? stored : 1100;
          } catch {
            return 1100;
          }
        });
        const rateStrikes = useRef(0);
        const rateBackoffUntil = useRef(0);
        const capture = useCallback(async () => {
          if (deviceId === '' || captureInFlight.current || !onScreen.current) return;
          if (Date.now() < rateBackoffUntil.current) return;
          captureInFlight.current = true;
          try {
            const value = await rpc('screen.snapshot', { deviceId });
            setFrame(value);
            setFrameError('');
            rateStrikes.current = 0;
          } catch (error: any) {
            setFrameError(error.message ?? String(error));
            if (typeof error?.code === 'string' && error.code.includes('RATE_LIMITED')) {
              rateStrikes.current = Math.min(3, rateStrikes.current + 1);
              rateBackoffUntil.current = Date.now() + 1000 * 2 ** rateStrikes.current;
            }
          } finally {
            captureInFlight.current = false;
          }
        }, [deviceId, rpc]);
        const chooseFrameInterval = useCallback((ms: number) => {
          setFrameIntervalMs(ms);
          rateStrikes.current = 0;
          rateBackoffUntil.current = 0;
          try { window.localStorage.setItem('kvmflow.frameIntervalMs', String(ms)); } catch { /* ignore */ }
        }, []);
        useEffect(() => {
          setFrame(undefined);
          setFrameError('');
          setVideoStream(undefined);
          setVideoError('');
          setVideoSize(undefined);
        }, [deviceId]);
        useEffect(() => {
          const element = screenRef.current;
          if (element === null || element === undefined || typeof IntersectionObserver === 'undefined') return undefined;
          const observer = new IntersectionObserver(entries => {
            for (const current of entries) {
              onScreen.current = current.isIntersecting;
              setOnScreenState(current.isIntersecting);
            }
          });
          observer.observe(element);
          return () => observer.disconnect();
        }, [deviceId]);
        useEffect(() => {
          const element = screenRef.current;
          if (element === null || element === undefined) return undefined;
          const listener = (event: any): void => wheelHandler.current(event);
          element.addEventListener('wheel', listener, { passive: false });
          // A press released outside the screen never reaches the element, so the
          // target would keep the button down. Window-level pointerup covers it,
          // and pointerleave covers dragging off the edge.
          const onPointerUp = (event: any): void => {
            if (heldButton.current === 0) return;
            if (typeof element.contains === 'function' && event.target !== null && element.contains(event.target)) return;
            releaseHeldRef.current();
          };
          const onPointerLeave = (): void => { releaseHeldRef.current(); };
          window.addEventListener('pointerup', onPointerUp, true);
          element.addEventListener('pointerleave', onPointerLeave);
          return () => {
            element.removeEventListener('wheel', listener);
            window.removeEventListener('pointerup', onPointerUp, true);
            element.removeEventListener('pointerleave', onPointerLeave);
          };
        }, [deviceId]);
        const videoLive = previewMode === 'video' && videoStream !== undefined;
        const rpcRef = useRef(rpc);
        rpcRef.current = rpc;
        const translateRef = useRef(t);
        translateRef.current = t;
        useEffect(() => {
          const element = videoRef.current;
          if (element === null || element === undefined) return;
          if (element.srcObject !== videoStream) element.srcObject = videoStream ?? null;
        }, [videoStream, videoLive]);
        // Real-time video replaces the polling loop entirely: it costs no
        // snapshot quota and leaves the device's 5 req/s for actual input.
        useEffect(() => {
          if (deviceId === '' || !live || videoLive) return undefined;
          void capture();
          const timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            void capture();
          }, frameIntervalMs);
          return () => clearInterval(timer);
        }, [deviceId, live, capture, frameIntervalMs, videoLive]);
        useEffect(() => {
          if (deviceId === '' || !live || previewMode !== 'video' || !onScreenState) return undefined;
          if (typeof RTCPeerConnection === 'undefined') {
            setVideoError(translateRef.current('当前浏览器不支持 WebRTC。', 'This browser has no WebRTC support.'));
            return undefined;
          }
          let cancelled = false;
          let pc;
          setVideoError('');
          void (async () => {
            try {
              pc = new RTCPeerConnection({ iceServers: [] });
              pc.addTransceiver('video', { direction: 'recvonly' });
              pc.ontrack = (event: any) => {
                if (cancelled) return;
                const stream = event.streams !== undefined && event.streams.length > 0
                  ? event.streams[0]
                  : new MediaStream([event.track]);
                setVideoStream(stream);
                setVideoError('');
              };
              pc.onconnectionstatechange = () => {
                if (cancelled || pc === undefined) return;
                const state = pc.connectionState;
                if (state === 'failed' || state === 'closed') {
                  setVideoError(translateRef.current('视频连接已断开。', 'The video connection dropped.'));
                }
              };
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              await waitForIce(pc);
              const local = pc.localDescription ?? offer;
              const value = await rpcRef.current('rtc.offer', { deviceId, offer: local.sdp });
              if (cancelled) return;
              await pc.setRemoteDescription({ type: 'answer', sdp: value.answer });
            } catch (error: any) {
              if (cancelled) return;
              const message = error?.message ?? String(error);
              setVideoError(message);
              // Keep the selected mode and the snapshot fallback together: the
              // picture stays live, and the user decides whether to retry.
              log('warn', `WebRTC negotiation failed: ${message}`);
              try { if (pc !== undefined) pc.close(); } catch { /* ignore */ }
            }
          })();
          return () => {
            cancelled = true;
            setVideoStream(undefined);
            try { if (pc !== undefined) pc.close(); } catch { /* ignore */ }
          };
        }, [deviceId, live, previewMode, videoRetry, onScreenState]);
        const send = useCallback(async (events: any[], label: string, quiet = false) => {
          if (deviceId === '') {
            shared.notify(t('请先选择设备。', 'Select a device first.'), 'warn');
            return;
          }
          try {
            await rpc('screen.control', { deviceId, events });
            // Input outranks the preview: give a fresh HID batch a clear window
            // in the device's shared budget instead of competing with polling.
            rateBackoffUntil.current = Math.max(rateBackoffUntil.current, Date.now() + 300);
            if (!quiet) log('info', label);
          } catch (error: any) {
            shared.notify(error.message ?? String(error), 'err');
          }
        }, [deviceId, rpc, log, shared, t]);
        // Measure the rendered image, never the padded/bordered wrapper, and then
        // convert the image point into the target's absolute HID space.
        const point = (event: any, useMapping = true): { x: number; y: number; frameX: number; frameY: number } => {
          const stage = event.currentTarget as any;
          const image = stage !== null && typeof stage.querySelector === 'function' ? stage.querySelector('img, video') : null;
          const rect = (image ?? stage).getBoundingClientRect();
          const frameX = clamp01((event.clientX - rect.left) / Math.max(1, rect.width));
          const frameY = clamp01((event.clientY - rect.top) / Math.max(1, rect.height));
          const target = frameToTargetPoint(useMapping ? mapping : undefined, frameX, frameY);
          return { x: target.x, y: target.y, frameX, frameY };
        };
        // A button pressed in the screen and released outside it would otherwise
        // stay pressed on the target, which looks like a stuck drag.
        const heldButton = useRef(0);
        const lastPoint = useRef({ x: 0.5, y: 0.5 });
        const dragAt = useRef(0);
        // Native listeners outlive one render, so they reach the current closure
        // through this ref instead of capturing a stale one.
        const releaseHeldRef = useRef((): void => {});
        const releaseHeld = (): void => {
          if (heldButton.current === 0) return;
          const button = heldButton.current;
          heldButton.current = 0;
          const { x, y } = lastPoint.current;
          void send([['mouse_abs', 0, x, y, 0, 0]], `release ${button} on leave`);
        };
        releaseHeldRef.current = releaseHeld;
        const mouseDown = (event: any): void => {
          event.preventDefault();
          screenRef.current?.focus();
          const { x, y } = point(event);
          const button = event.button === 2 ? 2 : event.button === 1 ? 4 : 1;
          heldButton.current = button;
          lastPoint.current = { x, y };
          // Let the first move through immediately so a drag starts crisply;
          // later moves then coalesce to the device's request budget.
          dragAt.current = Date.now() - 200;
          setPointer({ x, y });
          void send([['mouse_abs', 0, x, y, 0, 0], ['mouse_abs', button, x, y, 0, 0]], `mouse down ${button} @ ${x.toFixed(3)},${y.toFixed(3)}`);
        };
        const mouseUp = (event: any): void => {
          event.preventDefault();
          const { x, y } = point(event);
          heldButton.current = 0;
          lastPoint.current = { x, y };
          setPointer({ x, y });
          void send([['mouse_abs', 0, x, y, 0, 0]], `mouse up @ ${x.toFixed(3)},${y.toFixed(3)}`);
        };
        // Linkr wheel steps are -20..20, where one detent is one step. Browsers
        // report pixels (100 per detent), lines, or pages, and a precision
        // trackpad reports fractions, so deltas accumulate until they reach a
        // whole step instead of being rounded away.
        const wheelAccum = useRef({ x: 0, y: 0 });
        const wheelDelta = (event: any): { steps: number; stepsX: number } => {
          // A browser reports positive deltaY when the user scrolls down, and
          // Linkr's positive wheelY also scrolls the target down, so the sign
          // carries through unchanged. (Verified on hardware: wheelY +3 advanced
          // an alphabetical list forward.)
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
          wheelAccum.current.y = clampStep(wheelAccum.current.y + (event.deltaY * unit) / 100);
          wheelAccum.current.x = clampStep(wheelAccum.current.x + (event.deltaX * unit) / 100);
          const steps = Math.trunc(wheelAccum.current.y);
          const stepsX = Math.trunc(wheelAccum.current.x);
          wheelAccum.current.y -= steps;
          wheelAccum.current.x -= stepsX;
          return { steps, stepsX };
        };
        const clampStep = (value: number): number => (Number.isFinite(value) ? Math.max(-20, Math.min(20, value)) : 0);
        // React installs `wheel` passively at its root, so preventDefault() in a
        // synthetic handler is ignored and the page scrolls. Attach the wheel
        // listener directly with passive:false; the ref keeps the closure fresh
        // without re-registering on every frame.
        const wheelHandler = useRef((event: any): void => {});
        const wheel = (event: any): void => {
          // The page must not scroll while the pointer is over the target; the
          // gesture belongs to the remote machine.
          event.preventDefault();
          event.stopPropagation();
          if (deviceId === '' || frame === undefined) return;
          const { x, y } = point(event);
          setPointer({ x, y });
          const { steps, stepsX } = wheelDelta(event);
          if (steps === 0 && stepsX === 0) return;
          void send([['mouse_abs', 0, x, y, steps, stepsX]], `wheel ${steps}${stepsX === 0 ? '' : `,${stepsX}`}`);
        };
        wheelHandler.current = wheel;
        const keyDown = (event: any): void => {
          // Tab must move focus back out of the capture surface; forwarding it
          // would trap keyboard users inside the screen.
          if (event.key === 'Tab') return;
          if (event.repeat) { event.preventDefault(); return; }
          event.preventDefault();
          event.stopPropagation();
          setPressed(current => ({ ...current, [event.code]: true }));
          void send([['keyboard', event.code, true]], `key down ${event.code}`);
        };
        const keyUp = (event: any): void => {
          if (event.key === 'Tab') return;
          event.preventDefault();
          event.stopPropagation();
          setPressed(current => {
            const next = { ...current };
            delete next[event.code];
            return next;
          });
          void send([['keyboard', event.code, false]], `key up ${event.code}`);
        };
        const shortcut = (keys: string[]): void => {
          const events: any[] = keys.map(key => ['keyboard', key, true]);
          events.push(['delay', 80]);
          for (const key of [...keys].reverse()) events.push(['keyboard', key, false]);
          void send(events, `shortcut ${keys.join('+')}`);
        };
        const typeText = (): void => {
          if (text === '') return;
          const events: any[] = [];
          for (let index = 0; index < text.length; index += 120) events.push(['text', text.slice(index, index + 120)]);
          void send(events, `text ${Math.min(text.length, 60)}${text.length > 60 ? '…' : ''}`);
          setText('');
        };
        const recording = state.activeRecording;
        const draft = shared.recordDraft;
        const setDraft = shared.setRecordDraft;
        const stepName = draft.stepName;
        const stepDesc = draft.stepDesc;
        const recordName = draft.name;
        const setStepName = (value: string) => setDraft({ ...draft, stepName: value });
        const setStepDesc = (value: string) => setDraft({ ...draft, stepDesc: value });
        const setRecordName = (value: string) => setDraft({ ...draft, name: value });
        return h('div', { className: cn('kvmflow-grid', wide ? 'wide' : 'two') },
          h('div', null,
            h(Card, {
              title: t('实时画面', 'Live screen'),
              subtitle: device?.name ?? t('未选择设备', 'No device'),
              // Viewer controls stay on the title line, right-aligned.
              actions: [
                  h(Btn, { onClick: () => { void capture(); }, disabled: deviceId === '' }, t('截图', 'Snapshot')),
                  h('select', {
                    className: 'kvmflow-select kvmflow-inline-select',
                    value: previewMode,
                    'aria-label': t('预览方式', 'Preview mode'),
                    title: t('实时视频需要设备 Web 账号；截图模式按下拉右侧的帧率轮询', 'Real-time video needs the device web account; snapshot mode polls at the rate set next to it'),
                    onChange: (event: any) => {
                      const next = event.target.value;
                      setPreviewMode(next);
                      try { window.localStorage.setItem('kvmflow.preview', next); } catch { /* ignore */ }
                      if (deviceId !== '') void rpc('device.update', { id: deviceId, preview: next }).catch(() => {});
                    },
                  },
                    h('option', { value: 'video' }, t('实时视频', 'Live video')),
                    h('option', { value: 'snapshot' }, t('截图轮询', 'Snapshot polling')),
                  ),
                  previewMode === 'video' ? null : h('select', {
                    className: 'kvmflow-select kvmflow-inline-select',
                    value: String(frameIntervalMs),
                    'aria-label': t('预览刷新频率', 'Preview refresh rate'),
                    title: t('设备公开 API 限 5 次/秒，且与键鼠事件共用；调高预览会挤占操作余量', 'The public API allows 5 requests/second shared with HID input, so a faster preview leaves less room for input'),
                    onChange: (event: any) => chooseFrameInterval(Number(event.target.value)),
                  },
                    h('option', { value: '2000' }, t('0.5 帧/秒', '0.5 fps')),
                    h('option', { value: '1100' }, t('1 帧/秒', '1 fps')),
                    h('option', { value: '700' }, t('1.5 帧/秒', '1.5 fps')),
                    h('option', { value: '500' }, t('2 帧/秒', '2 fps')),
                  ),
                  h(Btn, { onClick: () => setLive(value => !value) }, live ? t('暂停', 'Pause') : t('继续', 'Resume')),
                  h(Btn, { onClick: () => { void shared.probe(deviceId); } }, t('测试', 'Test')),
                  h('button', {
                    type: 'button',
                    className: 'kvmflow-icon-btn',
                    'aria-pressed': wide,
                    'aria-label': wide ? t('切换为标准布局', 'Switch to the standard layout') : t('切换为宽屏布局', 'Switch to the wide layout'),
                    title: wide
                      ? t('切换为标准布局（右侧显示录制与设备信息）', 'Switch to the standard layout with recording and device panes')
                      : t('切换为宽屏：画面占满面板宽度，其余卡片移到下方', 'Switch to wide: the screen takes the whole panel width and the other cards move below'),
                    onClick: toggleWide,
                  }, wide ? h(IconCollapse) : h(IconExpand)),
              ],
            },
              deviceId === '' ? h(Empty, null, t('先在“设备”页添加并选择一个 KVM。', 'Add and select a KVM on the Devices tab first.')) : null,
              deviceId === '' ? null : h('div', {
                ref: screenRef,
                className: 'kvmflow-screen-wrap',
                tabIndex: 0,
                role: 'application',
                'aria-label': t('KVM 画面，点击可发送鼠标，聚焦后可用键盘', 'KVM screen; click for mouse and focus for keyboard'),
                onMouseMove: (event: any) => {
                  const { x, y } = point(event);
                  lastPoint.current = { x, y };
                  setPointer(current => {
                    if (current !== undefined && Math.round(current.x * 1000) === Math.round(x * 1000) && Math.round(current.y * 1000) === Math.round(y * 1000)) return current;
                    return { x, y };
                  });
                  // A drag has to reach the target while the button is held. The
                  // device answers 5 requests/second, so moves coalesce and the
                  // newest position wins instead of queueing every sample.
                  if (heldButton.current !== 0) {
                    const now = Date.now();
                    if (now - dragAt.current >= 200) {
                      dragAt.current = now;
                      void send([['mouse_abs', heldButton.current, x, y, 0, 0]], 'drag', true);
                    }
                  }
                },
                onMouseLeave: () => {
                  setPointer(undefined);
                  releaseHeld();
                },
                onMouseDown: mouseDown,
                onMouseUp: mouseUp,
                onContextMenu: (event: any) => event.preventDefault(),
                onKeyDown: keyDown,
                onKeyUp: keyUp,
                onBlur: () => {
                  const codes = Object.keys(pressed);
                  setPressed({});
                  if (codes.length > 0) {
                    void send(codes.map(code => ['keyboard', code, false]), `release ${codes.join(',')}`);
                  }
                },
              },
                videoLive
                  ? h('div', { className: 'kvmflow-screen-stage' },
                    h('video', {
                      ref: videoRef,
                      className: 'kvmflow-screen',
                      autoPlay: true,
                      muted: true,
                      playsInline: true,
                      onLoadedMetadata: (event: any) => {
                        const element = event.currentTarget;
                        setVideoSize({ width: element.videoWidth, height: element.videoHeight });
                        void applyDetected(element);
                      },
                    }),
                    isFullFrameMapping(mapping) ? null : h('div', {
                      className: 'kvmflow-screen-target',
                      'aria-hidden': true,
                      style: {
                        left: `${mapping.left * 100}%`,
                        top: `${mapping.top * 100}%`,
                        width: `${(mapping.right - mapping.left) * 100}%`,
                        height: `${(mapping.bottom - mapping.top) * 100}%`,
                      },
                    }),
                  )
                  : frame === undefined
                  ? h('div', { className: 'kvmflow-screen-empty' }, frameError === '' ? (live ? t('正在获取画面…', 'Capturing…') : t('画面已暂停', 'Screen paused')) : t('无画面信号', 'No video signal'))
                  : h('div', { className: 'kvmflow-screen-stage' },
                    h('img', {
                      className: 'kvmflow-screen',
                      src: `data:${frame.mediaType};base64,${frame.data}`,
                      alt: 'KVM screen',
                      draggable: false,
                      onLoad: (event: any) => { void applyDetected(event.currentTarget); },
                    }),
                    isFullFrameMapping(mapping) ? null : h('div', {
                      className: 'kvmflow-screen-target',
                      'aria-hidden': true,
                      style: {
                        left: `${mapping.left * 100}%`,
                        top: `${mapping.top * 100}%`,
                        width: `${(mapping.right - mapping.left) * 100}%`,
                        height: `${(mapping.bottom - mapping.top) * 100}%`,
                      },
                    }),
                  ),
              ),
              deviceId === '' ? null : h('div', { className: 'kvmflow-screen-status' },
                h('span', { className: cn('kvmflow-dot', videoLive || frameError === '' ? 'on' : 'err') }),
                h('span', null, videoLive
                  ? `${videoSize === undefined ? '—' : `${videoSize.width}×${videoSize.height}`} · WebRTC`
                  : (frameError === '' ? (frame === undefined ? '—' : `${frame.width}×${frame.height} · ${(frame.bytes / 1024).toFixed(0)} KB`) : t('无信号', 'No signal'))),
                isFullFrameMapping(mapping) ? null : (() => {
                  const sourceWidth = videoLive ? (videoSize?.width ?? 0) : (frame?.width ?? 0);
                  const sourceHeight = videoLive ? (videoSize?.height ?? 0) : (frame?.height ?? 0);
                  const targetWidth = Math.round((mapping.right - mapping.left) * sourceWidth);
                  const targetHeight = Math.round((mapping.bottom - mapping.top) * sourceHeight);
                  return h('span', null, t(`目标区 ${targetWidth}×${targetHeight}`, `target ${targetWidth}×${targetHeight}`));
                })(),
                pointer === undefined ? null : h('span', { className: 'kvmflow-screen-readout' }, `${pointer.x.toFixed(3)}, ${pointer.y.toFixed(3)}`),
                h('span', null, live ? t('实时', 'LIVE') : t('已暂停', 'PAUSED')),
              ),
              deviceId === '' ? null : h('div', { className: 'kvmflow-actions', style: { marginTop: '10px' } },
                h(Btn, { onClick: () => shortcut(['ControlLeft', 'AltLeft', 'Delete']) }, 'Ctrl+Alt+Del'),
                h(Btn, { onClick: () => shortcut(['Escape']) }, 'Esc'),
                h(Btn, { onClick: () => shortcut(['Enter']) }, 'Enter'),
                h(Btn, { onClick: () => shortcut(['F2']) }, 'F2'),
                h(Btn, { onClick: () => shortcut(['F12']) }, 'F12'),
                h(Btn, { onClick: () => shortcut(['MetaLeft']) }, 'Win'),
              ),
              frameError === '' ? null : h('div', { className: 'kvmflow-notice err', style: { marginTop: '10px', marginBottom: 0 } }, frameError),
              videoError === '' || videoLive ? null : h('div', { className: 'kvmflow-notice', style: { marginTop: '10px', marginBottom: 0 } },
                h('span', null, t(`实时视频不可用：${videoError}`, `Live video unavailable: ${videoError}`)),
                h('span', { className: 'kvmflow-actions' },
                  h(Btn, { onClick: () => { setVideoError(''); setVideoRetry(value => value + 1); }, disabled: deviceId === '' }, t('重试', 'Retry')),
                ),
              ),

              h('div', { className: 'kvmflow-row', style: { marginTop: '8px' } },
                h('input', {
                  className: 'kvmflow-input',
                  style: { flex: '1 1 auto' },
                  value: text,
                  placeholder: t('输入 ASCII 文本（Linkr 文本通道）', 'Type ASCII text (Linkr text channel)'),
                  onChange: (event: any) => setText(event.target.value),
                  onKeyDown: (event: any) => { if (event.key === 'Enter') typeText(); },
                }),
                h(Btn, { onClick: typeText, disabled: text === '' }, t('输入', 'Type')),
              ),
            ),
            h(Card, { title: t('键鼠操作日志', 'Input log') },
              h(CardActions, null,
                h(Btn, { onClick: () => shared.setLogs([]), disabled: logs.length === 0 }, t('清空', 'Clear')),
              ),
              logs.length === 0
                ? h('div', { className: 'kvmflow-hint' }, t('尚无操作。', 'No actions yet.'))
                : h('div', { className: 'kvmflow-log' }, logs.slice(-80).map((entry, index) => h('div', { key: index, className: cn('kvmflow-log-row', entry.kind === 'err' ? 'err' : entry.kind === 'warn' ? 'warn' : '') },
                  h('span', { className: 'kvmflow-log-time' }, formatTime(entry.at)),
                  h('span', null, entry.message),
                ))),
            ),
          ),
          h('div', null,
            h(Card, { title: t('录制', 'Recording') },
              recording === undefined
                ? h('div', { className: 'kvmflow-col' },
                  h(Field, { label: t('录制名称', 'Recording name') },
                    h('input', { className: 'kvmflow-input', value: recordName, placeholder: t('例如：进入 BIOS 开启虚拟化', 'e.g. Enter BIOS and enable virtualization'), onChange: (event: any) => setRecordName(event.target.value) }),
                  ),
                  h(Field, { label: t('录制说明', 'Recording description') },
                    h('textarea', { className: 'kvmflow-input kvmflow-textarea compact', value: draft.description, placeholder: t('这次录制要完成什么？', 'What should this recording accomplish?'), onChange: (event: any) => setDraft({ ...draft, description: event.target.value }) }),
                  ),
                  h(Btn, {
                    kind: 'primary',
                    disabled: deviceId === '',
                    onClick: async () => {
                      const value = await runRpc(t('开始录制', 'Start recording'), 'record.start', {
                        deviceId,
                        name: recordName || t('未命名录制', 'Untitled recording'),
                        description: draft.description,
                      });
                      if (value !== undefined) {
                        shared.notify(t('录制已开始，操作画面会自动记录。', 'Recording started; your input is captured.'), 'ok');
                        setDraft({ ...draft, name: '', description: '' });
                        await refresh();
                      }
                    },
                  }, t('开始录制', 'Start recording')),
                  h('p', { className: 'kvmflow-hint' }, t('录制期间所有键盘、鼠标和文本操作都会写入事件流，并在操作前后保存截图。', 'Every keyboard, mouse, and text action is stored with before/after screenshots.')),
                )
                : h('div', { className: 'kvmflow-col' },
                  h('div', { className: 'kvmflow-kv' },
                    h('dt', null, t('名称', 'Name')), h('dd', null, recording.name),
                    h('dt', null, t('事件', 'Events')), h('dd', null, String(recording.eventCount)),
                    h('dt', null, t('步骤', 'Steps')), h('dd', null, String(recording.stepCount)),
                    h('dt', null, t('开始', 'Started')), h('dd', null, formatDateTime(recording.startedAt)),
                  ),
                  h('div', { className: 'kvmflow-split' }),
                  h(Field, { label: t('步骤名称', 'Step name') },
                    h('input', { className: 'kvmflow-input', value: stepName, placeholder: t('例如：打开 Advanced 菜单', 'e.g. Open the Advanced menu'), onChange: (event: any) => setStepName(event.target.value) }),
                  ),
                  h(Field, { label: t('步骤描述', 'Step description') },
                    h('textarea', { className: 'kvmflow-input kvmflow-textarea compact', value: stepDesc, placeholder: t('这一步完成什么，画面应该出现什么', 'What this step does and what should appear'), onChange: (event: any) => setStepDesc(event.target.value) }),
                  ),
                  h(Btn, {
                    onClick: async () => {
                      const value = await runRpc(t('标记步骤', 'Mark step'), 'record.markStep', { deviceId, name: stepName || t('步骤', 'Step'), description: stepDesc });
                      if (value !== undefined) {
                        setStepName('');
                        setStepDesc('');
                        shared.notify(t('已保存步骤边界。', 'Step boundary saved.'), 'ok');
                        await refresh();
                      }
                    },
                  }, t('标记步骤', 'Mark step')),
                  h(Btn, {
                    kind: 'primary',
                    onClick: async () => {
                      const value = await runRpc(t('停止录制', 'Stop recording'), 'record.stop');
                      if (value !== undefined) {
                        shared.notify(
                          t('录制结束，已保存步骤与截图。', 'Recording stopped; steps and screenshots saved.'),
                          'ok',
                          { label: t('查看录制', 'Review recording'), onClick: () => shared.setTab('recorder') },
                        );
                        await refresh();
                      }
                    },
                  }, t('停止录制', 'Stop recording')),
                ),
            ),
            h(Card, { title: t('设备与数据', 'Device and data') },
              h('dl', { className: 'kvmflow-kv' },
                h('dt', null, t('设备', 'Device')), h('dd', null, device?.name ?? '—'),
                h('dt', null, t('地址', 'Origin')), h('dd', { className: 'kvmflow-mono' }, device?.baseUrl ?? '—'),
                h('dt', null, t('数据目录', 'Data dir')), h('dd', { className: 'kvmflow-mono' }, state.dataDir ?? '—'),
                h('dt', null, t('驱动', 'Driver')), h('dd', null, device?.driver ?? '—'),
              ),
            ),
          ),
        );
      }

      function RecorderTab(shared: any): any {
        const { state, deviceId, runRpc, rpc, refresh, busy, t, notify } = shared;
        const active = state.activeRecording;
        const recordings: any[] = state.recordings ?? [];
        const [selectedId, setSelectedId] = useState('');
        const [detail, setDetail] = useState(undefined);
        const [loading, setLoading] = useState(false);
        const draft = shared.recordDraft;
        const setDraft = shared.setRecordDraft;
        const recordName = draft.name;
        const recordDesc = draft.description;
        const stepName = draft.stepName;
        const stepDesc = draft.stepDesc;
        const setRecordName = (value: string) => setDraft({ ...draft, name: value });
        const setRecordDesc = (value: string) => setDraft({ ...draft, description: value });
        const setStepName = (value: string) => setDraft({ ...draft, stepName: value });
        const setStepDesc = (value: string) => setDraft({ ...draft, stepDesc: value });
        const [editing, setEditing] = useState(undefined);
        useEffect(() => {
          if (active !== undefined) {
            setSelectedId(active.id);
          } else if (selectedId === '' && recordings.length > 0) {
            setSelectedId(recordings[0].id);
          }
        }, [active?.id, recordings.length]);
        const load = useCallback(async (id: string) => {
          if (id === '') { setDetail(undefined); return; }
          setLoading(true);
          try {
            const value = await rpc('record.get', { id });
            setDetail(value.recording);
          } catch (error: any) {
            notify(error.message ?? String(error), 'err');
          } finally {
            setLoading(false);
          }
        }, [rpc, notify]);
        useEffect(() => {
          void load(selectedId);
          if (selectedId === '') return undefined;
          const timer = setInterval(() => {
            if (active !== undefined && active.id === selectedId) void load(selectedId);
          }, 2500);
          return () => clearInterval(timer);
        }, [selectedId, active?.id, load]);
        const start = async (): Promise<void> => {
          const value = await runRpc(t('开始录制', 'Start recording'), 'record.start', { deviceId, name: recordName || t('未命名录制', 'Untitled recording'), description: recordDesc });
          if (value !== undefined) {
            notify(
              t('录制已开始，请在实时画面中操作。', 'Recording started; drive the target from the Live screen.'),
              'ok',
              { label: t('去实时画面', 'Go to Live screen'), onClick: () => shared.setTab('live') },
            );
            setDraft({ ...draft, name: '', description: '' });
            setSelectedId(value.recording.id);
            await refresh();
          }
        };
        const mark = async (): Promise<void> => {
          const value = await runRpc(t('标记步骤', 'Mark step'), 'record.markStep', { deviceId, name: stepName || t('步骤', 'Step'), description: stepDesc });
          if (value !== undefined) {
            setStepName('');
            setStepDesc('');
            await load(selectedId);
            await refresh();
          }
        };
        const stop = async (): Promise<void> => {
          const value = await runRpc(t('停止录制', 'Stop recording'), 'record.stop');
          if (value !== undefined) {
            notify(t('录制已结束。', 'Recording stopped.'), 'ok');
            setSelectedId(value.recording.id);
            await load(value.recording.id);
            await refresh();
          }
        };
        const saveStep = async (): Promise<void> => {
          if (editing === undefined) return;
          const value = await runRpc(t('保存步骤', 'Save step'), 'record.updateStep', {
            recordingId: selectedId,
            stepId: editing.id,
            name: editing.name,
            description: editing.description,
          });
          if (value !== undefined) {
            setEditing(undefined);
            await load(selectedId);
            await refresh();
          }
        };
        const removeRecording = async (): Promise<void> => {
          if (selectedId === '') return;
          const value = await runRpc(t('删除录制', 'Delete recording'), 'record.delete', { id: selectedId });
          if (value !== undefined) {
            notify(t('录制已删除。', 'Recording removed.'), 'ok');
            setSelectedId('');
            setDetail(undefined);
            await refresh();
          }
        };
        const askAi = async (recording: any): Promise<void> => {
          const recordingId = recording.id;
          const prompt = [
            `请使用 KVMFlow 工具把录制 ${recordingId} 转换成一份可执行、可编辑的 YAML 工作流。`,
            '先调用 kvmflow_record_get 查看事件序列、人工步骤边界和截图（必要时读取截图）。',
            '再按用户目标设计步骤：每个步骤写明 name、description、action，尽量补充 precondition（前置画面条件）与 verify（成功验证），并为有风险的动作设置 onFailure: pause。',
            '需要视觉判断的验证请使用 verify.mode: vision 并写出具体 prompt；屏幕必然发生可见变化时可用 change。',
            'action 可以直接引用录制事件的 eventRange: [firstSeq, lastSeq]，或使用 key / shortcut / text / click / delay / sequence。',
            '最后调用 kvmflow_workflow_generate 或 kvmflow_workflow_save 生成/保存 YAML，并告诉我工作流 id。',
            '',
            `录制名称：${recording.name}`,
            recording.description ? `录制说明：${recording.description}` : '',
            '我的目标与注意事项（请让用户补充）：',
          ].filter(Boolean).join('\n');
          await shared.handPrompt(
            prompt,
            t('已在新会话中启动 AI 工作流生成，请补充目标描述。', 'Started a new session for AI workflow generation; add your goal there.'),
            t('无法自动创建会话，提示词已显示在下方，请手动复制。', 'Could not open a session automatically; copy the prompt shown below.'),
          );
        };
        const selected = detail ?? (active !== undefined && active.id === selectedId ? { id: active.id, name: active.name, status: 'recording', events: [], steps: [], createdAt: active.startedAt } : undefined);
        return h('div', { className: 'kvmflow-grid two' },
          h('div', null,
            h(Card, {
              title: t('录制器', 'Recorder'),
              subtitle: active === undefined ? t('未在录制', 'idle') : t('录制中', 'recording'),
            },
              active === undefined ? null : h(CardActions, null,
                h(Btn, { kind: 'primary', onClick: () => { void stop(); }, disabled: busy !== '' }, t('停止录制', 'Stop')),
              ),
              active === undefined
                ? h('div', { className: 'kvmflow-col' },
                  h('div', { className: 'kvmflow-form-grid' },
                    h(Field, { label: t('名称', 'Name'), className: 'wide' },
                      h('input', { className: 'kvmflow-input', value: recordName, placeholder: t('例如：BIOS 开启虚拟化', 'e.g. Enable virtualization in BIOS'), onChange: (event: any) => setRecordName(event.target.value) }),
                    ),
                    h(Field, { label: t('说明', 'Description'), className: 'wide' },
                      h('textarea', { className: 'kvmflow-input kvmflow-textarea compact', value: recordDesc, placeholder: t('这次录制要完成什么？', 'What should this recording accomplish?'), onChange: (event: any) => setRecordDesc(event.target.value) }),
                    ),
                  ),
                  h('div', { className: 'kvmflow-actions' },
                    h(Btn, { kind: 'primary', onClick: () => { void start(); }, disabled: deviceId === '' || busy !== '' }, t('开始录制', 'Start recording')),
                  ),
                  h('p', { className: 'kvmflow-hint' }, t('开始后，请在“实时画面”中操作目标机，并在每个有意义的阶段点击“标记步骤”。', 'After starting, drive the target from the Live screen and mark each meaningful stage as a step.')),
                )
                : h('div', { className: 'kvmflow-col' },
                  h('div', { className: 'kvmflow-kv' },
                    h('dt', null, t('名称', 'Name')), h('dd', null, active.name),
                    h('dt', null, t('事件', 'Events')), h('dd', null, String(active.eventCount)),
                    h('dt', null, t('步骤', 'Steps')), h('dd', null, String(active.stepCount)),
                  ),
                  h('div', { className: 'kvmflow-split' }),
                  h('div', { className: 'kvmflow-form-grid' },
                    h(Field, { label: t('步骤名称', 'Step name'), className: 'wide' },
                      h('input', { className: 'kvmflow-input', value: stepName, placeholder: t('例如：打开 Advanced', 'e.g. Open Advanced'), onChange: (event: any) => setStepName(event.target.value) }),
                    ),
                    h(Field, { label: t('步骤描述', 'Step description'), className: 'wide' },
                      h('textarea', { className: 'kvmflow-input kvmflow-textarea compact', value: stepDesc, placeholder: t('完成什么，画面应出现什么', 'What completes and what should appear'), onChange: (event: any) => setStepDesc(event.target.value) }),
                    ),
                  ),
                  h('div', { className: 'kvmflow-actions' },
                    h(Btn, { onClick: () => { void mark(); }, disabled: busy !== '' }, t('标记步骤', 'Mark step')),
                  ),
                ),
            ),
            h(Card, { title: t('录制列表', 'Recordings'), subtitle: `${recordings.length}` },
              recordings.length === 0
                ? h(Empty, null, t('还没有录制。从上方开始一次录制。', 'No recordings yet. Start one above.'))
                : h('div', { className: 'kvmflow-col' }, recordings.map((recording: any) => h('div', {
                  key: recording.id,
                  className: cn('kvmflow-device', recording.id === selectedId ? 'selected' : ''),
                  onClick: () => setSelectedId(recording.id),
                  style: { cursor: 'pointer' },
                },
                  h('div', null,
                    h('div', { className: 'kvmflow-device-name' }, recording.name),
                    h('div', { className: 'kvmflow-hint' }, `${t('事件', 'events')} ${recording.eventCount} · ${t('步骤', 'steps')} ${recording.stepCount} · ${formatDateTime(recording.updatedAt)}`),
                  ),
                  h(Pill, { tone: recording.status === 'recording' ? 'warn' : '' }, recording.status),
                ))),
            ),
          ),
          h('div', null,
            h(Card, {
              title: t('录制详情', 'Recording detail'),
              subtitle: selected === undefined ? t('未选择', 'none') : selected.status,
            },
              selected === undefined ? null : h(CardActions, null,
                h(Btn, { onClick: () => { void askAi(selected); } }, t('让 AI 生成工作流', 'Generate with AI')),
                selected.status === 'recording' ? null : h(ConfirmButton, {
                  kind: 'danger',
                  disabled: busy !== '',
                  confirmLabel: t('删除录制和截图？', 'Delete recording and screenshots?'),
                  confirmAction: t('删除', 'Delete'),
                  cancelLabel: t('取消', 'Cancel'),
                  onConfirm: () => { void removeRecording(); },
                }, t('删除', 'Delete')),
              ),
              selected === undefined
                ? h(Empty, null, t('选择一条录制查看步骤和事件。', 'Select a recording to inspect steps and events.'))
                : h('div', { className: 'kvmflow-col' },
                  h('div', { className: 'kvmflow-kv' },
                    h('dt', null, t('ID', 'ID')), h('dd', { className: 'kvmflow-mono' }, selected.id),
                    h('dt', null, t('名称', 'Name')), h('dd', null, selected.name),
                    h('dt', null, t('说明', 'Description')), h('dd', null, selected.description || '—'),
                    h('dt', null, t('开始', 'Started')), h('dd', null, formatDateTime(selected.createdAt)),
                  ),
                  h('div', { className: 'kvmflow-split' }),
                  h('h3', { className: 'kvmflow-card-title' }, h('span', null, t('人工步骤', 'Human steps')), h('span', { className: 'kvmflow-hint' }, `${selected.steps?.length ?? 0}`)),
                  (selected.steps ?? []).length === 0
                    ? h('div', { className: 'kvmflow-hint' }, t('尚未标记步骤。', 'No steps marked.'))
                    : h('div', { className: 'kvmflow-steps' }, (selected.steps ?? []).map((step: any) => h('div', { key: step.id, className: 'kvmflow-step' },
                      h('div', { className: 'kvmflow-step-head' },
                        h('div', { className: 'kvmflow-step-name' }, step.name),
                        h('div', { className: 'kvmflow-actions' },
                          h('span', { className: 'kvmflow-hint' }, `#${step.startSeq}–${step.endSeq}`),
                          h(Btn, { small: true, onClick: () => setEditing({ ...step }) }, t('编辑', 'Edit')),
                        ),
                      ),
                      step.description ? h('div', { className: 'kvmflow-step-body' }, h('div', { className: 'kvmflow-muted' }, step.description)) : null,
                      h('div', { className: 'kvmflow-thumb-row' },
                        h(ImageThumb, { shared, path: step.before ? `recordings/${selected.id}/${step.before}` : undefined, label: t('步骤前', 'before') }),
                        h(ImageThumb, { shared, path: step.after ? `recordings/${selected.id}/${step.after}` : undefined, label: t('步骤后', 'after') }),
                      ),
                    ))),
                  editing === undefined ? null : h('div', { className: 'kvmflow-step', style: { marginTop: '8px' } },
                    h(Field, { label: t('步骤名称', 'Step name') },
                      h('input', { className: 'kvmflow-input', value: editing.name ?? '', onChange: (event: any) => setEditing({ ...editing, name: event.target.value }) }),
                    ),
                    h(Field, { label: t('步骤描述', 'Step description') },
                      h('textarea', { className: 'kvmflow-input kvmflow-textarea compact', value: editing.description ?? '', onChange: (event: any) => setEditing({ ...editing, description: event.target.value }) }),
                    ),
                    h('div', { className: 'kvmflow-actions', style: { marginTop: '8px' } },
                      h(Btn, { kind: 'primary', onClick: () => { void saveStep(); }, disabled: busy !== '' }, t('保存步骤', 'Save step')),
                      h(Btn, { onClick: () => setEditing(undefined) }, t('取消', 'Cancel')),
                    ),
                  ),
                  h('div', { className: 'kvmflow-split' }),
                  h('h3', { className: 'kvmflow-card-title' }, h('span', null, t('事件流', 'Events')), h('span', { className: 'kvmflow-hint' }, `${selected.events?.length ?? 0}`)),
                  (selected.events ?? []).length === 0
                    ? h('div', { className: 'kvmflow-hint' }, t('尚无事件。', 'No events yet.'))
                    : h('div', { className: 'kvmflow-scroll-y kvmflow-log' }, (selected.events ?? []).map((entry: any) => h('div', { key: entry.seq, className: 'kvmflow-log-row' },
                      h('span', { className: 'kvmflow-log-time' }, `#${entry.seq} ${formatTime(entry.at)}`),
                      h('span', null, JSON.stringify(entry.event)),
                    ))),
                ),
            ),
          ),
        );
      }

      function WorkflowsTab(shared: any): any {
        const { state, runRpc, rpc, refresh, busy, t, notify, setTab } = shared;
        const workflows: any[] = state.workflows ?? [];
        const draft = shared.workflowDraft;
        const setDraft = shared.setWorkflowDraft;
        const [selectedId, setSelectedIdState] = useState(draft.id);
        const [detail, setDetail] = useState(undefined);
        const [newName, setNewName] = useState('');
        const yaml = draft.yaml;
        const dirty = draft.dirty;
        const setSelectedId = useCallback((id: string) => {
          setSelectedIdState(id);
          setDraft(current => ({ ...current, id }));
        }, [setDraft]);
        const setYaml = useCallback((value: string) => setDraft(current => ({ ...current, yaml: value })), [setDraft]);
        const setDirty = useCallback((value: boolean) => setDraft(current => ({ ...current, dirty: value })), [setDraft]);
        useEffect(() => {
          if (selectedId === '' && workflows.length > 0) setSelectedId(workflows[0].id);
        }, [workflows.length, selectedId, setSelectedId]);
        const load = useCallback(async (id: string): Promise<void> => {
          if (id === '') { setDetail(undefined); setYaml(''); return; }
          try {
            const value = await rpc('workflow.get', { id });
            setDetail(value.workflow);
            // A pending edit for this same workflow survives a refresh.
            setDraft(current => current.id === id && current.dirty
              ? current
              : { id, yaml: value.yaml, dirty: false });
          } catch (error: any) {
            notify(error.message ?? String(error), 'err');
          }
        }, [rpc, notify, setDraft, setYaml]);
        useEffect(() => { void load(selectedId); }, [selectedId, load]);
        const save = async (): Promise<boolean> => {
          const value = await runRpc(t('保存工作流', 'Save workflow'), 'workflow.save', { id: selectedId || undefined, yaml });
          if (value === undefined) return false;
          notify(t('工作流已保存。', 'Workflow saved.'), 'ok');
          setSelectedId(value.workflow.id);
          setDetail(value.workflow);
          setDraft({ id: value.workflow.id, yaml: value.yaml, dirty: false });
          await refresh();
          return true;
        };
        const create = async (): Promise<void> => {
          const value = await runRpc(t('新建工作流', 'Create workflow'), 'workflow.create', { name: newName || t('新工作流', 'New workflow'), deviceId: shared.deviceId });
          if (value !== undefined) {
            setNewName('');
            setSelectedId(value.workflow.id);
            setDetail(value.workflow);
            setDraft({ id: value.workflow.id, yaml: value.yaml, dirty: false });
            notify(t('已创建工作流骨架。', 'Workflow skeleton created.'), 'ok');
            await refresh();
          }
        };
        const remove = async (): Promise<void> => {
          const value = await runRpc(t('删除工作流', 'Delete workflow'), 'workflow.delete', { id: selectedId });
          if (value !== undefined) {
            notify(t('工作流已删除。', 'Workflow removed.'), 'ok');
            setSelectedId('');
            setDetail(undefined);
            setDraft({ id: '', yaml: '', dirty: false });
            await refresh();
          }
        };
        const run = async (): Promise<void> => {
          // Running a stale copy is worse than an extra save: persist the open
          // draft first so the executed document is the one on screen.
          if (dirty && !(await save())) return;
          const value = await runRpc(t('启动执行', 'Start run'), 'run.start', { workflowId: selectedId, deviceId: shared.deviceId });
          if (value !== undefined) {
            notify(
              t('执行已启动。', 'Run started.'),
              'ok',
              { label: t('查看执行', 'Supervise run'), onClick: () => setTab('runs') },
            );
            setTab('runs');
            await refresh();
          }
        };
        const runDisabledReason = selectedId === ''
          ? t('先选择工作流', 'Select a workflow first')
          : shared.deviceId === ''
            ? t('先选择 KVM 设备', 'Select a KVM device first')
            : state.activeRun !== undefined && state.activeRun !== null
              ? t('已有执行进行中', 'A run is already active')
              : dirty
                ? t('将先保存再执行', 'The draft will be saved before running')
                : undefined;
        const askAi = async (): Promise<void> => {
          if (detail === undefined) return;
          const prompt = [
            `请编辑 KVMFlow 工作流 ${detail.id}（当前名称：${detail.name}）。`,
            '先调用 kvmflow_workflow_get 读取 YAML，再根据我的目标改进 steps：补充前置条件、成功验证和失败处理。',
            '需要视觉判断的 verify 用 mode: vision 并写出明确的画面条件；可确定画面变化时用 change。',
            '保存时调用 kvmflow_workflow_save（保留 id），不要覆盖无关字段。',
            '',
            '我的修改目标：',
          ].join('\n');
          await shared.handPrompt(
            prompt,
            t('已在新会话中启动 AI 编辑。', 'Started a new session for AI editing.'),
            t('无法自动创建会话，提示词已显示在下方，请手动复制。', 'Could not open a session automatically; copy the prompt shown below.'),
          );
        };
        return h('div', { className: 'kvmflow-grid two' },
          h('div', null,
            h(Card, { title: t('工作流', 'Workflows'), subtitle: `${workflows.length}` },
              h('div', { className: 'kvmflow-row', style: { marginBottom: '8px' } },
                h('input', { className: 'kvmflow-input', style: { flex: '1 1 auto' }, value: newName, placeholder: t('新工作流名称', 'New workflow name'), onChange: (event: any) => setNewName(event.target.value) }),
                h(Btn, { onClick: () => { void create(); }, disabled: busy !== '' }, t('新建', 'New')),
              ),
              workflows.length === 0
                ? h(Empty, null, t('还没有工作流。从录制生成，或新建一个。', 'No workflows yet. Generate one from a recording or create a new one.'))
                : h('div', { className: 'kvmflow-col' }, workflows.map((workflow: any) => h('div', {
                  key: workflow.id,
                  className: cn('kvmflow-device', workflow.id === selectedId ? 'selected' : ''),
                  onClick: () => setSelectedId(workflow.id),
                  style: { cursor: 'pointer' },
                },
                  h('div', null,
                    h('div', { className: 'kvmflow-device-name' }, workflow.name),
                    h('div', { className: 'kvmflow-hint' }, `${t('步骤', 'steps')} ${workflow.stepCount}${workflow.hasBios ? ` · ${t('BIOS 前奏', 'BIOS prelude')}` : ''} · ${formatDateTime(workflow.updatedAt)}`),
                    workflow.error ? h('div', { className: 'kvmflow-hint', style: { color: 'var(--dsw-alias-state-error-primary)' } }, workflow.error) : null,
                  ),
                  workflow.error ? h(Pill, { tone: 'err' }, 'invalid') : h(Pill, null, workflow.id.slice(0, 14)),
                ))),
            ),
            h(Card, { title: t('工作流说明', 'Workflow notes') },
              h('p', { className: 'kvmflow-hint' },
                t(
                  '工作流是 YAML：version、name、可选 bios、steps。每个 step 包含 precondition、action、verify、onFailure。验证支持 change（画面哈希变化）、image（与参考图比较）和 vision（调用默认 DSH 视觉模型判断）。',
                  'A workflow is YAML: version, name, optional bios, steps. Each step has precondition, action, verify, onFailure. Verification supports change (hash), image (reference), and vision (default DSH visual model).',
                ),
              ),
            ),
          ),
          h('div', null,
            h(Card, {
              title: detail === undefined ? t('YAML 编辑器', 'YAML editor') : detail.name,
              // Saved state lives in the subtitle; the row stays four even buttons
              // with one primary action and the destructive one last.
              subtitle: [
                selectedId === '' ? t('未选择', 'none') : selectedId,
                dirty ? t('未保存', 'unsaved') : t('已保存', 'saved'),
              ].join(' · '),
            },
              h(CardActions, null,
                h(Btn, { onClick: () => { void askAi(); }, disabled: detail === undefined }, t('AI 编辑', 'Edit with AI')),
                h(Btn, { onClick: () => { void save(); }, disabled: selectedId === '' || busy !== '' || !dirty }, t('保存', 'Save')),
                h(Btn, {
                  kind: 'primary',
                  onClick: () => { void run(); },
                  disabled: selectedId === '' || busy !== '' || shared.deviceId === '' || (state.activeRun !== undefined && state.activeRun !== null),
                  title: runDisabledReason,
                }, t('执行', 'Run')),
                h(ConfirmButton, {
                  kind: 'danger',
                  disabled: selectedId === '' || busy !== '',
                  confirmLabel: t('删除该工作流？', 'Delete this workflow?'),
                  confirmAction: t('删除', 'Delete'),
                  cancelLabel: t('取消', 'Cancel'),
                  onConfirm: () => { void remove(); },
                }, t('删除', 'Delete')),
              ),
              detail === undefined
                ? h(Empty, null, t('从左侧选择或新建工作流。', 'Select or create a workflow on the left.'))
                : h('div', { className: 'kvmflow-col' },
                  h('div', { className: 'kvmflow-row' },
                    h(Pill, null, `${t('步骤', 'steps')} ${detail.steps?.length ?? 0}`),
                    detail.bios ? h(Pill, { tone: 'warn' }, `BIOS ${detail.bios.hotkey ?? 'F2'}`) : null,
                    detail.sourceRecording
                      ? h('button', {
                        type: 'button',
                        className: 'kvmflow-btn small',
                        onClick: () => setTab('recorder'),
                        title: t('查看来源录制', 'Open the source recording'),
                      }, t('来源录制', 'from recording'))
                      : null,
                    h('span', { className: 'kvmflow-hint' }, formatDateTime(detail.updatedAt)),
                  ),
                  h('textarea', {
                    className: 'kvmflow-textarea',
                    value: yaml,
                    spellCheck: false,
                    onChange: (event: any) => { setYaml(event.target.value); setDirty(true); },
                  }),
                  h('p', { className: 'kvmflow-hint' }, t('保存时会解析并规范化；YAML 出错会保留原文并显示行号。', 'Saving parses and normalizes the document; YAML errors keep the text and report the line.')),
                  (detail.steps ?? []).length === 0 ? null : h('div', { className: 'kvmflow-steps' }, (detail.steps ?? []).map((step: any, index: number) => h('div', { key: step.id, className: 'kvmflow-step' },
                    h('div', { className: 'kvmflow-step-head' },
                      h('div', { className: 'kvmflow-step-name' }, `${index + 1}. ${step.name}`),
                      h(Pill, null, step.verify?.mode ?? 'change'),
                    ),
                    h('div', { className: 'kvmflow-step-body' },
                      step.description ? h('div', { className: 'kvmflow-muted' }, step.description) : null,
                      h('div', { className: 'kvmflow-hint kvmflow-mono' }, `${step.action?.type}${step.action?.key ? ` ${step.action.key}` : ''}${step.action?.keys ? ` ${step.action.keys.join('+')}` : ''}${step.action?.events ? ` · ${step.action.events.length} events` : ''}`),
                      step.verify?.prompt ? h('div', { className: 'kvmflow-hint' }, `verify: ${step.verify.prompt}`) : null,
                    ),
                  ))),
                ),
            ),
          ),
        );
      }

      function RunsTab(shared: any): any {
        const { state, runRpc, rpc, refresh, busy, t, notify } = shared;
        const [run, setRun] = useState(state.activeRun ?? undefined);
        const [selectedRunId, setSelectedRunId] = useState('');
        const [pollError, setPollError] = useState('');
        const refreshRun = useCallback(async (): Promise<void> => {
          const id = selectedRunId || state.activeRun?.id;
          try {
            const value = await rpc('run.get', id === undefined || id === '' ? {} : { id });
            if (value.run !== null && value.run !== undefined) setRun(value.run);
            setPollError('');
          } catch (error: any) {
            setPollError(error?.message ?? String(error));
          }
        }, [rpc, selectedRunId, state.activeRun?.id]);
        useEffect(() => {
          if (state.activeRun !== undefined && state.activeRun !== null && (run === undefined || run.id !== state.activeRun.id)) {
            setSelectedRunId('');
            setRun(state.activeRun);
          }
        }, [state.activeRun?.id]);
        const terminal = run !== undefined && ['succeeded', 'failed', 'aborted'].includes(run.status);
        useEffect(() => {
          void refreshRun();
          if (terminal) return undefined;
          const timer = setInterval(() => { void refreshRun(); }, 1500);
          return () => clearInterval(timer);
        }, [refreshRun, terminal]);
        const control = async (action: string): Promise<void> => {
          if (run === undefined) return;
          const value = await runRpc(t('执行控制', 'Run control'), 'run.control', { id: run.id, action });
          if (value !== undefined) {
            setRun(value.run);
            await refresh();
          }
        };
        const current = run ?? state.activeRun;
        const awaiting = current?.awaiting;
        const actions: string[] = awaiting?.actions ?? [];
        const canPause = current !== undefined && (current.status === 'running' || current.status === 'armed') && !actions.includes('pause');
        const actionLabels: Record<string, [string, string]> = {
          resume: ['继续', 'Resume'], retry: ['重试步骤', 'Retry step'], continue: ['忽略并继续', 'Continue'], skip: ['跳过', 'Skip'], abort: ['中止', 'Abort'], confirm_bios: ['确认已进入 BIOS', 'Confirm BIOS'], pause: ['暂停', 'Pause'],
        };
        return h('div', { className: 'kvmflow-grid two' },
          h('div', null,
            h(Card, {
              title: t('执行状态', 'Run status'),
              subtitle: current === undefined ? t('暂无执行', 'none') : current.id,
            },
              h(CardActions, null,
                h(Btn, { onClick: () => { void refreshRun(); } }, t('刷新', 'Refresh')),
                canPause ? h(Btn, { onClick: () => { void control('pause'); }, disabled: busy !== '' }, t('暂停', 'Pause')) : null,
                current === undefined || current.status === 'succeeded' || current.status === 'failed' || current.status === 'aborted' ? null : h(Btn, { kind: 'danger', onClick: () => { void control('abort'); }, disabled: busy !== '' }, t('中止', 'Abort')),
              ),
              pollError === '' ? null : h('div', { className: 'kvmflow-notice err', style: { marginBottom: '8px' } }, pollError),
              current === undefined
                ? h(Empty, null, t('还没有执行记录。先在“工作流”页启动一个工作流。', 'No runs yet. Start one from the Workflows tab.'))
                : h('div', { className: 'kvmflow-col' },
                  h('div', { className: 'kvmflow-row' },
                    h(Pill, { tone: statusTone(current.status) }, statusLabel(t, current.status)),
                    h(Pill, null, current.phase),
                    current.bios ? h(Pill, { tone: 'warn' }, `BIOS ${current.bios.hotkey} · every ${current.bios.intervalMs}ms`) : null,
                  ),
                  current.reason ? h('div', { className: 'kvmflow-notice err', style: { marginBottom: 0 } }, current.reason) : null,
                  awaiting ? h('div', { className: 'kvmflow-notice', style: { marginBottom: 0 } },
                    h('span', null, awaiting.message),
                    h('div', { className: 'kvmflow-actions' }, actions.map(action => h(Btn, { key: action, kind: action === 'abort' ? 'danger' : action === 'confirm_bios' || action === 'retry' ? 'primary' : undefined, onClick: () => { void control(action); }, disabled: busy !== '' }, actionLabels[action]?.[0] ?? action))),
                  ) : null,
                  h('div', { className: 'kvmflow-split' }),
                  h('div', { className: 'kvmflow-steps' }, (current.steps ?? []).map((step: any) => h('div', { key: step.id, className: cn('kvmflow-step', step.status) },
                    h('div', { className: 'kvmflow-step-head' },
                      h('div', { className: 'kvmflow-step-name' }, `${step.index + 1}. ${step.name}`),
                      h('div', { className: 'kvmflow-actions' },
                        step.attempts > 1 ? h('span', { className: 'kvmflow-hint' }, `×${step.attempts}`) : null,
                        h(StepStatus, { status: step.status, t }),
                      ),
                    ),
                    step.verify ? h('div', { className: 'kvmflow-step-body' }, h('div', { className: 'kvmflow-muted' }, `${step.verify.mode}: ${step.verify.reason}`)) : null,
                    step.error && (!step.verify || step.verify.reason !== step.error) ? h('div', { className: 'kvmflow-hint', style: { color: 'var(--dsw-alias-state-error-primary)' } }, step.error) : null,
                    h('div', { className: 'kvmflow-thumb-row' },
                      h(ImageThumb, { shared, path: step.before, label: t('操作前', 'before') }),
                      h(ImageThumb, { shared, path: step.after, label: t('操作后', 'after') }),
                    ),
                  ))),
                ),
            ),
          ),
          h('div', null,
            h(Card, { title: t('执行日志', 'Run log'), subtitle: `${current?.log?.length ?? 0}` },
              current === undefined
                ? h('div', { className: 'kvmflow-hint' }, '—')
                : h('div', { className: 'kvmflow-log' }, (current.log ?? []).slice(-60).map((entry: any, index: number) => h('div', { key: index, className: cn('kvmflow-log-row', entry.level === 'error' ? 'err' : entry.level === 'warn' ? 'warn' : '') },
                  h('span', { className: 'kvmflow-log-time' }, formatTime(entry.at)),
                  h('span', null, entry.message),
                ))),
            ),
            h(Card, { title: t('历史执行', 'Recent runs'), subtitle: `${state.recentRuns?.length ?? 0}` },
              (state.recentRuns ?? []).length === 0
                ? h('div', { className: 'kvmflow-hint' }, t('暂无历史。', 'No history.'))
                : h('div', { className: 'kvmflow-col' }, (state.recentRuns ?? []).map((entry: any) => h('div', {
                  key: entry.id,
                  className: cn('kvmflow-device', entry.id === current?.id ? 'selected' : ''),
                  style: { cursor: 'pointer' },
                  onClick: () => { setSelectedRunId(entry.id); void rpc('run.get', { id: entry.id }).then((value: any) => { if (value.run !== null) setRun(value.run); }); },
                },
                  h('div', null,
                    h('div', { className: 'kvmflow-device-name' }, entry.workflowName),
                    h('div', { className: 'kvmflow-hint' }, `${formatDateTime(entry.createdAt)} · ${t('步骤', 'step')} ${entry.currentStepIndex + 1}/${entry.totalSteps}`),
                  ),
                  h(Pill, { tone: statusTone(entry.status) }, statusLabel(t, entry.status)),
                ))),
            ),
          ),
        );
      }

      const RIGHT_TAB_ID = 'dsh-kvmflow/sidebar';
      const RIGHT_TAB_KIND = 'kvmflow';

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'kvmflow',
      }, Panel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'kvmflow',
        order: 5,
        label: () => 'KVMFlow',
      }, Icon));

      // Dockable companion tab: the same panel, sized for the right column, so a
      // human can drive the KVM while the conversation stays visible.
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: RIGHT_TAB_ID,
        kind: RIGHT_TAB_KIND,
        priority: 'extension',
        title: () => 'KVMFlow',
        guide: [{
          id: 'kvmflow.live',
          order: 40,
          title: (): string => 'KVMFlow',
          description: (): string => 'Watch and drive the KVM target beside the chat.',
          icon: Icon,
        }],
      }), 'kvmflow: right tab type');
      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: RIGHT_TAB_ID,
      }, function KvmflowSidebarTab(): any {
        return h(Panel, { compact: true });
      }));
      ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: RIGHT_TAB_ID,
      }, function KvmflowSidebarTabTitle(): any {
        return h('span', null, 'KVMFlow');
      }));

    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply,
    };
  },
});
