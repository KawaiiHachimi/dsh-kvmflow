/** Bundle entry: the panel plus the graph editor, with React from the DSH page. */
import * as React from 'react';
import reactFlowCss from '@xyflow/react/dist/style.css';
import { createPlugin } from './app';
import { FlowEditor, RunGraph } from './flow/editor';
import { FlowBoundary } from './flow/boundary';
import type { FlowEditorProps, RunGraphProps } from './flow/types';
import { FLOW_CSS } from './flow/styles';

declare const require: (id: string) => unknown;

export const plugin = createPlugin(
  (id: string) => (id === 'react' ? React : require(id)),
  {
    FlowEditor: (props: FlowEditorProps) => (
      <FlowBoundary message={props.t('工作流编辑器出错了，工作流文件没有受影响。', 'The workflow editor failed; the workflow file is unaffected.')} retryLabel={props.t('重新加载编辑器', 'Reload the editor')}>
        <FlowEditor {...props} />
      </FlowBoundary>
    ),
    RunGraph: (props: RunGraphProps) => (
      <FlowBoundary message={props.t('流程图无法显示。', 'The run graph cannot be shown.')} retryLabel={props.t('重试', 'Retry')}>
        <RunGraph {...props} />
      </FlowBoundary>
    ),
    CSS: `${reactFlowCss}\n${FLOW_CSS}`,
  },
);
