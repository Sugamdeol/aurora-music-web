import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { failed: boolean; }

/** Keeps a failed lazy route from blanking the whole app; retry reloads its chunk. */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Aurora route failed to render:', error, info.componentStack);
  }

  retry = (): void => {
    this.setState({ failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <section className="page route-error" role="alert">
      <h1>This page could not be opened.</h1>
      <p>Your library and playback are still here. Try loading the page again.</p>
      <button className="primary-button" onClick={this.retry}>Retry page</button>
    </section>;
  }
}
