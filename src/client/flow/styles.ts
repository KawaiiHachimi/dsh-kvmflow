/** Editor styles; colours come from DSH theme tokens so light and dark both work. */
export const FLOW_CSS = `
.kf-editor { display: flex; flex-direction: column; gap: 8px; min-width: 0;
  --kf-flow: var(--dsw-alias-brand-primary);
  --kf-action: var(--dsw-alias-state-success-primary);
  --kf-sense: var(--dsw-alias-state-warn-primary);
  --kf-data: var(--dsw-alias-label-secondary);
  --kf-error: var(--dsw-alias-state-error-primary);
  --kf-line: var(--dsw-alias-border-l2);
  --kf-h: max(520px, calc(100vh - 250px));
}
.kf-editor .kf-cat-flow { --kf-cat: var(--kf-flow); }
.kf-editor .kf-cat-action { --kf-cat: var(--kf-action); }
.kf-editor .kf-cat-sense { --kf-cat: var(--kf-sense); }
.kf-editor .kf-cat-data { --kf-cat: var(--kf-data); }
.kf-run-graph { --kf-flow: var(--dsw-alias-brand-primary); --kf-action: var(--dsw-alias-state-success-primary); --kf-sense: var(--dsw-alias-state-warn-primary); --kf-data: var(--dsw-alias-label-secondary); --kf-error: var(--dsw-alias-state-error-primary); --kf-line: var(--dsw-alias-border-l2); }
.kf-run-graph .kf-cat-flow { --kf-cat: var(--kf-flow); }
.kf-run-graph .kf-cat-action { --kf-cat: var(--kf-action); }
.kf-run-graph .kf-cat-sense { --kf-cat: var(--kf-sense); }
.kf-run-graph .kf-cat-data { --kf-cat: var(--kf-data); }

.kf-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.kf-toolbar-title { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 240px; }
.kf-doc-name { font-weight: 650; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kf-toolbar-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.kf-save { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.kf-save::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; background: var(--dsw-alias-state-success-primary); }
.kf-save-dirty::before, .kf-save-saving::before { background: var(--dsw-alias-state-warn-primary); }
.kf-save-invalid, .kf-save-error { color: var(--kf-error); }
.kf-save-invalid::before, .kf-save-error::before { background: var(--kf-error); }
.kf-chip { font-size: 11px; border-radius: 999px; padding: 1px 8px; border: 1px solid var(--dsw-alias-border-l1); white-space: nowrap; }
.kf-chip.err { color: var(--kf-error); border-color: color-mix(in srgb, var(--kf-error) 45%, transparent); }
.kf-chip.warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); }
.kf-chip.run { color: var(--kf-flow); border-color: color-mix(in srgb, var(--kf-flow) 45%, transparent); max-width: 16rem; overflow: hidden; text-overflow: ellipsis; }

.kf-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 28px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 0 10px; border-radius: 7px; cursor: pointer; white-space: nowrap; line-height: 1; }
.kf-btn:disabled { opacity: 0.45; cursor: default; }
.kf-btn:focus-visible, .kf-icon-btn:focus-visible, .kf-palette-item:focus-visible, .kf-seg button:focus-visible { outline: 2px solid var(--kf-flow); outline-offset: 1px; }
@media (hover: hover) { .kf-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, var(--dsw-alias-bg-layer-2)); } }
.kf-btn-primary { background: var(--kf-flow); border-color: var(--kf-flow); color: var(--dsw-alias-bg-base); font-weight: 600; }
@media (hover: hover) { .kf-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--kf-flow) 86%, var(--dsw-alias-label-primary)); border-color: transparent; color: var(--dsw-alias-bg-base); } }
.kf-btn-danger { color: var(--kf-error); border-color: color-mix(in srgb, var(--kf-error) 45%, var(--dsw-alias-border-l1)); }
.kf-btn-ghost { background: transparent; border-style: dashed; color: var(--dsw-alias-label-secondary); }
.kf-btn[aria-pressed='true'] { color: var(--kf-flow); border-color: color-mix(in srgb, var(--kf-flow) 45%, var(--dsw-alias-border-l1)); }
.kf-icon-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 6px; width: 26px; height: 26px; flex: none; cursor: pointer; font-size: 14px; line-height: 1; }
.kf-link { appearance: none; border: 0; background: none; padding: 0; color: var(--kf-flow); font: inherit; font-size: 11px; cursor: pointer; text-decoration: underline; }
.kf-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; overflow: hidden; height: 28px; }
.kf-seg button { appearance: none; display: inline-flex; align-items: center; justify-content: center; height: 100%; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 0 10px; cursor: pointer; }
.kf-seg button.on { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }

.kf-workspace { display: grid; grid-template-columns: 172px minmax(0, 1fr) 320px; gap: 8px; height: var(--kf-h); min-height: 0; }
.kf-no-inspector .kf-workspace { grid-template-columns: 172px minmax(0, 1fr); }
.kf-palette, .kf-inspector { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: auto; min-height: 0; }
.kf-palette { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.kf-palette-search { margin-bottom: 2px; }
.kf-palette-hint { font-size: 10.5px; color: var(--dsw-alias-label-secondary); line-height: 1.35; }
.kf-palette-group { display: flex; flex-direction: column; gap: 3px; }
.kf-palette-head { font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--kf-cat); font-weight: 650; margin: 6px 2px 1px; }
.kf-palette-item { appearance: none; text-align: left; border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--kf-cat); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 5px 8px; cursor: grab; display: flex; flex-direction: column; gap: 0; font: inherit; }
.kf-palette-item:active { cursor: grabbing; }
@media (hover: hover) { .kf-palette-item:hover { border-color: color-mix(in srgb, var(--kf-cat) 55%, var(--dsw-alias-border-l1)); border-left-color: var(--kf-cat); } }
.kf-palette-name { font-size: 12px; font-weight: 600; }
.kf-palette-type { font-size: 10px; color: var(--dsw-alias-label-secondary); font-family: var(--ds-font-family-code, ui-monospace, monospace); }

.kf-stage { position: relative; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; min-height: 0; background: var(--dsw-alias-bg-base); }
.kf-stage-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 40px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; pointer-events: none; z-index: 2; }
.kf-canvas { width: 100%; height: 100%; }
.kf-run-graph { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-base); }

/* React Flow theming. */
.kf-canvas .react-flow {
  --xy-background-color: var(--dsw-alias-bg-base);
  --xy-background-pattern-color: color-mix(in srgb, var(--dsw-alias-label-secondary) 30%, transparent);
  --xy-edge-stroke: var(--kf-line);
  --xy-edge-stroke-selected: var(--kf-flow);
  --xy-connectionline-stroke: var(--kf-flow);
  --xy-attribution-background-color: transparent;
  --xy-controls-button-background-color: var(--dsw-alias-bg-layer-1);
  --xy-controls-button-background-color-hover: var(--dsw-alias-bg-layer-2);
  --xy-controls-button-color: var(--dsw-alias-label-primary);
  --xy-controls-button-border-color: var(--dsw-alias-border-l1);
  --xy-minimap-background-color: var(--dsw-alias-bg-layer-1);
  --xy-minimap-mask-background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent);
  --xy-node-boxshadow-selected: none;
  --xy-selection-background-color: color-mix(in srgb, var(--kf-flow) 10%, transparent);
  --xy-selection-border: 1px dashed var(--kf-flow);
  --xy-edge-label-background-color: var(--dsw-alias-bg-layer-1);
  --xy-edge-label-color: var(--dsw-alias-label-secondary);
  color: var(--dsw-alias-label-primary);
}
.kf-canvas .react-flow__node { padding: 0; border: 0; background: none; box-shadow: none; }
.kf-canvas .react-flow__controls { box-shadow: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; overflow: hidden; }
.kf-canvas .react-flow__minimap { border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; overflow: hidden; }
.kf-canvas .kf-mini-flow { fill: var(--kf-flow); }
.kf-canvas .kf-mini-action { fill: var(--kf-action); }
.kf-canvas .kf-mini-sense { fill: var(--kf-sense); }
.kf-canvas .kf-mini-data { fill: var(--kf-data); }

.kf-card { width: 224px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-top: 3px solid var(--kf-cat); border-radius: 9px; font-size: 12px; color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px color-mix(in srgb, #000 8%, transparent); }
.kf-card.kf-end-failure { --kf-cat: var(--kf-error); }
.kf-card.kf-selected { border-color: var(--kf-flow); border-top-color: var(--kf-cat); box-shadow: 0 0 0 2px color-mix(in srgb, var(--kf-flow) 35%, transparent); }
.kf-card.kf-has-error { border-color: color-mix(in srgb, var(--kf-error) 60%, var(--dsw-alias-border-l1)); }
.kf-card.kf-run-passed { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 7%, var(--dsw-alias-bg-layer-1)); }
.kf-card.kf-run-failed { background: color-mix(in srgb, var(--kf-error) 9%, var(--dsw-alias-bg-layer-1)); border-color: color-mix(in srgb, var(--kf-error) 60%, var(--dsw-alias-border-l1)); }
.kf-card.kf-run-running { box-shadow: 0 0 0 3px color-mix(in srgb, var(--kf-flow) 45%, transparent); animation: kf-pulse 1.4s ease-in-out infinite; }
.kf-card.kf-run-paused, .kf-card.kf-awaiting { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, transparent); }
@keyframes kf-pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--kf-flow) 15%, transparent); } }
@media (prefers-reduced-motion: reduce) { .kf-card.kf-run-running { animation: none; } }
.kf-card-head { display: flex; align-items: center; gap: 6px; padding: 7px 10px 0; }
.kf-glyph { color: var(--kf-cat); font-size: 11px; flex: none; }
.kf-card-title { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
.kf-card-type { padding: 0 10px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); display: flex; gap: 6px; justify-content: space-between; }
.kf-card-id { font-family: var(--ds-font-family-code, ui-monospace, monospace); opacity: 0.8; overflow: hidden; text-overflow: ellipsis; }
.kf-card-summary { margin: 5px 10px 0; padding: 4px 6px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.kf-card-issues { margin: 4px 10px 0; font-size: 10.5px; }
.kf-card-issues.err { color: var(--kf-error); }
.kf-card-issues.warn { color: var(--dsw-alias-state-warn-primary); }
.kf-ports { margin-top: 6px; padding: 4px 0 6px; border-top: 1px solid var(--dsw-alias-border-l1); display: flex; flex-direction: column; }
.kf-card:not(:has(.kf-ports)) { padding-bottom: 8px; }
.kf-port { position: relative; display: flex; justify-content: flex-end; align-items: center; padding: 1px 14px 1px 10px; min-height: 18px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.kf-port-on { color: var(--dsw-alias-label-primary); }
.kf-port-error { color: color-mix(in srgb, var(--kf-error) 80%, var(--dsw-alias-label-secondary)); }
.kf-port-missing .kf-port-label::after { content: ' ·'; color: var(--dsw-alias-state-warn-primary); font-weight: 700; }
.kf-badge { font-size: 9.5px; font-weight: 700; letter-spacing: 0.03em; border-radius: 4px; padding: 0 4px; line-height: 15px; flex: none; }
.kf-badge-start { background: var(--kf-flow); color: var(--dsw-alias-bg-base); }
.kf-badge-visits { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l1); }
.kf-handle { width: 9px !important; height: 9px !important; border: 2px solid var(--dsw-alias-bg-layer-1) !important; background: var(--kf-line) !important; }
.kf-handle-in { background: var(--dsw-alias-label-secondary) !important; }
.kf-port .kf-handle { right: -5px !important; }
.kf-port-on .kf-handle { background: var(--kf-cat) !important; }
.kf-handle-error { background: color-mix(in srgb, var(--kf-error) 70%, transparent) !important; }
.kf-canvas .kf-edge path.react-flow__edge-path { stroke-width: 1.6; }
.kf-canvas .kf-edge-error path.react-flow__edge-path { stroke: color-mix(in srgb, var(--kf-error) 70%, transparent); stroke-dasharray: 5 4; }
.kf-canvas .kf-edge-taken path.react-flow__edge-path { stroke: var(--kf-flow); stroke-width: 2.6; }
.kf-canvas .kf-edge-latest path.react-flow__edge-path { stroke-width: 3.2; }
.kf-canvas .kf-edge-idle { opacity: 0.45; }
.kf-canvas .kf-edge-label { font-size: 10.5px; }

.kf-inspector { padding: 10px 12px 14px; }
.kf-inspector-body { display: flex; flex-direction: column; gap: 8px; }
.kf-inspector-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
.kf-inspector-kind { font-weight: 650; font-size: 13px; }
.kf-inspector-foot { display: flex; justify-content: flex-end; padding-top: 4px; }
.kf-section { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 6px; }
.kf-section > summary { cursor: pointer; font-size: 11.5px; font-weight: 650; color: var(--dsw-alias-label-secondary); display: flex; justify-content: space-between; gap: 8px; list-style: none; padding: 2px 0; }
.kf-section > summary::-webkit-details-marker { display: none; }
.kf-section > summary::before { content: '▸'; margin-right: 4px; transition: transform 120ms; display: inline-block; }
.kf-section[open] > summary::before { transform: rotate(90deg); }
.kf-section > summary > span:first-child { flex: 1 1 auto; }
.kf-section-body { display: flex; flex-direction: column; gap: 8px; padding: 6px 0 4px; }
.kf-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.kf-field-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.kf-field-help { font-size: 10.5px; color: var(--dsw-alias-label-secondary); opacity: 0.85; line-height: 1.35; }
.kf-field-error { font-size: 10.5px; color: var(--kf-error); }
.kf-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.kf-grid2 .wide { grid-column: 1 / -1; }
.kf-col { display: flex; flex-direction: column; gap: 6px; }
.kf-inline { display: flex; gap: 6px; align-items: center; }
.kf-inline > .kf-input { flex: 1 1 auto; }
.kf-input { width: 100%; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 5px 7px; font: inherit; font-size: 12px; outline: none; min-width: 0; }
.kf-input:focus { border-color: var(--kf-flow); }
.kf-input.kf-invalid { border-color: var(--kf-error); }
.kf-textarea { resize: vertical; line-height: 1.45; }
.kf-mono { font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; }
.kf-num { max-width: 100%; }
.kf-check { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.kf-condition, .kf-map, .kf-list { display: flex; flex-direction: column; gap: 6px; }
.kf-map-row { border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; padding: 6px; display: flex; flex-direction: column; gap: 5px; background: var(--dsw-alias-bg-layer-2); }
.kf-map-head { display: flex; gap: 6px; align-items: center; }
.kf-issue-list { margin: 0; padding: 0 0 0 16px; font-size: 11.5px; display: flex; flex-direction: column; gap: 3px; }
.kf-issue-list li.error { color: var(--kf-error); }
.kf-issue-list li.warning { color: var(--dsw-alias-state-warn-primary); }
.kf-test-result { border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; padding: 7px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.kf-test-result.err { color: var(--kf-error); border-color: color-mix(in srgb, var(--kf-error) 45%, transparent); }
.kf-pre { margin: 0; font-size: 11px; font-family: var(--ds-font-family-code, ui-monospace, monospace); white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto; background: var(--dsw-alias-bg-layer-2); border-radius: 5px; padding: 5px; }
.kf-thumbs { display: flex; gap: 6px; flex-wrap: wrap; }
.kf-thumbs img { width: 132px !important; }
.kf-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); margin: 0; }
.kf-empty { border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; padding: 26px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.kf-banner { border-radius: 7px; padding: 6px 9px; font-size: 12px; }
.kf-banner.err { color: var(--kf-error); border: 1px solid color-mix(in srgb, var(--kf-error) 45%, transparent); }

.kf-yaml { display: flex; flex-direction: column; gap: 8px; }
.kf-yaml-text { height: var(--kf-h); min-height: 320px; }
.kf-yaml-actions, .kf-run-form-actions { display: flex; gap: 6px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
.kf-yaml-actions .kf-hint, .kf-run-form-actions .kf-hint { flex: 1 1 200px; }
.kf-run-form { border: 1px solid color-mix(in srgb, var(--kf-flow) 40%, var(--dsw-alias-border-l1)); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: color-mix(in srgb, var(--kf-flow) 4%, var(--dsw-alias-bg-layer-1)); }
.kf-run-form-title { font-weight: 650; font-size: 12.5px; }
.kf-run-form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }

/* Narrow panels (the right sidebar): stack palette, canvas and inspector. */
@container (max-width: 860px) {
  .kf-workspace { grid-template-columns: minmax(0, 1fr); height: auto; }
  .kf-no-inspector .kf-workspace { grid-template-columns: minmax(0, 1fr); }
  .kf-palette { flex-direction: row; flex-wrap: wrap; max-height: 150px; }
  .kf-palette-search, .kf-palette-hint { flex: 1 1 100%; }
  .kf-palette-group { flex-direction: row; flex-wrap: wrap; align-items: center; }
  .kf-palette-head { margin: 0 4px 0 0; }
  .kf-palette-type { display: none; }
  .kf-stage { height: 460px; }
  .kf-inspector { max-height: none; }
}
`;
