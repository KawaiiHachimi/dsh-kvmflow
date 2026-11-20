/** Keeps a failure inside the editor from taking down the whole KVMFlow panel. */
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  message: string;
  retryLabel: string;
}

export class FlowBoundary extends Component<Props, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[kvmflow] editor crashed:', error);
  }

  render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    return (
      <div className="kf-empty">
        <p className="kf-hint">{this.props.message}</p>
        <pre className="kf-pre">{this.state.error.message}</pre>
        <button type="button" className="kf-btn" onClick={() => this.setState({ error: undefined })}>{this.props.retryLabel}</button>
      </div>
    );
  }
}
