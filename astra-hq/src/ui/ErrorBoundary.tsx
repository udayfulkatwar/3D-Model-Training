import { Component, type ReactNode } from 'react';

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode; fallback: (e: Error) => ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('ASTRA HQ render error:', error);
  }
  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

export function webglSupport(): { ok: true } | { ok: false; reason: string } {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return { ok: false, reason: 'WebGL is not available. Enable hardware acceleration in your browser settings, or try a recent Chrome, Edge, Firefox or Safari.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `WebGL initialisation failed: ${(e as Error).message}` };
  }
}
