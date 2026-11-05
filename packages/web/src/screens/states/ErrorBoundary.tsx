import { Component, type ReactNode } from 'react';
import { t } from '../../copy/t';
import { SandboxBanner } from '../../design/SandboxBanner';
import { Button } from '../../design/primitives/Button';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly homeHref?: string;
  /** Test seam. Defaults to a full page reload. */
  readonly onReload?: () => void;
  /** Test seam for the displayed id. */
  readonly newId?: () => string;
}

interface BoundaryState {
  readonly errorId: string | null;
}

let counter = 0;
function defaultId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

/**
 * Catches render errors and shows the recovery screen with an error id (R-WEB-032).
 * Nothing is sent anywhere: the id is only shown so the user can quote it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, BoundaryState> {
  override state: BoundaryState = { errorId: null };
  private heading: HTMLHeadingElement | null = null;

  static getDerivedStateFromError(): BoundaryState {
    return { errorId: '' };
  }

  override componentDidCatch(): void {
    this.setState({ errorId: (this.props.newId ?? defaultId)() });
  }

  override componentDidUpdate(): void {
    this.heading?.focus();
  }

  override render(): ReactNode {
    const { errorId } = this.state;
    if (errorId === null) return this.props.children;
    return (
      <main data-route="error">
        <SandboxBanner />
        <h1
          ref={(el) => {
            this.heading = el;
          }}
          tabIndex={-1}
        >
          {t('err.boundary')}
        </h1>
        {errorId !== '' && <p>{t('err.boundaryId', { id: errorId })}</p>}
        <Button onClick={this.props.onReload ?? (() => window.location.reload())}>
          {t('err.reload')}
        </Button>
        <a href={this.props.homeHref ?? '/'}>{t('err.home')}</a>
      </main>
    );
  }
}

export default ErrorBoundary;
