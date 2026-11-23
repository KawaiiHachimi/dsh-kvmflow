/**
 * KVMFlow browser half: a native DSH main panel plus sidebar entry.
 *
 * `main.tsx` bundles this module with the graph editor; React comes from the
 * DSH module table, and Host operations go through the authenticated
 * `/kvmflow` RPC channel.
 */
import type { FlowUi } from './flow/types';

/**
 * Build the client plugin.
 * @param requireModule - resolves modules from the DSH module table.
 * @param flowUi - graph editor and run graph components.
 * @returns the plugin's inject list and apply function.
 */
export function createPlugin(requireModule: (id: string) => any, flowUi: FlowUi): { inject: string[]; apply: (ctx: any) => void } {
    const React = requireModule('react');
    const ReactDOM = requireModule('react-dom');
    const createPortal = ReactDOM?.createPortal;
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useMemo = React.useMemo;
    const useCallback = React.useCallback;
    const useRef = React.useRef;

    const CSS = `
.kvmflow-root {
  container-type: inline-size;
  --kvmflow-control-h: 28px;
  height: 100%;
  overflow: auto;
  padding: max(14px, calc(var(--dsh-frame-top-clearance, 0px) - 6px)) 22px 64px;
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
.kvmflow-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: var(--kvmflow-control-h); border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 1; padding: 0 10px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
@media (hover: hover) {
  .kvmflow-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, var(--dsw-alias-bg-layer-2)); }
}
.kvmflow-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.kvmflow-btn:disabled { opacity: 0.45; cursor: default; }
.kvmflow-btn.primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); font-weight: 600; }
@media (hover: hover) {
  .kvmflow-btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 86%, var(--dsw-alias-label-primary)); border-color: transparent; color: var(--dsw-alias-bg-base); }
}
.kvmflow-btn.danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l1)); }
.kvmflow-btn.small { height: 24px; padding: 0 8px; font-size: 11px; }
.kvmflow-input, .kvmflow-select, .kvmflow-textarea { width: 100%; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 0 8px; font: inherit; font-size: 12px; outline: none; }
.kvmflow-input, .kvmflow-select { height: var(--kvmflow-control-h); }
.kvmflow-input:focus, .kvmflow-select:focus, .kvmflow-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.kvmflow-textarea { height: auto; min-height: 260px; padding: 6px 8px; resize: vertical; line-height: 1.55; font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); font-size: 12px; }
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
.kvmflow-notice { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); border-radius: 8px; padding: 7px 10px; margin-bottom: 10px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; line-height: 1.45; }
/* The message keeps the row height and wraps; the actions stay one compact row,
   vertically centred against it, so a one-line notice is not top-heavy. */
.kvmflow-notice > :first-child { flex: 1 1 auto; min-width: 0; }
.kvmflow-notice > .kvmflow-actions { flex: none; align-items: center; }
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
.kvmflow-icon-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--kvmflow-control-h); height: var(--kvmflow-control-h); padding: 0; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); cursor: pointer; }
@media (hover: hover) {
  .kvmflow-icon-btn:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, var(--dsw-alias-bg-layer-2)); }
}
.kvmflow-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.kvmflow-icon-btn[aria-pressed='true'] { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1)); }
.kvmflow-screen-status { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kvmflow-screen-focus { margin-left: auto; color: var(--dsw-alias-brand-primary); font-weight: 500; }
.kvmflow-inline-select { width: auto; flex: none; height: var(--kvmflow-control-h); padding: 0 8px; font-size: 12px; }
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
.kvmflow-device.kvmflow-run-item { flex-wrap: nowrap; align-items: center; gap: 8px; padding: 9px 11px; }
.kvmflow-device.kvmflow-run-item > div:first-child { flex: 1 1 0; min-width: 0; }
.kvmflow-device.kvmflow-run-item .kvmflow-hint { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kvmflow-device.kvmflow-run-item > .kvmflow-actions { flex: none; flex-wrap: nowrap; }
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

.kvmflow-pill-btn { appearance: none; cursor: pointer; font: inherit; font-size: 11px; max-width: 18rem; overflow: hidden; text-overflow: ellipsis; }
@media (hover: hover) { .kvmflow-pill-btn:hover { border-color: currentColor; } }
.kvmflow-pill-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.kvmflow-pill.attention { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-border-l1)); }
.kvmflow-rec-dot { animation: kvmflow-blink 1.2s ease-in-out infinite; }
@keyframes kvmflow-blink { 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .kvmflow-rec-dot { animation: none; } }
.kvmflow-tab { display: inline-flex; align-items: center; gap: 6px; }
.kvmflow-tab-badge { font-size: 10px; line-height: 15px; min-width: 15px; padding: 0 4px; border-radius: 8px; text-align: center; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l1); }
.kvmflow-tab-badge.alert { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 50%, transparent); }

/* Workflows: a narrow list beside a full-height editor. */
.kvmflow-wf { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 12px; align-items: start; }
.kvmflow-wf.collapsed { grid-template-columns: minmax(0, 1fr); }
.kvmflow-wf.collapsed .kvmflow-wf-list { display: none; }
.kvmflow-wf-list { display: flex; flex-direction: column; gap: 8px; position: sticky; top: 0; max-height: calc(100vh - 170px); overflow: auto; }
.kvmflow-wf-list-head { display: flex; align-items: center; gap: 6px; }
.kvmflow-wf-list-title { font-weight: 650; flex: 1 1 auto; }
.kvmflow-wf-items { display: flex; flex-direction: column; gap: 6px; }
.kvmflow-wf-item { border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 8px 10px; background: var(--dsw-alias-bg-layer-1); cursor: pointer; display: flex; flex-direction: column; gap: 3px; outline: none; }
.kvmflow-wf-item:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
@media (hover: hover) { .kvmflow-wf-item:hover { border-color: var(--dsw-alias-border-l2); } }
.kvmflow-wf-item.selected { border-color: var(--dsw-alias-brand-primary); box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary); }
.kvmflow-wf-item-name { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12.5px; min-width: 0; }
.kvmflow-wf-item-name > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kvmflow-wf-item-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kvmflow-wf-item-meta.err, .kvmflow-wf-issues { color: var(--dsw-alias-state-warn-primary); }
.kvmflow-wf-item-meta.err { color: var(--dsw-alias-state-error-primary); word-break: break-word; }
.kvmflow-wf-item-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 20px; }
.kvmflow-wf-empty { border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; padding: 14px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.kvmflow-wf-empty p { margin: 0; }
.kvmflow-wf-main { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.kvmflow-wf-reopen { appearance: none; align-self: flex-start; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); border-radius: 7px; font: inherit; font-size: 11.5px; padding: 3px 9px; cursor: pointer; }
@container (max-width: 860px) {
  .kvmflow-wf { grid-template-columns: minmax(0, 1fr); }
  .kvmflow-wf-list { position: static; max-height: 260px; }
}
.kvmflow-awaiting { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-2); }
.kvmflow-awaiting.attention { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-border-l1)); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 6%, var(--dsw-alias-bg-layer-1)); }
.kvmflow-awaiting.human { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 50%, var(--dsw-alias-border-l1)); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 5%, var(--dsw-alias-bg-layer-1)); }
.kvmflow-awaiting-title { font-weight: 650; }
.kvmflow-awaiting-msg { font-size: 12px; }
.kvmflow-run-stats { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kvmflow-run-stats .kvmflow-mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.kvmflow-section-title { font-size: 12px; font-weight: 650; margin: 4px 0 6px; }
.kvmflow-trace { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-height: 360px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
.kvmflow-trace-row { display: grid; grid-template-columns: 42px minmax(70px, max-content) max-content minmax(0, 1fr) max-content; gap: 8px; align-items: baseline; padding: 5px 8px; font-size: 11.5px; border-bottom: 1px solid var(--dsw-alias-border-l1); cursor: pointer; }
.kvmflow-trace-row:last-child { border-bottom: 0; }
@media (hover: hover) { .kvmflow-trace-row:hover { background: var(--dsw-alias-bg-layer-2); } }
.kvmflow-trace-row.focus { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); }
.kvmflow-trace-row.failed .kvmflow-trace-node { color: var(--dsw-alias-state-error-primary); }
.kvmflow-trace-seq, .kvmflow-trace-time { color: var(--dsw-alias-label-secondary); font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 10.5px; }
.kvmflow-trace-node { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kvmflow-trace-port { color: var(--dsw-alias-brand-primary); white-space: nowrap; }
.kvmflow-trace-port.err { color: var(--dsw-alias-state-error-primary); }
.kvmflow-trace-reason { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kvmflow-trace-focus { border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 9px 11px; background: var(--dsw-alias-bg-layer-2); display: flex; flex-direction: column; gap: 6px; }
.kvmflow-pre { margin: 0; font-size: 11px; font-family: var(--ds-font-family-code, ui-monospace, monospace); white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto; }
@container (max-width: 560px) {
  .kvmflow-trace-row { grid-template-columns: 36px minmax(0, 1fr) max-content; }
  .kvmflow-trace-reason, .kvmflow-trace-time { display: none; }
}

/* Modal dialog & workflow composer. Portaled to document.body so container-type / sticky / canvas stacking contexts never clip it. */
.kvmflow-modal-backdrop { --kvmflow-control-h: 28px; position: fixed; inset: 0; z-index: 9999; background: color-mix(in srgb, #000 52%, transparent); display: flex; align-items: center; justify-content: center; padding: 20px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); box-sizing: border-box; }
.kvmflow-modal-backdrop * { box-sizing: border-box; }
.kvmflow-modal { width: min(520px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 12px); box-shadow: 0 18px 44px color-mix(in srgb, #000 32%, transparent); color: var(--dsw-alias-label-primary); overflow: hidden; }
.kvmflow-modal.wide { width: min(760px, 100%); }
.kvmflow-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.kvmflow-modal-title { font-size: 14px; font-weight: 650; margin: 0; }
.kvmflow-modal-sub { font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.kvmflow-modal-body { padding: 14px 16px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.kvmflow-modal-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 11px 16px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.kvmflow-modal-msg { margin: 0; font-size: 13px; line-height: 1.55; color: var(--dsw-alias-label-primary); }
.kvmflow-device-wrap { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.kvmflow-compose-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 12px; min-height: 240px; }
.kvmflow-compose-col { border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 10px; background: var(--dsw-alias-bg-base); display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow: auto; }
.kvmflow-compose-col-head { font-size: 11.5px; font-weight: 650; color: var(--dsw-alias-label-secondary); display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
.kvmflow-compose-item { border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; padding: 7px 9px; background: var(--dsw-alias-bg-layer-1); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kvmflow-compose-item-info { min-width: 0; flex: 1 1 auto; }
.kvmflow-compose-item-name { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kvmflow-compose-selected { flex-direction: column; align-items: stretch; gap: 6px; }
.kvmflow-compose-selected-top { display: flex; align-items: center; gap: 6px; }
.kvmflow-compose-index { width: 20px; height: 20px; border-radius: 50%; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex: none; color: var(--dsw-alias-label-secondary); }
.kvmflow-compose-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.kvmflow-compose-mode { appearance: none; text-align: left; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 9px 11px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer; display: flex; flex-direction: column; gap: 3px; font: inherit; }
.kvmflow-compose-mode.on { border-color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-1)); }
.kvmflow-compose-mode-title { font-size: 12.5px; font-weight: 650; }
.kvmflow-preset-row, .kvmflow-custom-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-2); font-size: 11.5px; min-height: 30px; }
.kvmflow-capture { display: flex; align-items: center; justify-content: center; min-height: 84px; padding: 14px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-2); cursor: text; outline: none; }
.kvmflow-capture:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); }
.kvmflow-capture-hint { color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.kvmflow-capture-keys { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 15px; font-weight: 600; color: var(--dsw-alias-brand-primary); }
.kvmflow-history-panel { margin-top: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.kvmflow-history-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); }
.kvmflow-history-list { display: flex; flex-direction: column; max-height: 200px; overflow: auto; }
.kvmflow-history-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px dashed color-mix(in srgb, var(--dsw-alias-border-l1) 70%, transparent); }
.kvmflow-history-row:last-child { border-bottom: 0; }
.kvmflow-history-text { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; padding: 3px 4px; cursor: pointer; flex: 1 1 auto; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 5px; }
@media (hover: hover) {
  .kvmflow-history-text:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
}
@media (max-width: 680px) {
  .kvmflow-compose-grid, .kvmflow-compose-modes { grid-template-columns: minmax(0, 1fr); }
}

`;

    /**
     * Coerce a typed device origin into an absolute http(s) URL, mirroring the
     * Host's rule: a bare IP or host defaults to http:// and a trailing slash is
     * dropped, while a path prefix is kept.
     */
    function normalizeBaseUrlInput(raw: string): string {
      const text = (raw ?? '').trim();
      if (text === '') return '';
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
      try {
        const url = new URL(withScheme);
        if (url.hostname === '') return text;
        const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
        return `${url.protocol}//${url.host}${path}`;
      } catch {
        return text;
      }
    }

    /** KeyboardEvent.code aliases accepted in the custom-shortcut field. */
    const KEY_ALIASES: Record<string, string> = {
      ctrl: 'ControlLeft',
      control: 'ControlLeft',
      shift: 'ShiftLeft',
      alt: 'AltLeft',
      option: 'AltLeft',
      win: 'MetaLeft',
      meta: 'MetaLeft',
      cmd: 'MetaLeft',
      command: 'MetaLeft',
      super: 'MetaLeft',
      esc: 'Escape',
      escape: 'Escape',
      del: 'Delete',
      delete: 'Delete',
      ins: 'Insert',
      insert: 'Insert',
      enter: 'Enter',
      return: 'Enter',
      space: 'Space',
      tab: 'Tab',
      spacebar: 'Space',
      backspace: 'Backspace',
      bs: 'Backspace',
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight',
      plus: 'Equal',
      minus: 'Minus',
      comma: 'Comma',
      period: 'Period',
      slash: 'Slash',
      home: 'Home',
      end: 'End',
      pageup: 'PageUp',
      pagedown: 'PageDown',
      printscreen: 'PrintScreen',
      pause: 'Pause',
      capslock: 'CapsLock',
      numlock: 'NumLock',
      scrolllock: 'ScrollLock',
    };

    /**
     * Parse a typed key chord such as `Ctrl+Alt+Del` or `F2` into HID key codes.
     * @param text - keys separated by `+`, whitespace, or commas.
     * @returns the codes in press order, or `undefined` when nothing usable was typed.
     */
    function parseShortcutKeys(text: string): string[] | undefined {
      const parts = (text ?? '').split(/[+\s,、]+/).map(part => part.trim()).filter(part => part !== '');
      if (parts.length === 0 || parts.length > 4) return undefined;
      const keys: string[] = [];
      for (const part of parts) {
        const lower = part.toLowerCase();
        if (KEY_ALIASES[lower] !== undefined) {
          keys.push(KEY_ALIASES[lower]);
          continue;
        }
        if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) {
          keys.push(`F${lower.slice(1)}`);
          continue;
        }
        if (/^[a-z]$/.test(lower)) {
          keys.push(`Key${lower.toUpperCase()}`);
          continue;
        }
        if (/^[0-9]$/.test(part)) {
          keys.push(`Digit${part}`);
          continue;
        }
        // Already a KeyboardEvent.code ("KeyA", "ArrowUp", "F12").
        if (/^[A-Za-z][A-Za-z0-9]*$/.test(part)) {
          keys.push(part);
          continue;
        }
        return undefined;
      }
      return keys.length === 0 ? undefined : keys;
    }

    /** Friendly label for a stored chord: modifiers keep their short names. */
    function formatShortcutKeys(keys: string[]): string {
      const short: Record<string, string> = {
        ControlLeft: 'Ctrl', ControlRight: 'Ctrl', ShiftLeft: 'Shift', ShiftRight: 'Shift',
        AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Win', MetaRight: 'Win',
        Escape: 'Esc', Delete: 'Del', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      };
      return keys.map(key => short[key] ?? (key.startsWith('Key') ? key.slice(3) : key.startsWith('Digit') ? key.slice(5) : key)).join('+');
    }

    /** Canonical modifier codes, in the order a chord is described. */
    const MODIFIER_ORDER = ['ControlLeft', 'ShiftLeft', 'AltLeft', 'MetaLeft'];

    /** Canonical modifier a physical modifier key belongs to, or undefined for any other key. */
    function canonicalModifier(code: string): string | undefined {
      if (code.startsWith('Control')) return 'ControlLeft';
      if (code.startsWith('Shift')) return 'ShiftLeft';
      if (code.startsWith('Alt')) return 'AltLeft';
      if (code.startsWith('Meta')) return 'MetaLeft';
      return undefined;
    }

    /** Sort held modifiers into the canonical chord order. */
    function orderModifiers(held: readonly string[]): string[] {
      return MODIFIER_ORDER.filter(code => held.includes(code));
    }

    /** Built-in shortcut buttons; a user may hide any of them and restore them later. */
    const DEFAULT_SHORTCUTS: Array<{ label: string; keys: string[] }> = [
      { label: 'Ctrl+Alt+Del', keys: ['ControlLeft', 'AltLeft', 'Delete'] },
      { label: 'Esc', keys: ['Escape'] },
      { label: 'Enter', keys: ['Enter'] },
      { label: 'F2', keys: ['F2'] },
      { label: 'F12', keys: ['F12'] },
      { label: 'Win', keys: ['MetaLeft'] },
    ];

    /** Hard ceiling for stored custom shortcuts; well above any practical number. */
    const MAX_CUSTOM_SHORTCUTS = 200;

    /** Labels of the built-in shortcuts this browser has hidden. */
    function readHiddenPresets(): string[] {
      try {
        const raw = window.localStorage.getItem('kvmflow.shortcuts.hidden');
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((label: unknown): label is string => typeof label === 'string' && DEFAULT_SHORTCUTS.some(entry => entry.label === label));
      } catch {
        return [];
      }
    }

    /** Read the saved custom shortcut buttons. */
    function readCustomShortcuts(): Array<{ label: string; keys: string[] }> {
      try {
        const raw = window.localStorage.getItem('kvmflow.shortcuts');
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((entry: any) => entry !== null && typeof entry === 'object' && Array.isArray(entry.keys) && entry.keys.every((key: any) => typeof key === 'string') && entry.keys.length > 0)
          .map((entry: any) => ({ label: typeof entry.label === 'string' && entry.label !== '' ? entry.label : formatShortcutKeys(entry.keys), keys: entry.keys }));
      } catch {
        return [];
      }
    }

    /**
     * Live locale reader, installed by `apply()`.
     *
     * Most UI text goes through the `t(zh, en)` hook a component receives, but a
     * few strings live outside any component: the module-scope defaults of Modal
     * and ConfirmButton, an image alt, and the right sidebar's guide row, whose
     * title and description are callbacks the shell invokes. Those read the same
     * locale snapshot through this bridge so the whole panel follows the DSH
     * language instead of falling back to English.
     */
    let readLocale: (() => any) | undefined;

    /**
     * Translate one string outside a component render.
     * @param zh - Chinese text.
     * @param en - English text.
     * @returns the text for the locale DSH is currently showing.
     */
    function tr(zh: string, en: string): string {
      let snapshot: any;
      try {
        snapshot = readLocale?.();
      } catch {
        snapshot = undefined;
      }
      const active = typeof snapshot?.active === 'string' ? snapshot.active : 'en';
      return active.toLowerCase().startsWith('zh') ? zh : en;
    }

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
          h('button', {
            type: 'button',
            className: 'kvmflow-btn small',
            'aria-label': props.dismissLabel ?? tr('关闭提示', 'Dismiss'),
            title: props.dismissLabel ?? tr('关闭提示', 'Dismiss'),
            onClick: props.onClose,
          }, '×'),
        ),
      );
    }

    /** Lightweight modal dialog with Escape and backdrop dismissal. */
    function Modal(props: any): any {
      // A capture dialog needs Escape for itself, so it can opt out of the close key.
      const dismissOnEscape = props.dismissOnEscape !== false;
      useEffect(() => {
        if (!props.open || !dismissOnEscape) return undefined;
        const onKey = (event: KeyboardEvent): void => {
          if (event.key === 'Escape') props.onClose?.();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [props.open, props.onClose, dismissOnEscape]);
      if (!props.open) return null;
      const overlay = h('div', {
        className: 'kvmflow-modal-backdrop',
        onClick: (event: any) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) props.onClose?.();
        },
      },
        h('div', {
          className: cn('kvmflow-modal', props.wide ? 'wide' : ''),
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': props.title,
          onClick: (event: any) => event.stopPropagation(),
        },
          h('div', { className: 'kvmflow-modal-head' },
            h('div', null,
              h('h3', { className: 'kvmflow-modal-title' }, props.title),
              props.subtitle ? h('div', { className: 'kvmflow-modal-sub' }, props.subtitle) : null,
            ),
            h('button', {
              type: 'button',
              className: 'kvmflow-icon-btn',
              'aria-label': tr('关闭', 'Close'),
              title: tr('关闭', 'Close'),
              onClick: () => props.onClose?.(),
            }, '×'),
          ),
          h('div', { className: 'kvmflow-modal-body' }, props.children),
          props.footer ? h('div', { className: 'kvmflow-modal-foot' }, props.footer) : null,
        ),
      );
      return typeof createPortal === 'function' && typeof document !== 'undefined' && document.body !== null
        ? createPortal(overlay, document.body)
        : overlay;
    }

    /** Destructive control backed by a confirmation modal so narrow layouts never jump. */
    function ConfirmButton(props: any): any {
      const [open, setOpen] = useState(false);
      return h(React.Fragment, null,
        h(Btn, {
          kind: props.kind,
          className: props.small ? 'small' : props.className,
          disabled: props.disabled,
          title: props.title,
          onClick: (event: any) => {
            event?.stopPropagation?.();
            setOpen(true);
          },
        }, props.children),
        h(Modal, {
          open,
          title: props.confirmTitle ?? props.confirmLabel ?? tr('请确认', 'Confirm'),
          onClose: () => setOpen(false),
          footer: h(React.Fragment, null,
            h(Btn, { onClick: () => setOpen(false) }, props.cancelLabel ?? tr('取消', 'Cancel')),
            h(Btn, {
              kind: 'danger',
              disabled: props.disabled,
              onClick: () => {
                setOpen(false);
                props.onConfirm();
              },
            }, props.confirmAction ?? tr('删除', 'Delete')),
          ),
        },
          h('p', { className: 'kvmflow-modal-msg' }, props.confirmLabel ?? tr('确定要继续吗？', 'Are you sure?')),
          props.confirmDetail ? h('p', { className: 'kvmflow-hint', style: { margin: 0 } }, props.confirmDetail) : null,
        ),
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
      return h('img', { className: 'kvmflow-thumb', src: source, alt: props.label ?? tr('截图', 'screen capture') });
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

            /**
     * Panel/tab glyph: the black monitor mark from icon.svg with its pink cursor.
     *
     * The left panel list asks for 16-18px and prints the artwork edge to edge.
     * The right sidebar's guide row and tab strip ask for 22-26px, where the same
     * drawing reads noticeably heavier than the glyphs beside it, so the artwork
     * shrinks to 75% inside the requested box while the box itself keeps the size
     * the slot asked for (no layout shift).
     */
    function Icon(props: any): any {
      const size = typeof props.size === 'number' ? props.size : 18;
      const shrink = size >= 20;
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
        ...(props.className === undefined ? {} : { className: props.className }),
      },
        h('g', { transform: shrink ? 'translate(18 18) scale(0.75) translate(-18 -18)' : undefined },
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
        ),
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
      const localeSnapshot = () => ctx.locale.getSnapshot();
      readLocale = localeSnapshot;

      function useT(): (zh: string, en: string) => string {
        const snapshot = React.useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
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
        const [loadError, setLoadError] = useState('');
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
        const [deviceHealth, setDeviceHealth] = useState({});
        const reportDeviceHealth = useCallback((id: string, status: 'ok' | 'err') => {
          if (id === '') return;
          setDeviceHealth((current: Record<string, 'ok' | 'err'>) => (current[id] === status ? current : { ...current, [id]: status }));
        }, []);
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
            setLoadError('');
            setState((previous: any) => {
              if (previous === undefined && (next.devices ?? []).length === 0) setTab('devices');
              return next;
            });
            if (deviceId === '' && typeof next.defaultDeviceId === 'string') setDeviceId(next.defaultDeviceId);
            if (deviceId !== '' && Array.isArray(next.devices) && !next.devices.some((device: any) => device.id === deviceId)) {
              setDeviceId(typeof next.defaultDeviceId === 'string' ? next.defaultDeviceId : '');
            }
          } catch (error: any) {
            // Keep the reason visible: the first `state` call decides whether the
            // whole panel can render at all, and the polling retry below heals a
            // transient failure without the user reloading the page.
            setLoadError(error?.message ?? String(error));
            setNotice({ message: error?.message ?? String(error), tone: 'err' });
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
          if (value === undefined) {
            reportDeviceHealth(id, 'err');
            return;
          }
          const probeValue = value.probe ?? {};
          const connected = probeValue.video === true || (probeValue.reachable === true && probeValue.authenticated === true);
          reportDeviceHealth(id, connected ? 'ok' : 'err');
          if (probeValue.video === true) notify(t('连接成功，已获取画面信号。', 'Connected; video signal available.'), 'ok');
          else if (probeValue.reachable === false) notify(t('无法连接设备，请检查地址与网络。', 'Cannot reach the device; check the origin and network.'), 'err');
          else if (probeValue.authenticated === false) notify(t('设备可达但访问令牌被拒绝。', 'Device reachable but the access token was rejected.'), 'err');
          else notify(t('设备与令牌有效，但当前没有画面信号（目标机可能未开机）。', 'Device and token are valid, but there is no video signal (the target may be off).'), 'warn');
        }, [notify, reportDeviceHealth, runRpc, t]);
        useEffect(() => {
          if (deviceId === '' || state === undefined) return undefined;
          let cancelled = false;
          void rpc('device.probe', { deviceId }).then((value: any) => {
            if (cancelled) return;
            const probeValue = value?.probe ?? {};
            const connected = probeValue.video === true || (probeValue.reachable === true && probeValue.authenticated === true);
            reportDeviceHealth(deviceId, connected ? 'ok' : 'err');
          }).catch(() => {
            if (!cancelled) reportDeviceHealth(deviceId, 'err');
          });
          return () => { cancelled = true; };
        }, [deviceId, state !== undefined, reportDeviceHealth]);
        const shared = useMemo(() => ({
          state, setState, tab, setTab, deviceId, setDeviceId, busy, setBusy, notify, log, logs, setLogs, refresh, rpc, runRpc, t,
          workflowDraft, setWorkflowDraft, recordDraft, setRecordDraft, handPrompt, probe, reportDeviceHealth, compact,
        }), [state, tab, deviceId, busy, notify, log, logs, refresh, runRpc, t, workflowDraft, recordDraft, handPrompt, probe, reportDeviceHealth, compact]);
        if (state === undefined) {
          return h('div', { className: 'kvmflow-root' },
            h('style', null, CSS),
            loadError === ''
              ? h('div', { className: 'kvmflow-empty' }, busy || t('正在加载 KVMFlow…', 'Loading KVMFlow…'))
              : h('div', { className: 'kvmflow-card' },
                h('div', { className: 'kvmflow-card-title' }, t('无法连接 KVMFlow 后端', 'Cannot reach the KVMFlow backend')),
                h('p', { className: 'kvmflow-hint', style: { marginTop: 0, wordBreak: 'break-word' } }, loadError),
                h('p', { className: 'kvmflow-hint' },
                  t('插件可能未启用、刚被 DSH 更新替换，或它在 Host 侧加载时出错。请在 DSH 的插件页确认 KVMFlow 已启用；改动过代码时请重新安装插件。此页面每 4 秒自动重试。',
                    'The plugin may be disabled, replaced by a DSH update, or failed to load on the Host. Check that KVMFlow is enabled in the Plugins page; after changing code, reinstall the plugin. This page retries every 4 seconds.'),
                ),
                h('div', { className: 'kvmflow-actions' },
                  h(Btn, { onClick: () => { void refresh(); }, disabled: busy !== '' }, t('立即重试', 'Retry now')),
                ),
              ),
          );
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
          h('style', null, flowUi.CSS),
          h('div', { className: 'kvmflow-head' },
            h('div', { className: 'kvmflow-head-main' },
              h('div', { className: 'kvmflow-title-row' },
                h('h1', { className: 'kvmflow-title' }, 'KVMFlow'),
                state.activeRun === undefined || state.activeRun === null ? null : h('button', {
                  type: 'button',
                  className: cn('kvmflow-pill', 'kvmflow-pill-btn', statusTone(state.activeRun.status), state.activeRun.awaiting ? 'attention' : ''),
                  onClick: () => setTab('runs'),
                  title: t('查看执行', 'Open the run'),
                }, h('span', { className: cn('kvmflow-dot', state.activeRun.awaiting ? 'err' : 'on') }), state.activeRun.awaiting ? t('等待处理', 'Needs you') : statusLabel(t, state.activeRun.status), ` · ${state.activeRun.workflowName}`),
                state.activeRecording === undefined ? null : h('button', {
                  type: 'button',
                  className: 'kvmflow-pill kvmflow-pill-btn warn',
                  onClick: () => setTab('recorder'),
                  title: t('查看录制', 'Open the recorder'),
                }, h('span', { className: 'kvmflow-dot err kvmflow-rec-dot' }), t(`录制中 · ${state.activeRecording.eventCount} 事件`, `Recording · ${state.activeRecording.eventCount} events`)),
              ),
              h('p', { className: 'kvmflow-sub' },
                t('录制、编排和执行 IP-KVM 工作流', 'Record, author and run IP-KVM workflows'),
              ),
            ),
            h('div', { className: 'kvmflow-head-right' },
              h('span', { className: 'kvmflow-device-wrap' },
                (() => {
                  const health = selectedDevice === undefined ? undefined : deviceHealth[selectedDevice.id];
                  const dotClass = selectedDevice === undefined ? 'err' : health === 'ok' ? 'on' : 'err';
                  const dotTitle = selectedDevice === undefined
                    ? t('未连接设备', 'No device connected')
                    : health === 'ok'
                      ? t(`已连接：${selectedDevice.name}`, `Connected: ${selectedDevice.name}`)
                      : t(`未连接或无法访问：${selectedDevice.name}`, `Disconnected or unreachable: ${selectedDevice.name}`);
                  return h('span', { className: cn('kvmflow-dot', dotClass), title: dotTitle });
                })(),
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
            tabs.map(entry => {
              const badge = entry.id === 'devices' ? ((state.devices ?? []).length === 0 ? '!' : '')
                : entry.id === 'workflows' ? String((state.workflows ?? []).length || '')
                  : entry.id === 'recorder' ? (state.activeRecording === undefined ? '' : '●')
                    : entry.id === 'runs' ? (state.activeRun?.awaiting ? '!' : state.activeRun ? '●' : '')
                      : '';
              const alert = badge === '!' || (entry.id === 'recorder' && badge === '●');
              return h('button', {
                key: entry.id,
                type: 'button',
                role: 'tab',
                id: `kvmflow-tab-${entry.id}`,
                tabIndex: tab === entry.id ? 0 : -1,
                'aria-selected': tab === entry.id,
                'aria-controls': 'kvmflow-tabpanel',
                className: cn('kvmflow-tab', tab === entry.id ? 'active' : ''),
                onClick: () => setTab(entry.id),
              }, t(entry.zh, entry.en), badge === '' ? null : h('span', { className: cn('kvmflow-tab-badge', alert ? 'alert' : '') }, badge));
            }),
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
        const [modalOpen, setModalOpen] = useState(false);
        const [editingId, setEditingId] = useState('');
        const EMPTY_FORM = {
          driver: 'linkr', name: '', baseUrl: '', token: '', notes: '',
          webUsername: '', webPassword: '',
        };
        const [form, setForm] = useState(EMPTY_FORM);
        const editingDevice = (state.devices ?? []).find((device: any) => device.id === editingId);
        const openAdd = (): void => {
          setEditingId('');
          setForm(EMPTY_FORM);
          setModalOpen(true);
        };
        const openEdit = (device: any): void => {
          setEditingId(device.id);
          setForm({
            driver: device.driver ?? 'linkr',
            name: device.name ?? '',
            baseUrl: device.baseUrl ?? '',
            token: '',
            notes: device.notes ?? '',
            webUsername: device.username ?? '',
            webPassword: '',
          });
          setModalOpen(true);
        };
        const closeModal = (): void => {
          setModalOpen(false);
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
              closeModal();
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
              closeModal();
              await refresh();
            }
          }
        };
        const remove = async (id: string): Promise<void> => {
          const value = await runRpc(t('删除设备', 'Remove device'), 'device.remove', { id });
          if (value !== undefined) {
            shared.notify(t('设备已删除', 'Device removed'), 'ok');
            if (deviceId === id) setDeviceId('');
            if (editingId === id) closeModal();
            await refresh();
          }
        };
        const canSave = busy === '' && form.baseUrl.trim() !== '' && (editingId !== '' || form.token.trim() !== '');
        return h('div', null,
          h(Card, {
            title: t('KVM 设备', 'KVM devices'),
            subtitle: `${state.devices?.length ?? 0}`,
            actions: [
              h(Btn, { kind: 'primary', onClick: openAdd, disabled: busy !== '' }, t('+ 添加设备', '+ Add device')),
            ],
          },
            (state.devices ?? []).length === 0
              ? h('div', { className: 'kvmflow-empty' },
                h('div', { style: { marginBottom: '10px' } }, t('还没有配置 IP-KVM 设备。支持同时管理多台设备并随时切换。', 'No IP-KVM devices yet. You can manage multiple devices and switch between them at any time.')),
                h(Btn, { kind: 'primary', onClick: openAdd }, t('+ 添加第一台设备', '+ Add your first device')),
              )
              : h('div', { className: 'kvmflow-col' }, (state.devices ?? []).map((device: any) => h('div', {
                key: device.id,
                className: cn('kvmflow-device', device.id === deviceId ? 'selected' : ''),
              },
                h('div', null,
                  h('div', { className: 'kvmflow-device-name' }, device.name),
                  h('div', { className: 'kvmflow-muted kvmflow-mono' }, device.baseUrl),
                  h('div', { className: 'kvmflow-hint' }, [
                    device.driver === 'linkr' ? 'Radxa Linkr' : device.driver,
                    device.hasToken ? t('令牌已保存', 'token saved') : t('缺少令牌', 'token missing'),
                    device.hasWebCredentials ? t('视频账号已配置', 'video account set') : t('无视频账号', 'no video account'),
                    device.id === deviceId ? t('当前使用中', 'active') : '',
                  ].filter(Boolean).join(' · ')),
                  device.notes ? h('div', { className: 'kvmflow-hint' }, device.notes) : null,
                  device.viewMapping === undefined ? null : h('div', { className: 'kvmflow-hint' }, t(
                    `画面映射：左 ${Math.round(device.viewMapping.left * 100)}% 上 ${Math.round(device.viewMapping.top * 100)}% 右 ${Math.round(device.viewMapping.right * 100)}% 下 ${Math.round(device.viewMapping.bottom * 100)}%`,
                    `view mapping: left ${Math.round(device.viewMapping.left * 100)}% top ${Math.round(device.viewMapping.top * 100)}% right ${Math.round(device.viewMapping.right * 100)}% bottom ${Math.round(device.viewMapping.bottom * 100)}%`,
                  )),
                ),
                h('div', { className: 'kvmflow-actions' },
                  h(Btn, { onClick: () => { setDeviceId(device.id); }, disabled: device.id === deviceId }, device.id === deviceId ? t('使用中', 'Active') : t('使用', 'Use')),
                  h(Btn, { onClick: () => openEdit(device) }, t('编辑', 'Edit')),
                  h(Btn, { onClick: () => { void shared.probe(device.id); }, disabled: busy !== '' }, t('测试', 'Test')),
                  h(ConfirmButton, {
                    kind: 'danger',
                    disabled: busy !== '',
                    confirmTitle: t('删除设备', 'Remove device'),
                    confirmLabel: t(`确定要删除设备“${device.name}”吗？`, `Remove device "${device.name}"?`),
                    confirmDetail: t('该设备的访问令牌与 Web 账号将一并从 devices.json 移除。', 'Its access token and web credentials will also be removed from devices.json.'),
                    confirmAction: t('删除', 'Delete'),
                    cancelLabel: t('取消', 'Cancel'),
                    onConfirm: () => { void remove(device.id); },
                  }, t('删除', 'Remove')),
                ),
              ))),
          ),
          h(Modal, {
            open: modalOpen,
            title: editingId === '' ? t('添加 IP-KVM 设备', 'Add IP-KVM device') : t('编辑设备', 'Edit device'),
            subtitle: editingId === '' ? t('可添加多台设备，在顶部下拉框随时切换。', 'Add multiple devices and switch between them from the top bar.') : editingDevice?.baseUrl,
            onClose: closeModal,
            footer: h(React.Fragment, null,
              h(Btn, { onClick: closeModal }, t('取消', 'Cancel')),
              h(Btn, { kind: 'primary', onClick: () => { void save(); }, disabled: !canSave }, editingId === '' ? t('添加', 'Add') : t('保存', 'Save')),
            ),
          },
            h('div', { className: 'kvmflow-form-grid' },
              h(Field, { label: t('设备类型', 'Device driver'), className: 'wide' },
                h('select', { className: 'kvmflow-select', value: form.driver, onChange: (event: any) => setForm({ ...form, driver: event.target.value }) },
                  h('option', { value: 'linkr' }, t('Radxa Linkr（公开 HTTP API + WebRTC）', 'Radxa Linkr (Public HTTP API + WebRTC)')),
                  h('option', { value: 'other', disabled: true }, t('其他 IP-KVM（GL.iNet / PiKVM — 预留扩展点）', 'Other IP-KVM (GL.iNet / PiKVM — coming soon)')),
                ),
              ),
              h(Field, { label: t('名称', 'Name'), className: 'wide' },
                h('input', { className: 'kvmflow-input', value: form.name, placeholder: 'Lab Linkr', onChange: (event: any) => setForm({ ...form, name: event.target.value }) }),
              ),
              h(Field, { label: t('地址', 'Origin'), className: 'wide', hint: t('填 IP 或主机名即可，保存时会自动补全 http://。', 'An IP or host name is enough; http:// is added on save.') },
                h('input', {
                  className: 'kvmflow-input',
                  value: form.baseUrl,
                  placeholder: '192.168.1.100',
                  onChange: (event: any) => setForm({ ...form, baseUrl: event.target.value }),
                  onBlur: () => setForm((current: any) => ({ ...current, baseUrl: normalizeBaseUrlInput(current.baseUrl) })),
                }),
              ),
              h(Field, { label: t('访问令牌', 'Access token'), className: 'wide', hint: editingId === '' ? t('在 Linkr Web 控制台的“系统设置 → 访问令牌”中生成后粘贴到这里；保存为 devices.json（权限 0600）。', 'Generate one in the Linkr web console under System settings → Access tokens, then paste it here. Stored in devices.json with mode 0600.') : t('留空表示保留现有令牌。', 'Leave blank to keep the current token.') },
                h('input', { className: 'kvmflow-input', type: 'password', value: form.token, placeholder: editingId === '' ? 'radxa_linkr_…' : '••••••••', onChange: (event: any) => setForm({ ...form, token: event.target.value }) }),
              ),
              h(Field, { label: t('备注', 'Notes'), className: 'wide' },
                h('input', { className: 'kvmflow-input', value: form.notes, onChange: (event: any) => setForm({ ...form, notes: event.target.value }) }),
              ),
              h(Field, { label: t('Web 用户名（实时视频用）', 'Web username (for live video)'), hint: t('只有实时视频需要 Web 账号。', 'Only live video needs the web account.') },
                h('input', { className: 'kvmflow-input', value: form.webUsername, autoComplete: 'off', onChange: (event: any) => setForm({ ...form, webUsername: event.target.value }) }),
              ),
              h(Field, { label: t('Web 密码', 'Web password'), hint: editingId === '' ? t('与 Web 控制台登录密码相同（0600）。', 'Same as web console password (0600).') : t('留空表示保留现有密码。', 'Leave blank to keep stored password.') },
                h('input', { className: 'kvmflow-input', type: 'password', value: form.webPassword, autoComplete: 'new-password', placeholder: editingId === '' ? '' : (editingDevice?.hasWebCredentials ? '••••••••' : t('未设置', 'not set')), onChange: (event: any) => setForm({ ...form, webPassword: event.target.value }) }),
              ),
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
        const [focused, setFocused] = useState(false);
        const [text, setText] = useState('');
        const [textHistory, setTextHistory] = useState([]);
        const [historyCursor, setHistoryCursor] = useState(-1);
        const [historyOpen, setHistoryOpen] = useState(false);
        const [customShortcuts, setCustomShortcuts] = useState(readCustomShortcuts);
        const [hiddenPresets, setHiddenPresets] = useState(readHiddenPresets);
        const saveHiddenPresets = useCallback((next: string[]) => {
          setHiddenPresets(next);
          try { window.localStorage.setItem('kvmflow.shortcuts.hidden', JSON.stringify(next)); } catch { /* ignore */ }
        }, []);
        const visiblePresets = DEFAULT_SHORTCUTS.filter(entry => !hiddenPresets.includes(entry.label));
        const [shortcutOpen, setShortcutOpen] = useState(false);
        const [shortcutLabel, setShortcutLabel] = useState('');
        const [shortcutKeys, setShortcutKeys] = useState('');
        const [shortcutError, setShortcutError] = useState('');
        const [shortcutManual, setShortcutManual] = useState(false);
        const [heldModifiers, setHeldModifiers] = useState([]);
        const captureRef = useRef(null);
        useEffect(() => {
          if (!shortcutOpen || shortcutManual) return undefined;
          // Focus the capture area once it exists so the next keystroke lands here
          // instead of the page or the label field.
          const timer = setTimeout(() => captureRef.current?.focus?.(), 30);
          return () => clearTimeout(timer);
        }, [shortcutOpen, shortcutManual]);
        const saveCustomShortcuts = useCallback((next: Array<{ label: string; keys: string[] }>) => {
          setCustomShortcuts(next);
          try { window.localStorage.setItem('kvmflow.shortcuts', JSON.stringify(next)); } catch { /* ignore */ }
        }, []);
        /**
         * Save one chord and close the dialog; a repeated label replaces that entry.
         * Nothing is ever dropped behind the user's back: at the storage ceiling
         * the dialog reports it and keeps every existing shortcut.
         */
        const commitShortcut = (keys: string[]): void => {
          const label = shortcutLabel.trim() !== '' ? shortcutLabel.trim() : formatShortcutKeys(keys);
          const replaced = customShortcuts.some(entry => entry.label === label);
          if (!replaced && customShortcuts.length >= MAX_CUSTOM_SHORTCUTS) {
            setShortcutError(t(`最多保存 ${MAX_CUSTOM_SHORTCUTS} 个自定义快捷键，已达上限；请先删除不用的。`, `At most ${MAX_CUSTOM_SHORTCUTS} custom shortcuts; delete one first.`));
            return;
          }
          saveCustomShortcuts([...customShortcuts.filter(entry => entry.label !== label), { label, keys }]);
          shared.notify(t(`已添加快捷键 ${label}`, `Shortcut ${label} added`), 'ok');
          closeShortcutDialog();
        };
        const closeShortcutDialog = (): void => {
          setShortcutOpen(false);
          setShortcutLabel('');
          setShortcutKeys('');
          setShortcutError('');
          setShortcutManual(false);
          setHeldModifiers([]);
        };
        const addManualShortcut = (): void => {
          const keys = parseShortcutKeys(shortcutKeys);
          if (keys === undefined) {
            setShortcutError(t('请填写有效按键，例如 Ctrl+Alt+Del、F2、Alt+Tab（最多 4 个键）。', 'Enter a valid chord, e.g. Ctrl+Alt+Del, F2, Alt+Tab (up to 4 keys).'));
            return;
          }
          commitShortcut(keys);
        };
        /**
         * Record real key presses: modifiers accumulate while held, and the first
         * non-modifier key finishes the chord and saves it.
         */
        const captureKeyDown = (event: any): void => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          const code: string = typeof event.code === 'string' ? event.code : '';
          if (code === '') return;
          const modifier = canonicalModifier(code);
          if (modifier !== undefined) {
            setHeldModifiers((current: string[]) => (current.includes(modifier) ? current : [...current, modifier]));
            return;
          }
          commitShortcut([...orderModifiers(heldModifiers), code]);
        };
        const captureKeyUp = (event: any): void => {
          if (event.target !== event.currentTarget) return;
          const modifier = canonicalModifier(typeof event.code === 'string' ? event.code : '');
          if (modifier === undefined) return;
          event.preventDefault();
          setHeldModifiers((current: string[]) => current.filter(code => code !== modifier));
        };
        useEffect(() => {
          let cancelled = false;
          void rpc('history.list').then(async (value: any) => {
            if (cancelled) return;
            const disk: string[] = Array.isArray(value?.items) ? value.items : [];
            if (disk.length > 0) {
              setTextHistory(disk);
              return;
            }
            // One-time migration from earlier localStorage history into ~/.dsh/kvmflow/text-history.txt.
            try {
              const raw = window.localStorage.getItem('kvmflow.textHistory');
              const legacy = raw ? JSON.parse(raw) : [];
              if (Array.isArray(legacy) && legacy.length > 0) {
                const cleaned = legacy.filter((item: unknown) => typeof item === 'string' && item !== '');
                for (const item of [...cleaned].reverse()) {
                  await rpc('history.add', { text: item }).catch(() => {});
                }
                if (!cancelled) setTextHistory(cleaned);
                window.localStorage.removeItem('kvmflow.textHistory');
              }
            } catch {
              /* ignore */
            }
          }).catch(() => {});
          return () => { cancelled = true; };
        }, [rpc]);
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
            shared.reportDeviceHealth?.(deviceId, 'ok');
            rateStrikes.current = 0;
          } catch (error: any) {
            setFrameError(error.message ?? String(error));
            shared.reportDeviceHealth?.(deviceId, 'err');
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
        useEffect(() => {
          if (videoLive && deviceId !== '') shared.reportDeviceHealth?.(deviceId, 'ok');
        }, [videoLive, deviceId, shared.reportDeviceHealth]);
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
        const sendTextValue = (raw: string): void => {
          if (raw === '') return;
          const events: any[] = [];
          for (let index = 0; index < raw.length; index += 120) events.push(['text', raw.slice(index, index + 120)]);
          void send(events, `text ${Math.min(raw.length, 60)}${raw.length > 60 ? '…' : ''}`);
          setTextHistory((current: string[]) => [raw, ...current.filter(item => item !== raw)].slice(0, 100));
          void rpc('history.add', { text: raw }).then((value: any) => {
            if (Array.isArray(value?.items)) setTextHistory(value.items);
          }).catch(() => {});
          setHistoryCursor(-1);
        };
        const typeText = (): void => {
          if (text === '') return;
          sendTextValue(text);
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
                onFocus: () => setFocused(true),
                onBlur: () => {
                  setFocused(false);
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
                      alt: tr('KVM 画面', 'KVM screen'),
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
                focused ? h('span', { className: 'kvmflow-screen-focus' }, t('键盘已接管 · 按 Tab 退出', 'Keyboard captured · Tab to leave')) : null,
              ),
              deviceId === '' ? null : h('div', { className: 'kvmflow-actions', style: { marginTop: '10px' } },
                ...visiblePresets.map(entry => h(Btn, {
                  key: `preset-${entry.label}`,
                  onClick: () => shortcut(entry.keys),
                  title: t(`发送 ${entry.label}`, `Send ${entry.label}`),
                }, entry.label)),
                ...customShortcuts.map(entry => h(Btn, {
                  key: `custom-${entry.label}`,
                  onClick: () => shortcut(entry.keys),
                  title: t(`发送 ${entry.label}`, `Send ${entry.label}`),
                }, entry.label)),
                h(Btn, {
                  onClick: () => { setShortcutError(''); setShortcutOpen(true); },
                  title: t('添加快捷键', 'Add a shortcut'),
                  'aria-label': t('添加快捷键', 'Add a shortcut'),
                }, '+'),
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
                  placeholder: t('输入 ASCII 文本（Linkr 文本通道，↑/↓ 翻历史）', 'Type ASCII text (Linkr text channel, ↑/↓ for history)'),
                  onChange: (event: any) => { setText(event.target.value); setHistoryCursor(-1); },
                  onKeyDown: (event: any) => {
                    if (event.key === 'Enter') {
                      typeText();
                    } else if (event.key === 'ArrowUp' && textHistory.length > 0) {
                      event.preventDefault();
                      const next = Math.min(textHistory.length - 1, historyCursor + 1);
                      setHistoryCursor(next);
                      setText(textHistory[next]);
                    } else if (event.key === 'ArrowDown' && historyCursor >= 0) {
                      event.preventDefault();
                      const next = historyCursor - 1;
                      setHistoryCursor(next);
                      setText(next < 0 ? '' : textHistory[next]);
                    }
                  },
                }),
                h(Btn, { onClick: typeText, disabled: text === '' || deviceId === '' }, t('输入', 'Type')),
                h(Btn, {
                  onClick: () => setHistoryOpen((open: boolean) => !open),
                  disabled: textHistory.length === 0,
                  'aria-expanded': historyOpen,
                  title: t('展开/收起输入历史', 'Toggle text input history'),
                }, textHistory.length === 0 ? t('历史', 'History') : t(`历史 (${textHistory.length})`, `History (${textHistory.length})`)),
              ),
              historyOpen && textHistory.length > 0 ? h('div', { className: 'kvmflow-history-panel', 'aria-label': t('输入历史', 'Text history') },
                h('div', { className: 'kvmflow-history-head' },
                  h('span', null, t(`历史输入（${textHistory.length}）· 点击命令填入输入框`, `Text history (${textHistory.length}) · click a command to fill`)),
                  h(ConfirmButton, {
                    small: true,
                    kind: 'danger',
                    confirmTitle: t('清空输入历史', 'Clear text history'),
                    confirmLabel: t(`确定要清空全部 ${textHistory.length} 条历史输入吗？`, `Clear all ${textHistory.length} saved text entries?`),
                    confirmAction: t('清空', 'Clear'),
                    cancelLabel: t('取消', 'Cancel'),
                    onConfirm: () => {
                      setTextHistory([]);
                      setHistoryCursor(-1);
                      setHistoryOpen(false);
                      void rpc('history.clear').catch(() => {});
                    },
                  }, t('清空全部', 'Clear all')),
                ),
                h('div', { className: 'kvmflow-history-list' }, textHistory.map((item: string) => h('div', { key: item, className: 'kvmflow-history-row' },
                  h('button', {
                    type: 'button',
                    className: 'kvmflow-history-text',
                    title: item,
                    onClick: () => { setText(item); setHistoryCursor(-1); },
                  }, item),
                  h(Btn, {
                    small: true,
                    disabled: deviceId === '',
                    title: t('直接发送', 'Send now'),
                    'aria-label': t(`发送 ${item}`, `Send ${item}`),
                    onClick: () => sendTextValue(item),
                  }, t('发送', 'Send')),
                  h(Btn, {
                    small: true,
                    kind: 'danger',
                    title: t('删除此条', 'Remove entry'),
                    'aria-label': t(`删除 ${item}`, `Remove ${item}`),
                    onClick: () => {
                      const next = textHistory.filter((entry: string) => entry !== item);
                      setTextHistory(next);
                      if (next.length === 0) setHistoryOpen(false);
                      void rpc('history.remove', { text: item }).then((value: any) => {
                        if (Array.isArray(value?.items)) setTextHistory(value.items);
                      }).catch(() => {});
                    },
                  }, t('删除', 'Delete')),
                ))),
              ) : null,
            ),
            h(Modal, {
              open: shortcutOpen,
              title: t('自定义快捷键', 'Custom shortcuts'),
              subtitle: t('按下一次要发送的按键（单个键或组合键）即保存；设置只保存在本机浏览器。', 'Press the key or chord once to send later; it is saved immediately. Settings stay in this browser.'),
              onClose: closeShortcutDialog,
              dismissOnEscape: false,
              footer: h(Btn, { onClick: closeShortcutDialog }, t('关闭', 'Close')),
            },
              !shortcutManual ? h('div', { className: 'kvmflow-col' },
                h('div', {
                  ref: captureRef,
                  className: 'kvmflow-capture',
                  tabIndex: 0,
                  role: 'button',
                  autoFocus: true,
                  'aria-label': t('按键捕获区，请按下要保存的按键', 'Key capture area: press the chord to save'),
                  onKeyDown: captureKeyDown,
                  onKeyUp: captureKeyUp,
                  onBlur: () => setHeldModifiers([]),
                },
                  heldModifiers.length === 0
                    ? h('span', { className: 'kvmflow-capture-hint' }, t('请按下按键…', 'Press the keys now…'))
                    : h('span', { className: 'kvmflow-capture-keys' }, `${formatShortcutKeys(orderModifiers(heldModifiers))} + …`),
                ),
                h('div', { className: 'kvmflow-hint' },
                  t('按住修饰键再按一个键即可保存，例如按住 Ctrl 和 Shift 再按 Esc。个别组合会被浏览器抢先（如 Cmd+W），可改用手动输入。',
                    'Hold the modifiers, then press one key: hold Ctrl and Shift, then press Esc. A few chords are taken by the browser (e.g. Cmd+W); use manual entry for those.'),
                ),
                h('button', { type: 'button', className: 'kf-link', onClick: () => setShortcutManual(true) }, t('改用手动输入', 'Enter manually')),
              ) : h('div', { className: 'kvmflow-col' },
                h(Field, { label: t('按键组合', 'Key chord'), hint: t('用 + 连接：Ctrl、Shift、Alt、Win、Esc、Del、Enter、Tab、F1–F24、字母或数字。', 'Join with +: Ctrl, Shift, Alt, Win, Esc, Del, Enter, Tab, F1-F24, a letter or digit.') },
                  h('input', {
                    className: 'kvmflow-input',
                    value: shortcutKeys,
                    placeholder: 'Ctrl+Shift+Esc',
                    autoFocus: true,
                    onChange: (event: any) => { setShortcutKeys(event.target.value); setShortcutError(''); },
                    onKeyDown: (event: any) => { if (event.key === 'Enter') addManualShortcut(); },
                  }),
                ),
                h('div', { className: 'kvmflow-actions' },
                  h(Btn, { onClick: () => { setShortcutManual(false); setShortcutError(''); } }, t('改为按键捕获', 'Capture keys')),
                  h(Btn, { kind: 'primary', onClick: addManualShortcut, disabled: shortcutKeys.trim() === '' }, t('添加', 'Add')),
                ),
              ),
              h(Field, { label: t('按钮名称（可选）', 'Button label (optional)'), hint: t('留空则用按键组合作为名称。', 'Empty uses the chord as the label.') },
                h('input', {
                  className: 'kvmflow-input',
                  value: shortcutLabel,
                  placeholder: parseShortcutKeys(shortcutKeys) === undefined ? '' : formatShortcutKeys(parseShortcutKeys(shortcutKeys) as string[]),
                  onChange: (event: any) => setShortcutLabel(event.target.value),
                }),
              ),
              shortcutError === '' ? null : h('div', { className: 'kvmflow-hint', style: { color: 'var(--dsw-alias-state-error-primary)' } }, shortcutError),
              h('div', { className: 'kvmflow-split' }),
              h('div', { className: 'kvmflow-row', style: { justifyContent: 'space-between' } },
                h('span', { className: 'kvmflow-wf-list-title' }, t('预设快捷键', 'Preset shortcuts'), h('span', { className: 'kvmflow-hint' }, ` ${visiblePresets.length}/${DEFAULT_SHORTCUTS.length}`)),
                h(Btn, {
                  small: true,
                  disabled: hiddenPresets.length === 0,
                  title: t('把隐藏的预设快捷键全部恢复', 'Bring back every hidden preset'),
                  onClick: () => {
                    saveHiddenPresets([]);
                    shared.notify(t('已恢复默认预设快捷键。', 'Default preset shortcuts restored.'), 'ok');
                  },
                }, t('恢复默认预设', 'Restore defaults')),
              ),
              h('div', { className: 'kvmflow-col' }, DEFAULT_SHORTCUTS.map(entry => {
                const hidden = hiddenPresets.includes(entry.label);
                return h('div', { key: `preset-${entry.label}`, className: 'kvmflow-preset-row' },
                  h('span', { className: cn('kvmflow-mono', hidden ? 'kvmflow-muted' : '') }, `${entry.label}  ·  ${formatShortcutKeys(entry.keys)}`),
                  hidden
                    ? h('span', { className: 'kvmflow-hint' }, t('已隐藏', 'hidden'))
                    : h(Btn, {
                      small: true,
                      kind: 'danger',
                      'aria-label': t(`隐藏预设 ${entry.label}`, `Hide preset ${entry.label}`),
                      onClick: () => saveHiddenPresets([...hiddenPresets, entry.label]),
                    }, t('删除', 'Delete')),
                );
              })),
              h('div', { className: 'kvmflow-row', style: { justifyContent: 'space-between' } },
                h('span', { className: 'kvmflow-wf-list-title' }, t('自定义快捷键', 'Custom shortcuts'), h('span', { className: 'kvmflow-hint' }, ` ${customShortcuts.length}`)),
                customShortcuts.length === 0 ? null : h(ConfirmButton, {
                  small: true,
                  kind: 'danger',
                  confirmTitle: t('清空自定义快捷键', 'Clear custom shortcuts'),
                  confirmLabel: t(`确定要删除全部 ${customShortcuts.length} 个自定义快捷键吗？`, `Delete all ${customShortcuts.length} custom shortcuts?`),
                  confirmAction: t('清空', 'Clear'),
                  cancelLabel: t('取消', 'Cancel'),
                  onConfirm: () => saveCustomShortcuts([]),
                }, t('清空', 'Clear')),
              ),
              customShortcuts.length === 0
                ? h('div', { className: 'kvmflow-hint' }, t('还没有自定义快捷键。按下按键即可添加。', 'No custom shortcuts yet. Press a chord to add one.'))
                : h('div', { className: 'kvmflow-col' }, customShortcuts.map(entry => h('div', { key: entry.label, className: 'kvmflow-custom-row' },
                  h('span', { className: 'kvmflow-mono' }, `${entry.label}  ·  ${formatShortcutKeys(entry.keys)}`),
                  h(Btn, {
                    kind: 'danger',
                    small: true,
                    'aria-label': t(`删除自定义 ${entry.label}`, `Delete custom ${entry.label}`),
                    onClick: () => saveCustomShortcuts(customShortcuts.filter(other => other.label !== entry.label)),
                  }, t('删除', 'Delete')),
                ))),
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
            `请使用 KVMFlow 工具把录制 ${recordingId} 转换成一份可执行的图工作流。`,
            '先调用 kvmflow_flow_catalog 了解节点类型，再调用 kvmflow_record_get 查看事件序列、人工步骤边界和截图（必要时读取截图）。',
            '用 kvmflow_workflow_generate 按人工步骤生成主干：每步写明 name、description，引用录制事件的 eventRange，并补充 verify（视觉判断写具体 prompt，确定会变化的画面用 change）。',
            '然后用 kvmflow_flow_patch 补上条件分支：画面可能不同的地方用 vision_classify 或 if 分支处理，需要等待的地方用 wait_until，可能失败的步骤接 error 出口或 human 节点，所有路径最终到达 end 节点。',
            '关键节点可用 kvmflow_node_test 在目标机上先单独验证。最后告诉我工作流 id 和分支设计。',
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
                  confirmTitle: t('删除录制', 'Delete recording'),
                  confirmLabel: t(`确定要删除录制“${selected.name}”吗？`, `Delete recording "${selected.name}"?`),
                  confirmDetail: t('录制的 HID 事件流、人工步骤以及所有截图都会永久删除。', 'All recorded HID events, steps, and screenshots will be permanently deleted.'),
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
        const selectedId: string = draft.id !== '' && workflows.some((entry: any) => entry.id === draft.id) ? draft.id : (workflows[0]?.id ?? '');
        const setSelectedId = useCallback((id: string) => setDraft((current: any) => ({ ...current, id })), [setDraft]);
        const [filter, setFilter] = useState('');
        const [dirty, setDirty] = useState(false);
        const [listOpen, setListOpen] = useState(true);
        const [pendingSwitchId, setPendingSwitchId] = useState('');
        const [composeOpen, setComposeOpen] = useState(false);
        const [composeName, setComposeName] = useState('');
        const [composeMode, setComposeMode] = useState('subflow');
        const [composeItems, setComposeItems] = useState([]);
        const importInputRef = useRef(null);
        const importYamlFile = async (file: File | undefined): Promise<void> => {
          if (file === undefined) return;
          let text = '';
          try {
            text = await file.text();
          } catch (error: any) {
            notify(error?.message ?? t('无法读取所选文件。', 'Could not read the selected file.'), 'err');
            return;
          }
          if (text.trim() === '') {
            notify(t('所选 YAML 文件为空。', 'The selected YAML file is empty.'), 'warn');
            return;
          }
          const value = await runRpc(t('导入工作流', 'Import workflow'), 'flow.save', { yaml: text });
          if (value !== undefined) {
            setDirty(false);
            await refresh();
            setSelectedId(value.document.id);
            notify(t(`已导入工作流“${value.document.name}”。`, `Imported workflow "${value.document.name}".`), 'ok');
          }
        };
        const select = (id: string): void => {
          if (id === selectedId) return;
          if (dirty) {
            setPendingSwitchId(id);
            return;
          }
          setSelectedId(id);
        };
        const validWorkflows = workflows.filter((entry: any) => !entry.error);
        const openCompose = (): void => {
          setComposeName(t('组合工作流', 'Composed workflow'));
          setComposeMode('subflow');
          setComposeItems(selectedId !== '' && validWorkflows.some((w: any) => w.id === selectedId)
            ? [{ key: `${Date.now()}-0`, workflowId: selectedId, onFailure: 'pause' }]
            : []);
          setComposeOpen(true);
        };
        const addComposeItem = (workflowId: string): void => {
          setComposeItems((list: any[]) => [...list, { key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, workflowId, onFailure: 'pause' }]);
        };
        const moveComposeItem = (index: number, delta: number): void => {
          setComposeItems((list: any[]) => {
            const target = index + delta;
            if (target < 0 || target >= list.length) return list;
            const next = [...list];
            const [moved] = next.splice(index, 1);
            next.splice(target, 0, moved);
            return next;
          });
        };
        const submitCompose = async (): Promise<void> => {
          if (composeItems.length === 0) return;
          const value = await runRpc(t('组合工作流', 'Compose workflows'), 'flow.compose', {
            name: composeName.trim() || t('组合工作流', 'Composed workflow'),
            deviceId: shared.deviceId || undefined,
            mode: composeMode,
            items: composeItems.map((item: any) => ({ workflowId: item.workflowId, onFailure: item.onFailure })),
          });
          if (value !== undefined) {
            setComposeOpen(false);
            setDirty(false);
            await refresh();
            setSelectedId(value.document.id);
            notify(
              composeMode === 'subflow'
                ? t('已生成引用编排大工作流。', 'Composed workflow created (subflow chain).')
                : t('已展平合并为独立大工作流。', 'Workflows merged into one standalone graph.'),
              'ok',
            );
          }
        };
        const create = async (): Promise<void> => {
          const value = await runRpc(t('新建工作流', 'Create workflow'), 'workflow.create', { name: t('新工作流', 'New workflow'), deviceId: shared.deviceId || undefined });
          if (value !== undefined) {
            await refresh();
            setSelectedId(value.document.id);
            notify(t('已创建工作流：先判断画面，再在画布上接着搭建。', 'Workflow created: it checks the screen first; build on from there.'), 'ok');
          }
        };
        const remove = async (id: string): Promise<void> => {
          const value = await runRpc(t('删除工作流', 'Delete workflow'), 'workflow.delete', { id });
          if (value !== undefined) {
            notify(t('工作流已删除。', 'Workflow removed.'), 'ok');
            if (id === selectedId) setSelectedId('');
            await refresh();
          }
        };
        const activeRun = state.activeRun ?? undefined;
        const runDisabledReason = shared.deviceId === ''
          ? t('先选择 KVM 设备', 'Select a KVM device first')
          : activeRun !== undefined && activeRun !== null
            ? t('已有执行进行中', 'A run is already active')
            : undefined;
        const onRun = async (inputs: Record<string, unknown>): Promise<void> => {
          const value = await runRpc(t('启动执行', 'Start run'), 'run.start', { workflowId: selectedId, deviceId: shared.deviceId, inputs });
          if (value !== undefined) {
            notify(
              value.run.status === 'armed'
                ? t('已就绪：现在按下目标机电源键。', 'Armed: press the target power button now.')
                : t('执行已启动。', 'Run started.'),
              'ok',
              { label: t('查看执行', 'Supervise run'), onClick: () => setTab('runs') },
            );
            await refresh();
          }
        };
        const askAi = async (doc: any): Promise<void> => {
          const prompt = [
            `请编辑 KVMFlow 工作流 ${doc.id}（当前名称：${doc.name}）。`,
            '先调用 kvmflow_flow_catalog 了解节点类型，再用 kvmflow_workflow_get 读取当前图和问题列表。',
            '用 kvmflow_flow_patch 做小步修改（add_node / update_node / connect / remove_node），不要整篇重写；画面不确定的地方用 vision_classify 或 if 分支，等待用 wait_until，失败要有 error 出口或 human 节点，所有路径都要到达 end。',
            '必要时用 kvmflow_node_test 在目标机上单独验证关键节点。完成后总结你改了哪些节点和连线。',
            '',
            '我的修改目标：',
          ].join('\n');
          await shared.handPrompt(
            prompt,
            t('已在新会话中启动 AI 编辑。', 'Started a new session for AI editing.'),
            t('无法自动创建会话，提示词已显示在下方，请手动复制。', 'Could not open a session automatically; copy the prompt shown below.'),
          );
        };
        const needle = filter.trim().toLowerCase();
        const visible = workflows.filter((entry: any) => needle === '' || `${entry.name} ${entry.id} ${entry.description ?? ''}`.toLowerCase().includes(needle));
        const Editor = flowUi.FlowEditor;
        return h('div', { className: cn('kvmflow-wf', listOpen ? '' : 'collapsed') },
          h('aside', { className: 'kvmflow-wf-list', 'aria-label': t('工作流列表', 'Workflows') },
            h('div', { className: 'kvmflow-wf-list-head' },
              h('span', { className: 'kvmflow-wf-list-title' }, t('工作流', 'Workflows'), h('span', { className: 'kvmflow-hint' }, ` ${workflows.length}`)),
              h('button', { type: 'button', className: 'kvmflow-icon-btn', onClick: () => setListOpen(false), title: t('收起列表', 'Collapse the list'), 'aria-label': t('收起列表', 'Collapse the list') }, '‹'),
            ),
            h('div', { className: 'kvmflow-actions' },
              h(Btn, { kind: 'primary', small: true, onClick: () => { void create(); }, disabled: busy !== '' }, t('+ 新建', '+ New')),
              h(Btn, { small: true, onClick: () => importInputRef.current?.click(), disabled: busy !== '', title: t('从本地选择 YAML 文件导入工作流', 'Import a workflow from a local YAML file') }, t('导入', 'Import')),
              validWorkflows.length >= 1 ? h(Btn, { small: true, onClick: openCompose, disabled: busy !== '', title: t('将多个工作流按顺序组合成一个大工作流', 'Combine multiple workflows in order into one') }, t('组合', 'Compose')) : null,
              h('input', {
                ref: importInputRef,
                type: 'file',
                accept: '.yaml,.yml,text/yaml,text/plain',
                style: { display: 'none' },
                'aria-label': t('选择要导入的 YAML 文件', 'Choose a YAML file to import'),
                onChange: (event: any) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  void importYamlFile(file);
                },
              }),
            ),
            workflows.length > 4 ? h('input', { className: 'kvmflow-input', placeholder: t('搜索…', 'Search…'), value: filter, onChange: (event: any) => setFilter(event.target.value) }) : null,
            workflows.length === 0
              ? h('div', { className: 'kvmflow-wf-empty' },
                h('p', null, t('还没有工作流。', 'No workflows yet.')),
                h('p', { className: 'kvmflow-hint' }, t('新建一个空白工作流在画布上搭建，或者先在“录制器”录一遍操作，让 AI 生成。', 'Create one and build it on the canvas, or record a run-through in the Recorder and let the agent generate it.')),
                h(Btn, { onClick: () => setTab('recorder') }, t('去录制', 'Go to Recorder')),
              )
              : h('div', { className: 'kvmflow-wf-items' }, visible.map((entry: any) => h('div', {
                key: entry.id,
                role: 'button',
                tabIndex: 0,
                className: cn('kvmflow-wf-item', entry.id === selectedId ? 'selected' : '', entry.error ? 'invalid' : ''),
                onClick: () => select(entry.id),
                onKeyDown: (event: any) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(entry.id); } },
              },
                h('div', { className: 'kvmflow-wf-item-name' },
                  activeRun?.workflowId === entry.id ? h('span', { className: 'kvmflow-dot on', title: t('执行中', 'running') }) : null,
                  h('span', null, entry.name),
                ),
                entry.error
                  ? h('div', { className: 'kvmflow-wf-item-meta err' }, entry.error)
                  : h('div', { className: 'kvmflow-wf-item-meta' },
                    t(`${entry.stepCount} 个节点`, `${entry.stepCount} nodes`),
                    (entry.branchCount ?? 0) > 0 ? ` · ${t(`${entry.branchCount} 个分支`, `${entry.branchCount} branches`)}` : '',
                    entry.hasBios ? ' · BIOS' : '',
                    (entry.issueCount ?? 0) > 0 ? h('span', { className: 'kvmflow-wf-issues' }, ` · ${t(`${entry.issueCount} 个问题`, `${entry.issueCount} issues`)}`) : null,
                  ),
                h('div', { className: 'kvmflow-wf-item-foot' },
                  h('span', { className: 'kvmflow-hint' }, formatDateTime(entry.updatedAt)),
                  entry.id === selectedId ? h(ConfirmButton, {
                    kind: 'danger',
                    small: true,
                    disabled: busy !== '',
                    confirmTitle: t('删除工作流', 'Delete workflow'),
                    confirmLabel: t(`确定要删除工作流“${entry.name}”吗？`, `Delete workflow "${entry.name}"?`),
                    confirmDetail: t('该工作流的 YAML、画布布局及参考图资产将被永久删除。', 'Its YAML, canvas layout, and reference assets will be permanently deleted.'),
                    confirmAction: t('删除', 'Delete'),
                    cancelLabel: t('取消', 'Cancel'),
                    onConfirm: () => { void remove(entry.id); },
                  }, t('删除', 'Delete')) : null,
                ),
              ))),
          ),
          h('section', { className: 'kvmflow-wf-main' },
            listOpen ? null : h('button', { type: 'button', className: 'kvmflow-wf-reopen', onClick: () => setListOpen(true), 'aria-label': t('展开工作流列表', 'Show the workflow list') }, `› ${t('工作流', 'Workflows')}`),
            selectedId === ''
              ? h(Empty, null, t('从左侧选择或新建工作流。', 'Select or create a workflow on the left.'))
              : h(Editor, {
                key: selectedId,
                rpc,
                t,
                workflowId: selectedId,
                workflows: workflows.filter((entry: any) => !entry.error).map((entry: any) => ({ id: entry.id, name: entry.name })),
                deviceId: shared.deviceId,
                run: activeRun?.workflowId === selectedId ? activeRun : undefined,
                compact: shared.compact === true,
                runDisabledReason,
                notify,
                onRun,
                onAskAi: (doc: any) => { void askAi(doc); },
                onDelete: () => { void remove(selectedId); },
                onSaved: () => { void refresh(); },
                onDirtyChange: setDirty,
                renderThumb: (path: string | undefined, label: string) => h(ImageThumb, { key: `${path}-${label}`, shared, path, label }),
              }),
          ),
          h(Modal, {
            open: pendingSwitchId !== '',
            title: t('放弃未保存的修改？', 'Discard unsaved edits?'),
            onClose: () => setPendingSwitchId(''),
            footer: h(React.Fragment, null,
              h(Btn, { onClick: () => setPendingSwitchId('') }, t('继续编辑', 'Keep editing')),
              h(Btn, {
                kind: 'danger',
                onClick: () => {
                  const target = pendingSwitchId;
                  setPendingSwitchId('');
                  setDirty(false);
                  setSelectedId(target);
                },
              }, t('放弃并切换', 'Discard & switch')),
            ),
          },
            h('p', { className: 'kvmflow-modal-msg' }, t('当前工作流还有未保存的修改（可能存在错误未能自动保存），切换将会丢失这些更改。', 'The current workflow has unsaved changes (possibly blocked by errors). Switching will discard them.')),
          ),
          h(Modal, {
            open: composeOpen,
            wide: true,
            title: t('组合多个工作流', 'Compose workflows'),
            subtitle: t('自由搭配多个工作流的顺序，合并生成一个新的大工作流。', 'Pick workflows in any order and combine them into one new workflow.'),
            onClose: () => setComposeOpen(false),
            footer: h(React.Fragment, null,
              h('span', { className: 'kvmflow-hint', style: { marginRight: 'auto' } },
                t(`已编排 ${composeItems.length} 个环节`, `${composeItems.length} stage${composeItems.length === 1 ? '' : 's'} selected`),
              ),
              h(Btn, { onClick: () => setComposeOpen(false) }, t('取消', 'Cancel')),
              h(Btn, { kind: 'primary', disabled: busy !== '' || composeItems.length === 0, onClick: () => { void submitCompose(); } }, t('生成大工作流', 'Create composed workflow')),
            ),
          },
            h(Field, { label: t('新工作流名称', 'New workflow name') },
              h('input', { className: 'kvmflow-input', value: composeName, placeholder: t('例如：装机全流程（BIOS → OOBE → 打印机）', 'e.g. Full setup (BIOS -> OOBE -> Printer)'), onChange: (event: any) => setComposeName(event.target.value) }),
            ),
            h('div', { className: 'kvmflow-compose-modes', role: 'radiogroup', 'aria-label': t('组合模式', 'Compose mode') },
              h('button', {
                type: 'button',
                role: 'radio',
                'aria-checked': composeMode === 'subflow',
                className: cn('kvmflow-compose-mode', composeMode === 'subflow' ? 'on' : ''),
                onClick: () => setComposeMode('subflow'),
              },
                h('span', { className: 'kvmflow-compose-mode-title' }, t('引用编排（Subflow）', 'Subflow chain')),
                h('span', { className: 'kvmflow-hint' }, t('每个工作流占一个节点，画布清爽；原工作流改动后自动同步。', 'One subflow node per stage; compact canvas, stays synced with child edits.')),
              ),
              h('button', {
                type: 'button',
                role: 'radio',
                'aria-checked': composeMode === 'inline',
                className: cn('kvmflow-compose-mode', composeMode === 'inline' ? 'on' : ''),
                onClick: () => setComposeMode('inline'),
              },
                h('span', { className: 'kvmflow-compose-mode-title' }, t('展平合并（独立大图）', 'Inline merge')),
                h('span', { className: 'kvmflow-hint' }, t('把所有节点合进同一张画布，互相独立，可自由跨段增删分支。', 'Flattens every node into one standalone graph you can freely rewire.')),
              ),
            ),
            h('div', { className: 'kvmflow-compose-grid' },
              h('div', { className: 'kvmflow-compose-col' },
                h('div', { className: 'kvmflow-compose-col-head' },
                  h('span', null, t('可选工作流', 'Available workflows')),
                  h('span', null, String(validWorkflows.length)),
                ),
                validWorkflows.length === 0
                  ? h('div', { className: 'kvmflow-hint' }, t('没有可用的工作流。', 'No valid workflows available.'))
                  : validWorkflows.map((wf: any) => h('div', { key: wf.id, className: 'kvmflow-compose-item' },
                    h('div', { className: 'kvmflow-compose-item-info' },
                      h('div', { className: 'kvmflow-compose-item-name' }, wf.name),
                      h('div', { className: 'kvmflow-hint' }, t(`${wf.stepCount} 个节点`, `${wf.stepCount} nodes`)),
                    ),
                    h(Btn, { small: true, onClick: () => addComposeItem(wf.id) }, t('+ 加入', '+ Add')),
                  )),
              ),
              h('div', { className: 'kvmflow-compose-col' },
                h('div', { className: 'kvmflow-compose-col-head' },
                  h('span', null, t('执行顺序（可重复加入）', 'Execution order (repeats allowed)')),
                  composeItems.length > 0 ? h('button', { type: 'button', className: 'kf-link', onClick: () => setComposeItems([]) }, t('清空', 'Clear')) : null,
                ),
                composeItems.length === 0
                  ? h('div', { className: 'kvmflow-hint', style: { padding: '16px 4px', textAlign: 'center' } }, t('点击左侧“+ 加入”按顺序编排。', 'Click "+ Add" on the left to build the sequence.'))
                  : composeItems.map((item: any, index: number) => {
                    const wf = validWorkflows.find((entry: any) => entry.id === item.workflowId);
                    return h('div', { key: item.key, className: 'kvmflow-compose-item kvmflow-compose-selected' },
                      h('div', { className: 'kvmflow-compose-selected-top' },
                        h('span', { className: 'kvmflow-compose-index' }, String(index + 1)),
                        h('div', { className: 'kvmflow-compose-item-info' },
                          h('div', { className: 'kvmflow-compose-item-name' }, wf?.name ?? item.workflowId),
                        ),
                        h(Btn, { small: true, disabled: index === 0, onClick: () => moveComposeItem(index, -1), title: t('上移', 'Move up') }, '↑'),
                        h(Btn, { small: true, disabled: index === composeItems.length - 1, onClick: () => moveComposeItem(index, 1), title: t('下移', 'Move down') }, '↓'),
                        h(Btn, { small: true, kind: 'danger', onClick: () => setComposeItems((list: any[]) => list.filter((_: any, i: number) => i !== index)), title: t('移除', 'Remove') }, '×'),
                      ),
                      h('div', { className: 'kvmflow-row', style: { justifyContent: 'space-between' } },
                        h('span', { className: 'kvmflow-hint' }, t('该段失败时：', 'On stage failure:')),
                        h('select', {
                          className: 'kvmflow-select kvmflow-inline-select',
                          style: { height: '24px', fontSize: '11px' },
                          value: item.onFailure,
                          onChange: (event: any) => setComposeItems((list: any[]) => list.map((entry: any, i: number) => (i === index ? { ...entry, onFailure: event.target.value } : entry))),
                        },
                          h('option', { value: 'pause' }, t('暂停等待人工', 'Pause for operator')),
                          h('option', { value: 'continue' }, t('忽略并进入下一段', 'Continue to next stage')),
                          h('option', { value: 'abort' }, t('中止整个流程', 'Abort the whole run')),
                        ),
                      ),
                    );
                  }),
              ),
            ),
          ),
        );
      }

      const CONTROL_LABELS: Record<string, [string, string]> = {
        resume: ['继续', 'Resume'],
        retry: ['重试此节点', 'Retry node'],
        skip: ['跳过（走主路径）', 'Skip (main path)'],
        continue: ['跳过（走主路径）', 'Skip (main path)'],
        finish: ['在此结束', 'Finish here'],
        abort: ['中止执行', 'Abort'],
        confirm_bios: ['确认已进入 BIOS', 'Confirm BIOS'],
        pause: ['暂停', 'Pause'],
      };

      function RunsTab(shared: any): any {
        const { state, runRpc, rpc, refresh, busy, t } = shared;
        const [run, setRun] = useState(state.activeRun ?? undefined);
        const [selectedRunId, setSelectedRunId] = useState('');
        const [pollError, setPollError] = useState('');
        const [focusNode, setFocusNode] = useState(undefined);
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
          const timer = setInterval(() => { void refreshRun(); }, 1200);
          return () => clearInterval(timer);
        }, [refreshRun, terminal]);
        const control = async (action: string, extra: any = {}): Promise<void> => {
          if (run === undefined) return;
          const value = await runRpc(t('执行控制', 'Run control'), 'run.control', { id: run.id, action, ...extra });
          if (value !== undefined) {
            setRun(value.run);
            await refresh();
          }
        };
        const deleteHistoryRun = async (id: string): Promise<void> => {
          const value = await runRpc(t('清理执行记录', 'Delete run'), 'run.delete', { id });
          if (value !== undefined) {
            if (selectedRunId === id) setSelectedRunId('');
            if (run?.id === id) { setRun(undefined); setFocusNode(undefined); }
            shared.notify(t('已清理该执行记录与截图。', 'Run record and screenshots removed.'), 'ok');
            await refresh();
          }
        };
        const clearHistoryRuns = async (): Promise<void> => {
          const value = await runRpc(t('清空历史执行', 'Clear run history'), 'run.clear');
          if (value !== undefined) {
            if (state.activeRun === undefined || state.activeRun === null) {
              setSelectedRunId('');
              setRun(undefined);
              setFocusNode(undefined);
            }
            shared.notify(t(`已清理 ${value.removed ?? 0} 条历史执行记录。`, `Removed ${value.removed ?? 0} run record(s).`), 'ok');
            await refresh();
          }
        };
        const current = run ?? state.activeRun;
        const awaiting = current?.awaiting;
        const actions: string[] = (awaiting?.actions ?? []).filter((action: string) => action !== 'route');
        const live = current !== undefined && !['succeeded', 'failed', 'aborted'].includes(current.status);
        const canPause = live && (current.status === 'running' || current.status === 'armed') && awaiting === undefined;
        const trace: any[] = current?.trace ?? [];
        const graphRun = current?.schema === 2;
        const nodeName = (id: string): string => (current?.steps ?? []).find((step: any) => step.id === id)?.name ?? id;
        const focusTrace = focusNode === undefined ? undefined : [...trace].reverse().find((entry: any) => entry.nodeId === focusNode);
        const RunGraph = flowUi.RunGraph;
        const portName = (port: string): string => ({ next: t('下一步', 'next'), error: t('出错', 'error'), true: t('是', 'true'), false: t('否', 'false'), ok: t('满足', 'ok'), timeout: t('超时', 'timeout'), body: t('循环体', 'body'), done: t('结束循环', 'done'), found: t('找到', 'found'), not_found: t('未找到', 'not found'), unknown: t('无法识别', 'unknown'), default: t('其他', 'default'), success: t('成功', 'success'), failure: t('失败', 'failure') } as Record<string, string>)[port] ?? port;
        return h('div', { className: 'kvmflow-grid two' },
          h('div', null,
            h(Card, {
              title: current === undefined ? t('执行状态', 'Run status') : current.workflowName,
              subtitle: current === undefined ? t('暂无执行', 'none') : `${current.id} · ${formatDateTime(current.createdAt)}`,
            },
              h(CardActions, null,
                current === undefined ? null : h(Pill, { tone: statusTone(current.status) }, statusLabel(t, current.status)),
                current === undefined ? null : h('span', { className: 'kvmflow-hint' }, current.phase),
                h('span', { style: { flex: '1 1 auto' } }),
                canPause ? h(Btn, { onClick: () => { void control('pause'); }, disabled: busy !== '' }, t('暂停', 'Pause')) : null,
                live ? h(Btn, { kind: 'danger', onClick: () => { void control('abort'); }, disabled: busy !== '' }, t('中止', 'Abort')) : null,
              ),
              pollError === '' ? null : h('div', { className: 'kvmflow-notice err' }, pollError),
              current === undefined
                ? h(Empty, null, t('还没有执行记录。在“工作流”页打开一个工作流并点击“执行”。', 'No runs yet. Open a workflow on the Workflows tab and press Run.'))
                : h('div', { className: 'kvmflow-col' },
                  current.status === 'armed' ? h('div', { className: 'kvmflow-awaiting' },
                    h('div', { className: 'kvmflow-awaiting-title' }, t('现在按下目标机电源键', 'Press the target power button now')),
                    h('div', { className: 'kvmflow-hint' }, t(`正在每 ${current.bios?.intervalMs ?? 1200}ms 按一次 ${current.bios?.hotkey ?? 'F2'}，检测到画面后自动开始。`, `Tapping ${current.bios?.hotkey ?? 'F2'} every ${current.bios?.intervalMs ?? 1200}ms; the graph starts once video appears.`)),
                  ) : null,
                  awaiting ? h('div', { className: cn('kvmflow-awaiting', awaiting.kind === 'human' ? 'human' : 'attention') },
                    h('div', { className: 'kvmflow-awaiting-title' },
                      awaiting.kind === 'human' ? t('需要你选择下一步', 'Your decision is needed')
                        : awaiting.kind === 'unrouted' ? t('流程走到了未连接的出口', 'The run reached an unconnected port')
                          : awaiting.kind === 'bios_confirm' ? t('请确认已进入 BIOS', 'Confirm the target is in BIOS')
                            : t('需要人工介入', 'Intervention needed'),
                      awaiting.nodeId ? h('span', { className: 'kvmflow-hint' }, ` · ${nodeName(awaiting.nodeId)}`) : null,
                    ),
                    h('div', { className: 'kvmflow-awaiting-msg' }, awaiting.message),
                    (awaiting.options ?? []).length === 0 ? null : h('div', { className: 'kvmflow-actions' },
                      (awaiting.options ?? []).map((option: any) => h(Btn, { key: option.name, kind: 'primary', onClick: () => { void control('choose', { option: option.name }); }, disabled: busy !== '' }, option.label ?? option.name)),
                    ),
                    (awaiting.routes ?? []).length === 0 ? null : h('div', { className: 'kvmflow-actions' },
                      h('span', { className: 'kvmflow-hint' }, t('改走：', 'Route via:')),
                      (awaiting.routes ?? []).map((port: string) => h(Btn, { key: port, onClick: () => { void control('route', { port }); }, disabled: busy !== '' }, portName(port))),
                    ),
                    h('div', { className: 'kvmflow-actions' }, actions.map(action => h(Btn, {
                      key: action,
                      kind: action === 'abort' ? 'danger' : action === 'confirm_bios' || action === 'retry' || action === 'resume' ? 'primary' : undefined,
                      onClick: () => { void control(action); },
                      disabled: busy !== '',
                    }, t(...(CONTROL_LABELS[action] ?? [action, action]) as [string, string])))),
                  ) : null,
                  !awaiting && current.reason && current.status !== 'succeeded' ? h('div', { className: 'kvmflow-notice err', style: { marginBottom: 0 } }, current.reason) : null,
                  current.status === 'succeeded' && current.outputs !== undefined ? h('div', { className: 'kvmflow-notice ok', style: { marginBottom: 0 } }, `${t('输出', 'Outputs')}: ${JSON.stringify(current.outputs)}`) : null,
                  graphRun ? h(RunGraph, {
                    rpc,
                    t,
                    workflowId: current.workflowId,
                    run: current,
                    height: shared.compact ? 300 : 380,
                    ...(focusNode === undefined ? {} : { selectedNodeId: focusNode }),
                    onSelectNode: (id: string | undefined) => setFocusNode(id),
                  }) : null,
                  graphRun ? h('div', { className: 'kvmflow-run-stats' },
                    h('span', null, t(`节点访问 ${current.visits ?? 0}`, `${current.visits ?? 0} node visits`)),
                    h('span', null, t(`视觉调用 ${current.visionCalls ?? 0}`, `${current.visionCalls ?? 0} vision calls`)),
                    Object.keys(current.vars ?? {}).length === 0 ? null : h('span', { className: 'kvmflow-mono', title: JSON.stringify(current.vars, null, 2) }, `vars ${JSON.stringify(current.vars).slice(0, 80)}`),
                  ) : null,
                  focusTrace !== undefined ? h('div', { className: 'kvmflow-trace-focus' },
                    h('div', { className: 'kvmflow-step-head' },
                      h('div', { className: 'kvmflow-step-name' }, nodeName(focusTrace.nodeId)),
                      h(Btn, { small: true, onClick: () => setFocusNode(undefined) }, t('关闭', 'Close')),
                    ),
                    focusTrace.reason ? h('div', { className: 'kvmflow-muted' }, focusTrace.reason) : null,
                    focusTrace.output === undefined ? null : h('pre', { className: 'kvmflow-pre' }, JSON.stringify(focusTrace.output, null, 2)),
                    h('div', { className: 'kvmflow-thumb-row' },
                      focusTrace.before ? h(ImageThumb, { shared, path: focusTrace.before, label: t('操作前', 'before') }) : null,
                      focusTrace.after ? h(ImageThumb, { shared, path: focusTrace.after, label: t('画面', 'screen') }) : null,
                    ),
                  ) : null,
                  graphRun ? h('div', null,
                    h('div', { className: 'kvmflow-section-title' }, t(`执行轨迹（${trace.length}）`, `Trace (${trace.length})`)),
                    trace.length === 0
                      ? h('div', { className: 'kvmflow-hint' }, live ? t('等待第一个节点…', 'Waiting for the first node…') : '—')
                      : h('ol', { className: 'kvmflow-trace' }, [...trace].reverse().slice(0, 120).map((entry: any) => h('li', {
                        key: entry.seq,
                        className: cn('kvmflow-trace-row', entry.status, entry.nodeId === focusNode ? 'focus' : ''),
                        style: entry.depth > 0 ? { paddingLeft: `${8 + entry.depth * 14}px` } : undefined,
                        onClick: () => setFocusNode(entry.nodeId),
                      },
                        h('span', { className: 'kvmflow-trace-seq' }, `#${entry.seq}`),
                        h('span', { className: 'kvmflow-trace-node' }, entry.depth > 0 ? `↳ ${entry.nodeId}` : nodeName(entry.nodeId)),
                        entry.port ? h('span', { className: cn('kvmflow-trace-port', entry.port === 'error' ? 'err' : '') }, `→ ${portName(entry.port)}`) : h('span', { className: 'kvmflow-trace-port' }, t('结束', 'end')),
                        h('span', { className: 'kvmflow-trace-reason', title: entry.reason }, entry.reason ?? ''),
                        h('span', { className: 'kvmflow-trace-time' }, `${formatTime(entry.at)} · ${entry.durationMs}ms`),
                      ))),
                  ) : h('div', { className: 'kvmflow-steps' }, (current.steps ?? []).map((step: any) => h('div', { key: step.id, className: cn('kvmflow-step', step.status) },
                    h('div', { className: 'kvmflow-step-head' },
                      h('div', { className: 'kvmflow-step-name' }, `${step.index + 1}. ${step.name}`),
                      h(StepStatus, { status: step.status, t }),
                    ),
                    step.verify ? h('div', { className: 'kvmflow-step-body' }, h('div', { className: 'kvmflow-muted' }, `${step.verify.mode}: ${step.verify.reason}`)) : null,
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
                : h('div', { className: 'kvmflow-log' }, (current.log ?? []).slice(-80).reverse().map((entry: any, index: number) => h('div', { key: index, className: cn('kvmflow-log-row', entry.level === 'error' ? 'err' : entry.level === 'warn' ? 'warn' : '') },
                  h('span', { className: 'kvmflow-log-time' }, formatTime(entry.at)),
                  h('span', null, entry.message),
                ))),
            ),
            h(Card, {
              title: t('历史执行', 'Recent runs'),
              subtitle: `${state.recentRuns?.length ?? 0}`,
              actions: (state.recentRuns ?? []).some((entry: any) => entry.id !== state.activeRun?.id) ? [
                h(ConfirmButton, {
                  small: true,
                  kind: 'danger',
                  disabled: busy !== '',
                  confirmTitle: t('清空历史执行', 'Clear run history'),
                  confirmLabel: t('确定要清理所有已结束的历史执行记录和截图吗？', 'Remove all finished run records and screenshots?'),
                  confirmDetail: state.activeRun ? t('当前正在运行的执行不会被删除。', 'The currently active run will be kept.') : undefined,
                  confirmAction: t('清空', 'Clear'),
                  cancelLabel: t('取消', 'Cancel'),
                  onConfirm: () => { void clearHistoryRuns(); },
                }, t('清空', 'Clear')),
              ] : undefined,
            },
              (state.recentRuns ?? []).length === 0
                ? h('div', { className: 'kvmflow-hint' }, t('暂无历史。', 'No history.'))
                : h('div', { className: 'kvmflow-col' }, (state.recentRuns ?? []).map((entry: any) => {
                  const isActive = entry.id === state.activeRun?.id;
                  return h('div', {
                    key: entry.id,
                    role: 'button',
                    tabIndex: 0,
                    className: cn('kvmflow-device', 'kvmflow-run-item', entry.id === current?.id ? 'selected' : ''),
                    style: { cursor: 'pointer' },
                    onClick: () => { setSelectedRunId(entry.id); setFocusNode(undefined); void rpc('run.get', { id: entry.id }).then((value: any) => { if (value.run !== null) setRun(value.run); }); },
                  },
                    h('div', null,
                      h('div', { className: 'kvmflow-device-name' }, entry.workflowName),
                      h('div', { className: 'kvmflow-hint' }, `${formatDateTime(entry.createdAt)}${entry.reason ? ` · ${entry.reason}` : ''}`),
                    ),
                    h('div', { className: 'kvmflow-actions' },
                      h(Pill, { tone: statusTone(entry.status) }, statusLabel(t, entry.status)),
                      isActive ? null : h(ConfirmButton, {
                        small: true,
                        kind: 'danger',
                        disabled: busy !== '',
                        confirmTitle: t('清理执行记录', 'Delete run record'),
                        confirmLabel: t(`确定要清理“${entry.workflowName}”的这次执行记录吗？`, `Delete this run of "${entry.workflowName}"?`),
                        confirmDetail: t('该次执行的日志、轨迹与截图都会从磁盘移除。', 'Its log, trace, and screenshots will be removed from disk.'),
                        confirmAction: t('清理', 'Delete'),
                        cancelLabel: t('取消', 'Cancel'),
                        onConfirm: () => { void deleteHistoryRun(entry.id); },
                      }, t('清理', 'Delete')),
                    ),
                  );
                })),
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
          description: (): string => tr('录制、编排和执行 IP-KVM 工作流', 'Record, author and run IP-KVM workflows'),
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
}
