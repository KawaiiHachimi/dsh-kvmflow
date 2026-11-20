/**
 * The workflow editor: palette, canvas, inspector and YAML view around one
 * document, with debounced autosave, undo/redo and live run highlighting.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { DRAG_MIME, FlowCanvas } from './canvas';
import { DocumentInspector, NodeInspector } from './inspector';
import { clone, defaultConfig, forwardPort, freshId, portsFor, removeNode, renameNode, runOverlay } from './model';
import type { AvailableModel, FlowDoc, FlowEditorProps, FlowIssue, FlowNodeDoc, FlowView, NodeTypeSpec, Point, RunGraphProps } from './types';

type SaveState = 'saved' | 'dirty' | 'saving' | 'invalid' | 'error';

const CATEGORY_ORDER: Array<NodeTypeSpec['category']> = ['sense', 'flow', 'action', 'data'];
const CATEGORY_LABEL: Record<string, [string, string]> = {
  sense: ['感知', 'Perceive'],
  flow: ['流程', 'Control flow'],
  action: ['操作', 'Act'],
  data: ['数据', 'Data'],
};

/** The catalog is the same for every editor instance; fetch it once per page. */
let catalogPromise: Promise<NodeTypeSpec[]> | undefined;
function loadCatalog(rpc: FlowEditorProps['rpc']): Promise<NodeTypeSpec[]> {
  if (catalogPromise === undefined) {
    catalogPromise = rpc('flow.catalog').then((value: any) => value.nodes as NodeTypeSpec[]).catch(error => {
      catalogPromise = undefined;
      throw error;
    });
  }
  return catalogPromise;
}

function useCatalog(rpc: FlowEditorProps['rpc']): Map<string, NodeTypeSpec> | undefined {
  const [catalog, setCatalog] = useState<Map<string, NodeTypeSpec> | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadCatalog(rpc).then(nodes => { if (live) setCatalog(new Map(nodes.map(spec => [spec.type, spec]))); }).catch(() => undefined);
    return () => { live = false; };
  }, [rpc]);
  return catalog;
}

function useModels(rpc: FlowEditorProps['rpc']): { models: AvailableModel[]; defaultModel?: { provider: string; model: string } } {
  const [state, setState] = useState<{ models: AvailableModel[]; defaultModel?: { provider: string; model: string } }>({ models: [] });
  useEffect(() => {
    let live = true;
    void rpc('model.list').then((value: any) => {
      if (!live || value === undefined || value === null) return;
      setState({
        models: Array.isArray(value.models) ? value.models : [],
        ...(value.defaultModel ? { defaultModel: value.defaultModel } : {}),
      });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [rpc]);
  return state;
}

function issuesFromError(error: any): FlowIssue[] | undefined {
  const issues = error?.details?.issues;
  return Array.isArray(issues) ? issues : undefined;
}

/** Place a new node to the right of `anchor`, below anything already there. */
function placeAfter(anchor: Point | undefined, positions: Record<string, Point>): Point {
  const base = anchor === undefined ? { x: 0, y: 0 } : { x: anchor.x + 300, y: anchor.y };
  let point = { ...base };
  const taken = Object.values(positions);
  while (taken.some(other => Math.abs(other.x - point.x) < 200 && Math.abs(other.y - point.y) < 110)) point = { x: point.x, y: point.y + 140 };
  return point;
}

export function FlowEditor(props: FlowEditorProps): ReactNode {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner(props: FlowEditorProps): ReactNode {
  const { rpc, t, workflowId, notify } = props;
  const catalog = useCatalog(rpc);
  const { models, defaultModel } = useModels(rpc);
  const [doc, setDoc] = useState<FlowDoc | undefined>(undefined);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [issues, setIssues] = useState<FlowIssue[]>([]);
  const [yaml, setYaml] = useState('');
  const [yamlDraft, setYamlDraft] = useState<string | undefined>(undefined);
  const [view, setView] = useState<'canvas' | 'yaml'>('canvas');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [fitToken, setFitToken] = useState(0);
  const [paletteFilter, setPaletteFilter] = useState('');
  const [showRunForm, setShowRunForm] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const history = useRef<{ past: FlowDoc[]; future: FlowDoc[] }>({ past: [], future: [] });
  const editSeq = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<{ doc?: FlowDoc; positions: Record<string, Point> }>({ positions: {} });
  latest.current = { doc, positions };

  const applyView = useCallback((value: FlowView, keepSelection = true) => {
    setDoc(value.document);
    setPositions(value.graph.layout.nodes ?? {});
    setIssues(value.issues ?? []);
    setYaml(value.yaml);
    setYamlDraft(undefined);
    if (!keepSelection) setSelected(undefined);
  }, []);

  // Load whenever the workflow changes; edits in flight for the old one are dropped.
  useEffect(() => {
    let live = true;
    setDoc(undefined);
    setLoadError('');
    setSaveState('saved');
    setTestResults({});
    history.current = { past: [], future: [] };
    void rpc('flow.get', { id: workflowId }).then((value: FlowView) => {
      if (!live) return;
      applyView(value, false);
      setFitToken(token => token + 1);
    }).catch((error: any) => { if (live) setLoadError(error?.message ?? String(error)); });
    return () => {
      live = false;
      if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
    };
  }, [workflowId, rpc, applyView]);

  useEffect(() => { props.onDirtyChange?.(saveState === 'dirty' || saveState === 'saving' || saveState === 'invalid'); }, [saveState]);

  const persist = useCallback(async (): Promise<boolean> => {
    const current = latest.current;
    if (current.doc === undefined) return false;
    const seq = editSeq.current;
    setSaveState('saving');
    try {
      const value: FlowView = await rpc('flow.save', { id: workflowId, document: current.doc, layout: { version: 1, nodes: current.positions } });
      // A newer edit arrived while saving: keep it and let its own save win.
      if (seq !== editSeq.current) return true;
      setIssues(value.issues ?? []);
      setYaml(value.yaml);
      setSaveState('saved');
      setSaveError('');
      props.onSaved();
      return true;
    } catch (error: any) {
      const structural = issuesFromError(error);
      if (structural !== undefined) {
        setIssues(structural);
        setSaveState('invalid');
        setSaveError(t('有错误，修正后自动保存', 'Fix the errors to save'));
      } else {
        setSaveState('error');
        setSaveError(error?.message ?? String(error));
      }
      return false;
    }
  }, [rpc, workflowId, props.onSaved, t]);

  const scheduleSave = useCallback((delay = 700) => {
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = undefined; void persist(); }, delay);
  }, [persist]);

  /** Apply one edit: record undo history, update, and autosave. */
  const edit = useCallback((next: FlowDoc, nextPositions?: Record<string, Point>) => {
    const previous = latest.current.doc;
    if (previous !== undefined) {
      history.current.past.push(clone(previous));
      if (history.current.past.length > 60) history.current.past.shift();
      history.current.future = [];
    }
    editSeq.current += 1;
    setDoc(next);
    if (nextPositions !== undefined) setPositions(nextPositions);
    latest.current = { doc: next, positions: nextPositions ?? latest.current.positions };
    setSaveState('dirty');
    scheduleSave();
  }, [scheduleSave]);

  const undo = useCallback((redo = false) => {
    const stack = history.current;
    const from = redo ? stack.future : stack.past;
    const to = redo ? stack.past : stack.future;
    const target = from.pop();
    const current = latest.current.doc;
    if (target === undefined || current === undefined) return;
    to.push(clone(current));
    editSeq.current += 1;
    setDoc(target);
    latest.current = { doc: target, positions: latest.current.positions };
    if (selected !== undefined && !Object.hasOwn(target.nodes, selected)) setSelected(undefined);
    setSaveState('dirty');
    scheduleSave(300);
  }, [scheduleSave, selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo(event.shiftKey);
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        undo(true);
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
        void persist();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, persist]);

  const overlay = useMemo(() => runOverlay(props.run, workflowId), [props.run, workflowId]);
  const running = overlay !== undefined && props.run !== undefined && !['succeeded', 'failed', 'aborted'].includes(props.run.status);

  const addNode = useCallback((type: string, point?: Point) => {
    const current = latest.current.doc;
    if (current === undefined || catalog === undefined) return;
    const spec = catalog.get(type);
    const id = freshId(type, current);
    const config = defaultConfig(type, t, props.workflows, workflowId);
    const node: FlowNodeDoc = {
      id,
      type,
      name: spec === undefined ? type : t(spec.label[0], spec.label[1]),
      config,
      next: {},
      retry: { times: 0, delayMs: 0 },
      maxVisits: 100,
      ...(spec?.action ? { verify: { mode: 'none' } } : {}),
    };
    const nodes = { ...current.nodes, [id]: node };
    // Clicking a palette item while a node is selected continues from it:
    // the selected node's first free forward port now leads to the new node.
    const anchorId = point === undefined ? selected : undefined;
    if (anchorId !== undefined && nodes[anchorId] !== undefined) {
      const anchor = nodes[anchorId];
      const ports = portsFor(catalog.get(anchor.type), anchor.config);
      const free = ports.find(port => port.kind !== 'error' && anchor.next[port.name] === undefined);
      const port = free?.name ?? forwardPort(ports);
      if (port !== undefined) {
        const previousTarget = anchor.next[port];
        const own = forwardPort(portsFor(spec, config));
        if (previousTarget !== undefined && own !== undefined) node.next[own] = previousTarget;
        nodes[anchorId] = { ...anchor, next: { ...anchor.next, [port]: id } };
      }
    }
    const nextDoc = { ...current, nodes, start: current.start === '' ? id : current.start };
    const where = point ?? placeAfter(anchorId === undefined ? undefined : latest.current.positions[anchorId], latest.current.positions);
    edit(nextDoc, { ...latest.current.positions, [id]: where });
    setSelected(id);
    setInspectorOpen(true);
  }, [catalog, edit, props.workflows, selected, t, workflowId]);

  const updateNode = useCallback((id: string, node: FlowNodeDoc) => {
    const current = latest.current.doc;
    if (current === undefined) return;
    edit({ ...current, nodes: { ...current.nodes, [id]: node } });
  }, [edit]);

  const deleteNodes = useCallback((ids: string[]) => {
    let current = latest.current.doc;
    if (current === undefined) return;
    for (const id of ids) current = removeNode(current, id);
    const nextPositions = { ...latest.current.positions };
    for (const id of ids) delete nextPositions[id];
    edit(current, nextPositions);
    if (selected !== undefined && ids.includes(selected)) setSelected(undefined);
  }, [edit, selected]);

  const connect = useCallback((source: string, port: string, target: string | undefined) => {
    const current = latest.current.doc;
    if (current === undefined || current.nodes[source] === undefined) return;
    const next = { ...current.nodes[source].next };
    if (target === undefined) delete next[port];
    else next[port] = target;
    edit({ ...current, nodes: { ...current.nodes, [source]: { ...current.nodes[source], next } } });
  }, [edit]);

  const autoLayout = useCallback(async () => {
    const current = latest.current.doc;
    if (current === undefined) return;
    try {
      const checked = await rpc('flow.check', { document: current, id: workflowId });
      if (checked.graph === undefined) {
        notify(t('先修正错误再自动排版。', 'Fix the errors before auto layout.'), 'warn');
        return;
      }
      setPositions(checked.graph.layout.nodes);
      latest.current = { doc: current, positions: checked.graph.layout.nodes };
      setSaveState('dirty');
      scheduleSave(200);
      setFitToken(token => token + 1);
    } catch (error: any) {
      notify(error?.message ?? String(error), 'err');
    }
  }, [notify, rpc, scheduleSave, t, workflowId]);

  const applyYaml = useCallback(async () => {
    if (yamlDraft === undefined) return;
    setSaveState('saving');
    try {
      const value: FlowView = await rpc('flow.save', { id: workflowId, yaml: yamlDraft });
      history.current.past.push(clone(latest.current.doc as FlowDoc));
      applyView(value);
      setSaveState('saved');
      setSaveError('');
      props.onSaved();
      notify(t('已从 YAML 更新工作流。', 'Workflow updated from YAML.'), 'ok');
    } catch (error: any) {
      const structural = issuesFromError(error);
      if (structural !== undefined) setIssues(structural);
      setSaveState('invalid');
      setSaveError(error?.message ?? String(error));
    }
  }, [applyView, notify, props.onSaved, rpc, t, workflowId, yamlDraft]);

  const testNode = useCallback(async (nodeId: string) => {
    if (saveState !== 'saved') {
      if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
      if (!(await persist())) return;
    }
    setTesting(true);
    try {
      const value = await rpc('flow.testNode', { id: workflowId, nodeId, deviceId: props.deviceId });
      setTestResults(results => ({ ...results, [nodeId]: value }));
    } catch (error: any) {
      setTestResults(results => ({ ...results, [nodeId]: { error: error?.message ?? String(error) } }));
    } finally {
      setTesting(false);
    }
  }, [persist, props.deviceId, rpc, saveState, workflowId]);

  const exportYaml = useCallback(async () => {
    const current = latest.current.doc;
    if (current === undefined) return;
    let content = yamlDraft ?? yaml;
    if (yamlDraft === undefined && saveState !== 'saved') {
      if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
      const ok = await persist();
      if (ok) {
        try {
          const fresh: FlowView = await rpc('flow.get', { id: workflowId });
          content = fresh.yaml;
        } catch {
          // Keep the last known YAML if refetch fails.
        }
      }
    }
    const safeName = (current.name || current.id || 'workflow').replace(/[\\/:*?"<>|]/g, '_').trim() || 'workflow';
    const suggestedName = safeName.endsWith('.yaml') || safeName.endsWith('.yml') ? safeName : `${safeName}.yaml`;
    const picker = (window as any).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({
          suggestedName,
          types: [{ description: 'KVMFlow YAML', accept: { 'text/yaml': ['.yaml', '.yml'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        notify(t(`已导出到 ${handle.name ?? suggestedName}`, `Exported to ${handle.name ?? suggestedName}`), 'ok');
        return;
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        // Fall through to standard browser download if the picker fails.
      }
    }
    const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(t(`已导出 ${suggestedName}`, `Exported ${suggestedName}`), 'ok');
  }, [notify, persist, rpc, saveState, t, workflowId, yaml, yamlDraft]);

  const startRun = useCallback(async () => {
    const current = latest.current.doc;
    if (current === undefined) return;
    if (saveState !== 'saved') {
      if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
      if (!(await persist())) {
        notify(t('工作流有错误，修正后再执行。', 'The workflow has errors; fix them before running.'), 'err');
        return;
      }
    }
    if (Object.keys(current.inputs ?? {}).length > 0 && !showRunForm) {
      setShowRunForm(true);
      return;
    }
    setShowRunForm(false);
    const inputs: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(current.inputs ?? {})) {
      const raw = runInputs[name];
      if (raw === undefined || raw === '') continue;
      inputs[name] = spec.type === 'number' ? Number(raw) : spec.type === 'boolean' ? raw === 'true' : raw;
    }
    await props.onRun(inputs);
    // Secrets do not linger in the form after use.
    setRunInputs(values => Object.fromEntries(Object.entries(values).filter(([name]) => current.inputs[name]?.type !== 'secret')));
  }, [notify, persist, props.onRun, runInputs, saveState, showRunForm, t]);

  if (loadError !== '') return <div className="kf-empty">{loadError}</div>;
  if (doc === undefined || catalog === undefined) return <div className="kf-empty">{t('正在加载工作流…', 'Loading workflow…')}</div>;

  const errorCount = issues.filter(issue => issue.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const selectedNode = selected === undefined ? undefined : doc.nodes[selected];
  const filter = paletteFilter.trim().toLowerCase();
  const palette = CATEGORY_ORDER.map(category => ({
    category,
    items: [...catalog.values()].filter(spec => spec.category === category && spec.type !== 'sequence')
      .filter(spec => filter === '' || `${spec.type} ${spec.label[0]} ${spec.label[1]}`.toLowerCase().includes(filter)),
  })).filter(group => group.items.length > 0);
  const stateLabel: Record<SaveState, string> = {
    saved: t('已保存', 'Saved'),
    dirty: t('未保存', 'Unsaved'),
    saving: t('保存中…', 'Saving…'),
    invalid: t('有错误，未保存', 'Not saved: errors'),
    error: t('保存失败', 'Save failed'),
  };

  return (
    <div className={`kf-editor${props.compact ? ' kf-compact' : ''}${inspectorOpen ? '' : ' kf-no-inspector'}`}>
      <div className="kf-toolbar">
        <div className="kf-toolbar-title">
          <span className="kf-doc-name" title={doc.id}>{doc.name}</span>
          <span className={`kf-save kf-save-${saveState}`} title={saveError || undefined}>{stateLabel[saveState]}</span>
          {errorCount > 0 ? <span className="kf-chip err">{t(`${errorCount} 个错误`, `${errorCount} error${errorCount > 1 ? 's' : ''}`)}</span> : null}
          {warningCount > 0 ? <span className="kf-chip warn">{t(`${warningCount} 个提醒`, `${warningCount} warning${warningCount > 1 ? 's' : ''}`)}</span> : null}
          {running ? <span className="kf-chip run">{t('执行中', 'Running')} · {props.run?.phase}</span> : null}
        </div>
        <div className="kf-toolbar-actions">
          <div className="kf-seg" role="tablist" aria-label={t('视图', 'View')}>
            <button type="button" role="tab" aria-selected={view === 'canvas'} className={view === 'canvas' ? 'on' : ''} onClick={() => setView('canvas')}>{t('画布', 'Canvas')}</button>
            <button type="button" role="tab" aria-selected={view === 'yaml'} className={view === 'yaml' ? 'on' : ''} onClick={() => { setView('yaml'); setYamlDraft(undefined); }}>YAML</button>
          </div>
          <button type="button" className="kf-btn" onClick={() => undo(false)} disabled={history.current.past.length === 0} title={t('撤销（⌘Z）', 'Undo (⌘Z)')}>↶</button>
          <button type="button" className="kf-btn" onClick={() => undo(true)} disabled={history.current.future.length === 0} title={t('重做（⇧⌘Z）', 'Redo (⇧⌘Z)')}>↷</button>
          {view === 'canvas' ? <button type="button" className="kf-btn" onClick={() => { void autoLayout(); }}>{t('自动排版', 'Auto layout')}</button> : null}
          <button type="button" className="kf-btn" onClick={() => { void exportYaml(); }} title={t('导出为本地 YAML 文件', 'Export workflow as a local YAML file')}>{t('导出', 'Export')}</button>
          <button type="button" className="kf-btn" onClick={() => props.onAskAi(doc)}>{t('AI 编辑', 'Edit with AI')}</button>
          <button type="button" className="kf-btn kf-btn-primary" onClick={() => { void startRun(); }} disabled={props.runDisabledReason !== undefined || errorCount > 0} title={props.runDisabledReason ?? (errorCount > 0 ? t('先修正错误', 'Fix the errors first') : undefined)}>
            ▶ {t('执行', 'Run')}
          </button>
          <button type="button" className="kf-btn" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(open => !open)} title={t('显示/隐藏属性面板', 'Toggle the inspector')}>⫶</button>
        </div>
      </div>

      {showRunForm ? (
        <div className="kf-run-form">
          <div className="kf-run-form-title">{t('运行输入', 'Run inputs')}</div>
          <div className="kf-run-form-grid">
            {Object.entries(doc.inputs).map(([name, spec]) => (
              <label key={name} className="kf-field">
                <span className="kf-field-label">{name}{spec.required ? ' *' : ''}{spec.description ? ` — ${spec.description}` : ''}</span>
                {spec.type === 'boolean' ? (
                  <select className="kf-input kf-select" value={runInputs[name] ?? String(spec.default ?? 'false')} onChange={event => setRunInputs(values => ({ ...values, [name]: event.target.value }))}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    className="kf-input"
                    type={spec.type === 'secret' ? 'password' : spec.type === 'number' ? 'number' : 'text'}
                    autoComplete={spec.type === 'secret' ? 'new-password' : 'off'}
                    value={runInputs[name] ?? (spec.default === undefined ? '' : String(spec.default))}
                    onChange={event => setRunInputs(values => ({ ...values, [name]: event.target.value }))}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="kf-run-form-actions">
            <span className="kf-hint">{t('密码类输入只在本次执行的内存中使用，不写入日志和磁盘。', 'Secret inputs live only in this run\'s memory; they are never logged or stored.')}</span>
            <button type="button" className="kf-btn" onClick={() => setShowRunForm(false)}>{t('取消', 'Cancel')}</button>
            <button type="button" className="kf-btn kf-btn-primary" onClick={() => { void startRun(); }}>▶ {t('开始执行', 'Start run')}</button>
          </div>
        </div>
      ) : null}

      {view === 'yaml' ? (
        <div className="kf-yaml">
          <textarea
            className="kf-input kf-textarea kf-mono kf-yaml-text"
            spellCheck={false}
            value={yamlDraft ?? yaml}
            onChange={event => setYamlDraft(event.target.value)}
            aria-label="YAML"
          />
          <div className="kf-yaml-actions">
            <span className="kf-hint">{yamlDraft === undefined ? t('画布上的修改会同步到这里。', 'Canvas edits appear here after saving.') : t('应用后会校验并刷新画布。', 'Applying validates the YAML and refreshes the canvas.')}</span>
            <button type="button" className="kf-btn" disabled={yamlDraft === undefined} onClick={() => setYamlDraft(undefined)}>{t('放弃修改', 'Discard')}</button>
            <button type="button" className="kf-btn kf-btn-primary" disabled={yamlDraft === undefined} onClick={() => { void applyYaml(); }}>{t('应用 YAML', 'Apply YAML')}</button>
          </div>
          {saveState === 'invalid' && saveError !== '' ? <div className="kf-banner err">{saveError}</div> : null}
        </div>
      ) : (
        <div className="kf-workspace">
          <aside className="kf-palette" aria-label={t('节点', 'Nodes')}>
            <input className="kf-input kf-palette-search" placeholder={t('搜索节点…', 'Search nodes…')} value={paletteFilter} onChange={event => setPaletteFilter(event.target.value)} />
            <div className="kf-palette-hint">{selected === undefined ? t('拖到画布，或点击添加', 'Drag onto the canvas or click to add') : t('点击：接在选中节点之后', 'Click: continue after the selected node')}</div>
            {palette.map(group => (
              <div key={group.category} className="kf-palette-group">
                <div className={`kf-palette-head kf-cat-${group.category}`}>{t(CATEGORY_LABEL[group.category][0], CATEGORY_LABEL[group.category][1])}</div>
                {group.items.map(spec => (
                  <button
                    key={spec.type}
                    type="button"
                    className={`kf-palette-item kf-cat-${spec.category}`}
                    draggable
                    onDragStart={event => { event.dataTransfer.setData(DRAG_MIME, spec.type); event.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => addNode(spec.type)}
                    title={t(spec.description[0], spec.description[1])}
                  >
                    <span className="kf-palette-name">{t(spec.label[0], spec.label[1])}</span>
                    <span className="kf-palette-type">{spec.type}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>
          <div className="kf-stage">
            {Object.keys(doc.nodes).length === 0 ? (
              <div className="kf-stage-empty">{t('从左侧拖入第一个节点。建议从“画面分类”开始：先认出当前画面，再分支处理。', 'Drag in a first node. A good start is Vision classify: recognize the screen, then branch.')}</div>
            ) : null}
            <FlowCanvas
              doc={doc}
              positions={positions}
              catalog={catalog}
              issues={issues}
              {...(overlay === undefined ? {} : { overlay })}
              {...(selected === undefined ? {} : { selectedId: selected })}
              t={t}
              fitToken={fitToken}
              onSelect={id => { setSelected(id); if (id !== undefined) setInspectorOpen(true); }}
              onConnect={(source, port, target) => connect(source, port, target)}
              onDisconnect={(source, port) => connect(source, port, undefined)}
              onDeleteNodes={deleteNodes}
              onMove={moves => {
                const next = { ...latest.current.positions, ...moves };
                setPositions(next);
                latest.current = { doc: latest.current.doc, positions: next };
                setSaveState(state => (state === 'saved' ? 'dirty' : state));
                scheduleSave(900);
              }}
              onDropType={(type, point) => addNode(type, point)}
            />
          </div>
          {inspectorOpen ? (
            <aside className="kf-inspector" aria-label={t('属性', 'Inspector')}>
              {selectedNode !== undefined && selected !== undefined ? (
                <NodeInspector
                  doc={doc}
                  nodeId={selected}
                  {...(catalog.get(selectedNode.type) === undefined ? {} : { spec: catalog.get(selectedNode.type) })}
                  issues={issues.filter(issue => issue.nodeId === selected)}
                  t={t}
                  workflows={props.workflows.filter(entry => entry.id !== workflowId)}
                  onChange={node => updateNode(selected, node)}
                  onRename={to => {
                    const current = latest.current.doc as FlowDoc;
                    const nextPositions = { ...latest.current.positions };
                    if (nextPositions[selected] !== undefined) {
                      nextPositions[to] = nextPositions[selected];
                      delete nextPositions[selected];
                    }
                    edit(renameNode(current, selected, to), nextPositions);
                    setSelected(to);
                  }}
                  onDelete={() => deleteNodes([selected])}
                  onSetStart={() => edit({ ...(latest.current.doc as FlowDoc), start: selected })}
                  onConnect={(port, target) => connect(selected, port, target)}
                  testing={testing}
                  {...(testResults[selected] === undefined ? {} : { testResult: testResults[selected] })}
                  onTest={() => { void testNode(selected); }}
                  {...(props.deviceId === '' ? { testDisabledReason: t('先选择 KVM 设备', 'Select a KVM device first') } : running ? { testDisabledReason: t('执行中不能试运行', 'Not while a run is active') } : {})}
                  renderThumb={props.renderThumb}
                />
              ) : (
                <DocumentInspector
                  doc={doc}
                  issues={issues}
                  models={models}
                  {...(defaultModel === undefined ? {} : { defaultModel })}
                  t={t}
                  onChange={edit}
                  onSelectNode={id => setSelected(id)}
                />
              )}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Read-only graph of a run, with the walked path highlighted. */
export function RunGraph(props: RunGraphProps): ReactNode {
  return (
    <ReactFlowProvider>
      <RunGraphInner {...props} />
    </ReactFlowProvider>
  );
}

const viewCache = new Map<string, { at: number; view: FlowView }>();

function RunGraphInner(props: RunGraphProps): ReactNode {
  const { rpc, t, workflowId, run } = props;
  const catalog = useCatalog(rpc);
  const [view, setView] = useState<FlowView | undefined>(viewCache.get(workflowId)?.view);
  const [error, setError] = useState('');
  const [fitToken, setFitToken] = useState(1);
  useEffect(() => {
    let live = true;
    const cached = viewCache.get(workflowId);
    if (cached !== undefined && Date.now() - cached.at < 15_000) {
      setView(cached.view);
      return undefined;
    }
    void rpc('flow.get', { id: workflowId }).then((value: FlowView) => {
      if (!live) return;
      viewCache.set(workflowId, { at: Date.now(), view: value });
      setView(value);
      setFitToken(token => token + 1);
    }).catch((failure: any) => { if (live) setError(failure?.message ?? String(failure)); });
    return () => { live = false; };
  }, [rpc, workflowId]);
  const overlay = useMemo(() => runOverlay(run, workflowId), [run, workflowId]);
  if (error !== '') return <div className="kf-empty">{t('无法加载工作流图：', 'Cannot load the workflow graph: ')}{error}</div>;
  if (view === undefined || catalog === undefined) return <div className="kf-empty">{t('正在加载流程图…', 'Loading the graph…')}</div>;
  return (
    <div className="kf-run-graph" style={{ height: props.height ?? 360 }}>
      <FlowCanvas
        doc={view.document}
        positions={view.graph.layout.nodes}
        catalog={catalog}
        issues={[]}
        {...(overlay === undefined ? {} : { overlay })}
        {...(props.selectedNodeId === undefined ? {} : { selectedId: props.selectedNodeId })}
        readOnly
        t={t}
        fitToken={fitToken}
        onSelect={id => props.onSelectNode?.(id)}
      />
    </div>
  );
}
