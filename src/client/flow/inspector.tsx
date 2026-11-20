/**
 * The inspector: edits the selected node, or the document when nothing is
 * selected. Every control writes through `onChange` with a whole new node, so
 * undo and autosave see one coherent change per edit.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { portLabel } from './canvas';
import { portsFor, pruneEdges } from './model';
import type { FieldSpec, FlowDoc, FlowInputSpec, FlowIssue, FlowNodeDoc, NodeTypeSpec, Translate, VerifySpec } from './types';

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** A text input that commits on blur/Enter, so a half-typed value is not saved per keystroke. */
function Text(props: { value: string; onCommit: (value: string) => void; placeholder?: string; mono?: boolean; multiline?: boolean; rows?: number; invalid?: boolean; ariaLabel?: string }): ReactNode {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => { setDraft(props.value); }, [props.value]);
  const commit = (): void => { if (draft !== props.value) props.onCommit(draft); };
  const className = `kf-input${props.mono ? ' kf-mono' : ''}${props.invalid ? ' kf-invalid' : ''}`;
  if (props.multiline) {
    return (
      <textarea
        className={`${className} kf-textarea`}
        value={draft}
        rows={props.rows ?? 3}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit(); }}
      />
    );
  }
  return (
    <input
      className={className}
      value={draft}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') commit(); }}
    />
  );
}

function NumberInput(props: { value: number | string | undefined; onCommit: (value: number | string | undefined) => void; min?: number; max?: number; step?: number; allowTemplate?: boolean; ariaLabel?: string }): ReactNode {
  const shown = props.value === undefined ? '' : String(props.value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  const commit = (): void => {
    if (draft === shown) return;
    if (draft.trim() === '') { props.onCommit(undefined); return; }
    if (props.allowTemplate && draft.includes('{{')) { props.onCommit(draft); return; }
    const value = Number(draft);
    if (Number.isFinite(value)) props.onCommit(value);
    else setDraft(shown);
  };
  return (
    <input
      className="kf-input kf-num"
      inputMode="decimal"
      value={draft}
      aria-label={props.ariaLabel}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') commit(); }}
    />
  );
}

function Row(props: { label: string; help?: string; children: ReactNode; wide?: boolean }): ReactNode {
  return (
    <label className={`kf-field${props.wide ? ' wide' : ''}`}>
      <span className="kf-field-label">{props.label}</span>
      {props.children}
      {props.help ? <span className="kf-field-help">{props.help}</span> : null}
    </label>
  );
}

function Section(props: { title: string; children: ReactNode; open?: boolean; aside?: ReactNode }): ReactNode {
  return (
    <details className="kf-section" open={props.open !== false}>
      <summary><span>{props.title}</span>{props.aside}</summary>
      <div className="kf-section-body">{props.children}</div>
    </details>
  );
}

/** Condition editor for the common kinds; compound conditions edit as JSON. */
function ConditionEditor(props: { value: any; onChange: (value: any) => void; t: Translate }): ReactNode {
  const { value, t } = props;
  const kind = value === null || typeof value !== 'object'
    ? 'vision'
    : ['vision', 'expr', 'image', 'change'].find(key => key in value) ?? 'json';
  const setKind = (next: string): void => {
    if (next === kind) return;
    if (next === 'vision') props.onChange({ vision: t('画面上出现了……', 'The screen shows …') });
    else if (next === 'expr') props.onChange({ expr: 'vars.count < 3' });
    else if (next === 'image') props.onChange({ image: 'assets/reference.jpg' });
    else if (next === 'change') props.onChange({ change: true });
    else props.onChange({ all: [value ?? { change: true }] });
  };
  return (
    <div className="kf-condition">
      <select className="kf-input kf-select" value={kind} onChange={event => setKind(event.target.value)} aria-label={t('条件类型', 'Condition kind')}>
        <option value="vision">{t('视觉判断', 'Vision')}</option>
        <option value="expr">{t('表达式', 'Expression')}</option>
        <option value="change">{t('画面变化', 'Screen change')}</option>
        <option value="image">{t('参考图', 'Reference image')}</option>
        <option value="json">{t('组合（JSON）', 'Compound (JSON)')}</option>
      </select>
      {kind === 'vision' ? (
        <>
          <Text multiline rows={3} value={String(value.vision ?? '')} onCommit={text => props.onChange({ ...value, vision: text })} placeholder={t('具体描述画面上必须出现什么', 'Describe exactly what must be visible')} />
          <Text value={String(value.context ?? '')} onCommit={text => props.onChange(text === '' ? { vision: value.vision, ...(value.settleMs === undefined ? {} : { settleMs: value.settleMs }) } : { ...value, context: text })} placeholder={t('背景说明（可选）', 'Context (optional)')} />
        </>
      ) : null}
      {kind === 'expr' ? <Text mono value={String(value.expr ?? '')} onCommit={text => props.onChange({ expr: text })} placeholder="vars.count < 3 && nodes.detect.output.label == 'network'" /> : null}
      {kind === 'image' ? (
        <div className="kf-inline">
          <Text value={String(value.image ?? '')} onCommit={text => props.onChange({ ...value, image: text })} placeholder="assets/step-1.jpg" />
          <NumberInput value={value.maxByteDelta} onCommit={delta => props.onChange(delta === undefined ? { image: value.image } : { ...value, maxByteDelta: delta })} ariaLabel={t('允许字节差', 'Byte delta')} />
        </div>
      ) : null}
      {kind === 'change' ? (
        <select className="kf-input kf-select" value={value.change === false ? 'same' : 'changed'} onChange={event => props.onChange({ change: event.target.value !== 'same' })}>
          <option value="changed">{t('与上一帧不同', 'differs from the previous frame')}</option>
          <option value="same">{t('与上一帧相同', 'same as the previous frame')}</option>
        </select>
      ) : null}
      {kind === 'json' ? <JsonEditor value={value} onChange={props.onChange} t={t} /> : null}
    </div>
  );
}

function JsonEditor(props: { value: unknown; onChange: (value: any) => void; t: Translate; rows?: number }): ReactNode {
  const text = JSON.stringify(props.value ?? null, null, 2);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(text); setError(''); }, [text]);
  return (
    <>
      <textarea
        className={`kf-input kf-textarea kf-mono${error ? ' kf-invalid' : ''}`}
        rows={props.rows ?? 5}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === text) return;
          try {
            props.onChange(JSON.parse(draft));
            setError('');
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure));
          }
        }}
      />
      {error ? <span className="kf-field-error">{error}</span> : null}
    </>
  );
}

/** Ordered key → value rows; keys become ports for labels and cases. */
function MapEditor(props: {
  value: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  t: Translate;
  keyIsPort?: boolean;
  renderValue: (value: any, set: (value: any) => void) => ReactNode;
  makeValue: () => any;
  keyPlaceholder?: string;
}): ReactNode {
  const entries = Object.entries(props.value ?? {});
  const { t } = props;
  const rename = (index: number, key: string): void => {
    if (props.keyIsPort && !NAME_PATTERN.test(key)) return;
    const next: Record<string, any> = {};
    entries.forEach(([oldKey, value], position) => { next[position === index ? key : oldKey] = value; });
    props.onChange(next);
  };
  const setValue = (key: string, value: any): void => props.onChange({ ...props.value, [key]: value });
  const remove = (key: string): void => {
    const next = { ...props.value };
    delete next[key];
    props.onChange(next);
  };
  const add = (): void => {
    let index = entries.length + 1;
    while (Object.hasOwn(props.value ?? {}, `item${index}`)) index += 1;
    props.onChange({ ...props.value, [`item${index}`]: props.makeValue() });
  };
  return (
    <div className="kf-map">
      {entries.map(([key, value], index) => (
        <div key={`${index}`} className="kf-map-row">
          <div className="kf-map-head">
            <Text mono value={key} onCommit={next => rename(index, next)} invalid={props.keyIsPort === true && !NAME_PATTERN.test(key)} placeholder={props.keyPlaceholder} ariaLabel={t('名称', 'Name')} />
            <button type="button" className="kf-icon-btn" onClick={() => remove(key)} aria-label={t(`删除 ${key}`, `Remove ${key}`)}>×</button>
          </div>
          {props.renderValue(value, next => setValue(key, next))}
        </div>
      ))}
      <button type="button" className="kf-btn kf-btn-ghost" onClick={add}>+ {t('添加', 'Add')}</button>
    </div>
  );
}

function ListEditor(props: { value: any[]; onChange: (value: any[]) => void; t: Translate; port?: boolean }): ReactNode {
  const items = (props.value ?? []).map(item => (typeof item === 'string' ? item : item?.name ?? ''));
  return (
    <div className="kf-list">
      {items.map((item, index) => (
        <div key={`${index}`} className="kf-inline">
          <Text mono value={item} invalid={props.port === true && !NAME_PATTERN.test(item)} onCommit={value => props.onChange(items.map((old, position) => (position === index ? value : old)))} />
          <button type="button" className="kf-icon-btn" onClick={() => props.onChange(items.filter((_, position) => position !== index))} aria-label={props.t('删除', 'Remove')}>×</button>
        </div>
      ))}
      <button type="button" className="kf-btn kf-btn-ghost" onClick={() => props.onChange([...items, `option${items.length + 1}`])}>+ {props.t('添加', 'Add')}</button>
    </div>
  );
}

function ActionFields(props: { node: FlowNodeDoc; set: (patch: Record<string, any>) => void; t: Translate }): ReactNode {
  const { node, set, t } = props;
  const c = node.config ?? {};
  switch (node.type) {
    case 'key':
      return (
        <div className="kf-grid2">
          <Row label={t('按键', 'Key')} help={t('KeyboardEvent.code，如 Enter、F2、ArrowDown', 'KeyboardEvent.code, e.g. Enter, F2, ArrowDown')} wide><Text mono value={String(c.key ?? '')} onCommit={key => set({ key })} /></Row>
          <Row label={t('重复次数', 'Repeat')}><NumberInput value={c.repeat} min={1} onCommit={repeat => set({ repeat })} /></Row>
          <Row label={t('间隔（毫秒）', 'Interval (ms)')}><NumberInput value={c.intervalMs} onCommit={intervalMs => set({ intervalMs })} /></Row>
        </div>
      );
    case 'shortcut':
      return <Row label={t('组合键（逗号分隔，按顺序按下）', 'Keys (comma separated, pressed in order)')}><Text mono value={(c.keys ?? []).join(', ')} onCommit={text => set({ keys: text.split(',').map(key => key.trim()).filter(Boolean) })} /></Row>;
    case 'text':
      return (
        <>
          <Row label={t('文本', 'Text')} help={t('可用 {{inputs.name}} 引用输入；只支持可打印 ASCII。', 'Use {{inputs.name}} for inputs; printable ASCII only.')}><Text multiline value={String(c.text ?? '')} onCommit={text => set({ text })} /></Row>
          <label className="kf-check"><input type="checkbox" checked={c.submit === true} onChange={event => set({ submit: event.target.checked })} />{t('输入后按回车', 'Press Enter afterwards')}</label>
        </>
      );
    case 'click':
    case 'move':
    case 'scroll':
      return (
        <div className="kf-grid2">
          <Row label="x" help={t('0–1，可写 {{nodes.find.output.x}}', '0–1, or {{nodes.find.output.x}}')}><NumberInput allowTemplate value={c.x} onCommit={x => set({ x })} /></Row>
          <Row label="y"><NumberInput allowTemplate value={c.y} onCommit={y => set({ y })} /></Row>
          {node.type === 'click' ? (
            <>
              <Row label={t('按键', 'Button')}>
                <select className="kf-input kf-select" value={c.button ?? 'left'} onChange={event => set({ button: event.target.value })}>
                  <option value="left">{t('左键', 'left')}</option>
                  <option value="right">{t('右键', 'right')}</option>
                  <option value="middle">{t('中键', 'middle')}</option>
                </select>
              </Row>
              <Row label={t('次数', 'Count')}><NumberInput value={c.count} onCommit={count => set({ count })} /></Row>
            </>
          ) : null}
          {node.type === 'scroll' ? <Row label={t('滚动量（正数向下）', 'Wheel (positive = down)')}><NumberInput value={c.wheelY} onCommit={wheelY => set({ wheelY })} /></Row> : null}
        </div>
      );
    case 'delay':
      return <Row label={t('等待（毫秒）', 'Wait (ms)')}><NumberInput allowTemplate value={c.ms} onCommit={ms => set({ ms })} /></Row>;
    case 'sequence':
      return <Row label={t('录制事件', 'Recorded events')} help={t('来自录制的原始 HID 事件，坐标不经映射。', 'Raw HID events from a recording; coordinates are not remapped.')}><JsonEditor value={c.events} rows={6} onChange={events => set({ events })} t={t} /></Row>;
    default:
      return null;
  }
}

function VerifyEditor(props: { value: VerifySpec | undefined; onChange: (value: VerifySpec | undefined) => void; t: Translate; kind: 'verify' | 'precondition' }): ReactNode {
  const { t } = props;
  const value = props.value ?? { mode: 'none' };
  const mode = value.mode ?? 'none';
  return (
    <div className="kf-col">
      <select className="kf-input kf-select" value={mode} onChange={event => props.onChange(event.target.value === 'none' ? (props.kind === 'precondition' ? undefined : { mode: 'none' }) : { ...value, mode: event.target.value as VerifySpec['mode'] })}>
        <option value="none">{props.kind === 'verify' ? t('不验证', 'No verification') : t('无前置条件', 'No precondition')}</option>
        <option value="change">{t('画面发生变化', 'Screen changes')}</option>
        <option value="vision">{t('视觉判断', 'Vision check')}</option>
        <option value="image">{t('与参考图一致', 'Matches a reference image')}</option>
      </select>
      {mode === 'vision' ? <Text multiline value={value.prompt ?? ''} onCommit={prompt => props.onChange({ ...value, prompt })} placeholder={t('成功时画面上应出现什么', 'What the screen shows on success')} /> : null}
      {mode === 'image' ? <Text value={value.image ?? ''} onCommit={image => props.onChange({ ...value, image })} placeholder="assets/step-1.jpg" /> : null}
      {mode !== 'none' ? (
        <div className="kf-grid2">
          <Row label={t('超时（秒）', 'Timeout (s)')}><NumberInput value={value.timeoutSec} onCommit={timeoutSec => props.onChange({ ...value, timeoutSec: Number(timeoutSec ?? 12) })} /></Row>
          <Row label={t('稳定等待（毫秒）', 'Settle (ms)')}><NumberInput value={value.settleMs} onCommit={settleMs => props.onChange({ ...value, settleMs: Number(settleMs ?? 800) })} /></Row>
        </div>
      ) : null}
    </div>
  );
}

function ConfigField(props: { field: FieldSpec; node: FlowNodeDoc; set: (patch: Record<string, any>) => void; t: Translate; workflows: Array<{ id: string; name: string }> }): ReactNode {
  const { field, node, set, t } = props;
  const value = node.config?.[field.key];
  const label = t(field.label[0], field.label[1]) + (field.required ? ' *' : '');
  const help = field.help ? t(field.help[0], field.help[1]) : undefined;
  if (field.kind === 'condition') {
    if (!field.required && value === undefined) {
      return <Row label={label} help={help}><button type="button" className="kf-btn kf-btn-ghost" onClick={() => set({ [field.key]: { expr: 'true' } })}>+ {t('添加条件', 'Add condition')}</button></Row>;
    }
    return (
      <Row label={label} help={help} wide>
        <ConditionEditor value={value} onChange={next => set({ [field.key]: next })} t={t} />
        {!field.required ? <button type="button" className="kf-link" onClick={() => set({ [field.key]: undefined })}>{t('移除条件', 'Remove condition')}</button> : null}
      </Row>
    );
  }
  if (field.kind === 'map') {
    if (node.type === 'switch') {
      return <Row label={label} help={help} wide><MapEditor keyIsPort value={value ?? {}} t={t} onChange={cases => set({ cases })} makeValue={() => ({ vision: t('画面上出现了……', 'The screen shows …') })} renderValue={(condition, update) => <ConditionEditor value={condition} onChange={update} t={t} />} /></Row>;
    }
    if (node.type === 'vision_classify') {
      return <Row label={label} help={help} wide><MapEditor keyIsPort value={value ?? {}} t={t} onChange={labels => set({ labels })} makeValue={() => t('这一类画面的描述', 'What this screen looks like')} renderValue={(text, update) => <Text multiline rows={2} value={String(text ?? '')} onCommit={update} />} /></Row>;
    }
    return <Row label={label} help={help} wide><MapEditor value={value ?? {}} t={t} onChange={next => set({ [field.key]: next })} makeValue={() => ''} renderValue={(text, update) => <Text mono value={String(text ?? '')} onCommit={update} placeholder="{{vars.x}}" />} /></Row>;
  }
  if (field.kind === 'list') {
    return <Row label={label} help={help} wide><ListEditor port={node.type === 'human'} value={value ?? []} t={t} onChange={next => set({ [field.key]: next })} /></Row>;
  }
  if (field.kind === 'number') {
    return <Row label={label} help={help}><NumberInput value={value} min={field.min} max={field.max} onCommit={next => set({ [field.key]: next })} /></Row>;
  }
  if (field.kind === 'boolean') {
    return <label className="kf-check"><input type="checkbox" checked={value === true} onChange={event => set({ [field.key]: event.target.checked })} />{label}</label>;
  }
  if (field.kind === 'select') {
    return (
      <Row label={label} help={help}>
        <select className="kf-input kf-select" value={String(value ?? field.options?.[0] ?? '')} onChange={event => set({ [field.key]: event.target.value })}>
          {(field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </Row>
    );
  }
  if (node.type === 'subflow' && field.key === 'workflow') {
    return (
      <Row label={label} help={help} wide>
        <select className="kf-input kf-select" value={String(value ?? '')} onChange={event => set({ workflow: event.target.value })}>
          {props.workflows.some(entry => entry.id === value) ? null : <option value={String(value ?? '')}>{String(value ?? '')}</option>}
          {props.workflows.map(entry => <option key={entry.id} value={entry.id}>{entry.name} — {entry.id}</option>)}
        </select>
      </Row>
    );
  }
  return (
    <Row label={label} help={help} wide={field.kind === 'text'}>
      <Text multiline={field.kind === 'text'} mono={field.kind === 'expression'} value={String(value ?? '')} onCommit={next => set({ [field.key]: next })} placeholder={field.placeholder} />
    </Row>
  );
}

export interface NodeInspectorProps {
  doc: FlowDoc;
  nodeId: string;
  spec?: NodeTypeSpec;
  issues: FlowIssue[];
  t: Translate;
  workflows: Array<{ id: string; name: string }>;
  onChange: (node: FlowNodeDoc) => void;
  onRename: (to: string) => void;
  onDelete: () => void;
  onSetStart: () => void;
  onConnect: (port: string, target: string | undefined) => void;
  testing: boolean;
  testResult?: { port?: string; reason?: string; output?: unknown; after?: string; before?: string; durationMs?: number; error?: string };
  onTest?: () => void;
  testDisabledReason?: string;
  renderThumb: (path: string | undefined, label: string) => any;
}

export function NodeInspector(props: NodeInspectorProps): ReactNode {
  const { doc, nodeId, spec, t } = props;
  const node = doc.nodes[nodeId];
  if (node === undefined) return null;
  const ports = portsFor(spec, node.config ?? {});
  const set = (patch: Record<string, any>): void => {
    const config = { ...(node.config ?? {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete config[key];
      else config[key] = value;
    }
    const updated = { ...node, config };
    props.onChange(pruneEdges(updated, portsFor(spec, config)));
  };
  const others = Object.entries(doc.nodes).filter(([id]) => id !== nodeId);
  return (
    <div className="kf-inspector-body">
      <div className="kf-inspector-head">
        <div>
          <div className="kf-inspector-kind">{spec ? t(spec.label[0], spec.label[1]) : node.type}</div>
          <div className="kf-hint">{spec ? t(spec.description[0], spec.description[1]) : ''}</div>
        </div>
        {doc.start === nodeId
          ? <span className="kf-badge kf-badge-start">{t('起点', 'START')}</span>
          : <button type="button" className="kf-btn kf-btn-ghost" onClick={props.onSetStart}>{t('设为起点', 'Set as start')}</button>}
      </div>
      {props.issues.length > 0 ? (
        <ul className="kf-issue-list">
          {props.issues.map((issue, index) => <li key={index} className={issue.severity}>{issue.message}</li>)}
        </ul>
      ) : null}
      <Section title={t('基本', 'Basics')}>
        <Row label={t('名称', 'Name')}><Text value={node.name} onCommit={name => props.onChange({ ...node, name })} /></Row>
        <Row label="ID" help={t('字母开头，可含数字、- 和 _；被表达式 nodes.<id> 引用。', 'Starts with a letter; letters, digits, - and _. Referenced as nodes.<id>.')}>
          <Text mono value={nodeId} onCommit={to => { if (NAME_PATTERN.test(to) && !Object.hasOwn(doc.nodes, to)) props.onRename(to); }} />
        </Row>
        <Row label={t('说明', 'Description')} wide><Text multiline rows={2} value={node.description ?? ''} onCommit={description => props.onChange({ ...node, ...(description === '' ? { description: undefined } : { description }) })} /></Row>
      </Section>
      <Section title={t('配置', 'Configuration')}>
        {spec?.action ? <ActionFields node={node} set={set} t={t} /> : (spec?.fields ?? []).map(field => <ConfigField key={field.key} field={field} node={node} set={set} t={t} workflows={props.workflows} />)}
      </Section>
      {spec?.action && node.type !== 'delay' ? (
        <Section title={t('前置条件与验证', 'Guards')} open={node.verify?.mode !== undefined && node.verify.mode !== 'none' || node.precondition !== undefined}>
          <Row label={t('执行前检查', 'Before acting')} wide><VerifyEditor kind="precondition" value={node.precondition} onChange={precondition => props.onChange({ ...node, ...(precondition === undefined ? { precondition: undefined } : { precondition }) })} t={t} /></Row>
          <Row label={t('执行后验证', 'After acting')} wide><VerifyEditor kind="verify" value={node.verify} onChange={verify => props.onChange({ ...node, verify: verify ?? { mode: 'none' } })} t={t} /></Row>
        </Section>
      ) : null}
      {ports.length > 0 ? (
        <Section title={t('连接', 'Connections')} aside={<span className="kf-hint">{t('也可以在画布上拖动连线', 'or drag on the canvas')}</span>}>
          {ports.map(port => (
            <Row key={port.name} label={`${portLabel(port, t)}${port.optional ? '' : ' *'}`}>
              <select className="kf-input kf-select" value={node.next?.[port.name] ?? ''} onChange={event => props.onConnect(port.name, event.target.value === '' ? undefined : event.target.value)}>
                <option value="">{port.optional ? t('— 未连接（运行到这里会暂停）', '— not connected (the run pauses here)') : t('— 未连接', '— not connected')}</option>
                {others.map(([id, other]) => <option key={id} value={id}>{other.name || id} · {id}</option>)}
                <option value={nodeId}>{t('（回到自己）', '(this node)')}</option>
              </select>
            </Row>
          ))}
        </Section>
      ) : null}
      <Section title={t('失败与上限', 'Failures & limits')} open={node.retry.times > 0 || node.maxVisits !== 100}>
        <div className="kf-grid2">
          <Row label={t('失败重试次数', 'Retries')}><NumberInput value={node.retry.times} onCommit={times => props.onChange({ ...node, retry: { ...node.retry, times: Math.max(0, Math.floor(Number(times ?? 0))) } })} /></Row>
          <Row label={t('重试间隔（毫秒）', 'Retry delay (ms)')}><NumberInput value={node.retry.delayMs} onCommit={delayMs => props.onChange({ ...node, retry: { ...node.retry, delayMs: Math.max(0, Number(delayMs ?? 0)) } })} /></Row>
          <Row label={t('最多进入次数', 'Max visits')} help={t('防止回边死循环；超出时走“出错”出口。', 'Stops runaway back edges; exceeding it takes the error port.')}><NumberInput value={node.maxVisits} onCommit={maxVisits => props.onChange({ ...node, maxVisits: Math.max(1, Math.floor(Number(maxVisits ?? 100))) })} /></Row>
        </div>
      </Section>
      {props.onTest !== undefined ? (
        <Section title={t('单独试运行', 'Test this node')}>
          <p className="kf-hint">{spec?.action ? t('会真实向目标机发送键鼠操作。', 'This really sends input to the target.') : t('只读取画面并调用模型，不会操作目标机。', 'Reads the screen and calls the model; sends no input.')}</p>
          <button type="button" className="kf-btn" disabled={props.testing || props.testDisabledReason !== undefined} title={props.testDisabledReason} onClick={props.onTest}>
            {props.testing ? t('试运行中…', 'Testing…') : t('在目标机上试运行', 'Run on the target')}
          </button>
          {props.testResult !== undefined ? (
            <div className={`kf-test-result${props.testResult.error ? ' err' : ''}`}>
              {props.testResult.error ? <div>{props.testResult.error}</div> : (
                <>
                  <div><b>{t('出口', 'Port')}:</b> {props.testResult.port === undefined ? '—' : portLabel({ name: props.testResult.port }, t)}{props.testResult.durationMs === undefined ? '' : ` · ${props.testResult.durationMs} ms`}</div>
                  {props.testResult.reason ? <div className="kf-hint">{props.testResult.reason}</div> : null}
                  {props.testResult.output !== undefined ? <pre className="kf-pre">{JSON.stringify(props.testResult.output, null, 2)}</pre> : null}
                  <div className="kf-thumbs">
                    {props.testResult.before ? props.renderThumb(props.testResult.before, t('执行前', 'before')) : null}
                    {props.testResult.after ? props.renderThumb(props.testResult.after, t('画面', 'screen')) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </Section>
      ) : null}
      <div className="kf-inspector-foot">
        <button type="button" className="kf-btn kf-btn-danger" onClick={props.onDelete}>{t('删除节点', 'Delete node')}</button>
      </div>
    </div>
  );
}

/** Document settings shown when no node is selected. */
export function DocumentInspector(props: { doc: FlowDoc; issues: FlowIssue[]; t: Translate; onChange: (doc: FlowDoc) => void; onSelectNode: (id: string) => void }): ReactNode {
  const { doc, t } = props;
  const setInputs = (inputs: Record<string, FlowInputSpec>): void => props.onChange({ ...doc, inputs });
  const docIssues = props.issues;
  return (
    <div className="kf-inspector-body">
      <div className="kf-inspector-head">
        <div>
          <div className="kf-inspector-kind">{t('工作流设置', 'Workflow settings')}</div>
          <div className="kf-hint">{t('选中节点可编辑节点；这里是整份工作流的设置。', 'Select a node to edit it; these settings apply to the whole workflow.')}</div>
        </div>
      </div>
      {docIssues.length > 0 ? (
        <Section title={t(`问题（${docIssues.length}）`, `Issues (${docIssues.length})`)}>
          <ul className="kf-issue-list">
            {docIssues.map((issue, index) => (
              <li key={index} className={issue.severity}>
                {issue.nodeId ? <button type="button" className="kf-link" onClick={() => props.onSelectNode(issue.nodeId as string)}>{issue.nodeId}</button> : null}
                {' '}{issue.message}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title={t('基本', 'Basics')}>
        <Row label={t('名称', 'Name')}><Text value={doc.name} onCommit={name => props.onChange({ ...doc, name })} /></Row>
        <Row label={t('说明', 'Description')} wide><Text multiline rows={3} value={doc.description ?? ''} onCommit={description => props.onChange({ ...doc, ...(description === '' ? { description: undefined } : { description }) })} /></Row>
      </Section>
      <Section title={t('运行输入', 'Run inputs')} open={Object.keys(doc.inputs ?? {}).length > 0} aside={<span className="kf-hint">{'{{inputs.name}}'}</span>}>
        <MapEditor
          keyIsPort
          t={t}
          value={doc.inputs ?? {}}
          onChange={inputs => setInputs(inputs as Record<string, FlowInputSpec>)}
          makeValue={() => ({ type: 'string', required: true })}
          renderValue={(spec: FlowInputSpec, update) => (
            <div className="kf-inline">
              <select className="kf-input kf-select" value={spec.type} onChange={event => update({ ...spec, type: event.target.value })}>
                <option value="string">{t('文本', 'text')}</option>
                <option value="secret">{t('密码（不落盘）', 'secret (never stored)')}</option>
                <option value="number">{t('数字', 'number')}</option>
                <option value="boolean">{t('是/否', 'boolean')}</option>
              </select>
              <label className="kf-check"><input type="checkbox" checked={spec.required !== false} onChange={event => update({ ...spec, required: event.target.checked })} />{t('必填', 'required')}</label>
            </div>
          )}
        />
      </Section>
      <Section title={t('初始变量', 'Variables')} open={Object.keys(doc.vars ?? {}).length > 0} aside={<span className="kf-hint">{'{{vars.name}}'}</span>}>
        <JsonEditor value={doc.vars ?? {}} rows={4} t={t} onChange={vars => props.onChange({ ...doc, vars: vars ?? {} })} />
      </Section>
      <Section title={t('BIOS 前奏', 'BIOS prelude')} open={doc.bios !== undefined}>
        <label className="kf-check">
          <input type="checkbox" checked={doc.bios !== undefined} onChange={event => props.onChange(event.target.checked
            ? { ...doc, bios: { hotkey: 'F2', intervalMs: 1200, timeoutSec: 180, requireConfirm: false, settleSec: 2 } }
            : { ...doc, bios: undefined })} />
          {t('开机前持续按热键，等到有画面后再开始', 'Tap a hotkey before power-on and start once video appears')}
        </label>
        {doc.bios !== undefined ? (
          <div className="kf-grid2">
            <Row label={t('热键', 'Hotkey')}><Text mono value={doc.bios.hotkey} onCommit={hotkey => props.onChange({ ...doc, bios: { ...doc.bios!, hotkey } })} /></Row>
            <Row label={t('间隔（毫秒）', 'Interval (ms)')}><NumberInput value={doc.bios.intervalMs} onCommit={intervalMs => props.onChange({ ...doc, bios: { ...doc.bios!, intervalMs: Number(intervalMs ?? 1200) } })} /></Row>
            <Row label={t('等待开机（秒）', 'Wait for power (s)')}><NumberInput value={doc.bios.timeoutSec} onCommit={timeoutSec => props.onChange({ ...doc, bios: { ...doc.bios!, timeoutSec: Number(timeoutSec ?? 180) } })} /></Row>
            <label className="kf-check"><input type="checkbox" checked={doc.bios.requireConfirm} onChange={event => props.onChange({ ...doc, bios: { ...doc.bios!, requireConfirm: event.target.checked } })} />{t('进入后人工确认', 'Confirm manually')}</label>
          </div>
        ) : null}
      </Section>
      <Section title={t('安全上限', 'Limits')} open={false}>
        <div className="kf-grid2">
          <Row label={t('节点访问总数', 'Node visits')}><NumberInput value={doc.limits.maxNodeVisits} onCommit={value => props.onChange({ ...doc, limits: { ...doc.limits, maxNodeVisits: Number(value ?? 1000) } })} /></Row>
          <Row label={t('视觉调用次数', 'Vision calls')}><NumberInput value={doc.limits.maxVisionCalls} onCommit={value => props.onChange({ ...doc, limits: { ...doc.limits, maxVisionCalls: Number(value ?? 400) } })} /></Row>
          <Row label={t('总时长（秒）', 'Timeout (s)')}><NumberInput value={doc.limits.timeoutSec} onCommit={value => props.onChange({ ...doc, limits: { ...doc.limits, timeoutSec: Number(value ?? 7200) } })} /></Row>
        </div>
      </Section>
    </div>
  );
}
