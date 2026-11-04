import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

interface Props {
  children: ReactNode;
  /** Shown above the message, e.g. which area of the editor failed. */
  area?: string;
}

interface State {
  error: Error | null;
}

/** Catches render errors in a region so one broken panel doesn't take down the whole editor. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.area ?? 'app'}]`, error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">{this.props.area ?? 'Something'} failed to load</p>
        <p className="max-w-sm text-fg-muted">{this.state.error.message}</p>
        <button
          type="button"
          className="rounded bg-accent px-3 py-1.5 font-medium hover:bg-accent-hover"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}

export function RouteError({ notFound = false }: { notFound?: boolean }) {
  const error = useRouteError();
  const is404 = notFound || (isRouteErrorResponse(error) && error.status === 404);
  const message = is404
    ? 'This page does not exist.'
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-app text-center">
      <h1 className="text-base font-semibold">{is404 ? 'Not found' : 'Something went wrong'}</h1>
      <p className="text-fg-muted">{message}</p>
      <Link to="/" className="rounded bg-accent px-3 py-1.5 font-medium hover:bg-accent-hover">
        Go to your files
      </Link>
    </div>
  );
}
