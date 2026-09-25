// Граница ошибок: вместо упавшего раздела — fallback(retry). retry() пробует отрисовать заново.
import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props { fallback: (retry: () => void) => ReactNode; children: ReactNode }
interface State { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  retry = () => { this.setState({ failed: false }); };

  render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}
