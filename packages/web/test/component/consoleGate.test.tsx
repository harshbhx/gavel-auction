import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';

describe('console token gate', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('renders the scripted demo console without a token', () => {
    const { container } = render(<App initialPath="/r/demo/console" gallery={false} />);
    expect(container.querySelector('[data-route="console"]')).not.toBeNull();
    expect(container.querySelector('[data-route="token-gate"]')).toBeNull();
  });

  it('still gates a live room that has no token', () => {
    const { container } = render(
      <App initialPath="/r/plain-room/console" gallery={false} liveBase="ws://localhost:1" />,
    );
    expect(container.querySelector('[data-route="token-gate"]')).not.toBeNull();
    expect(container.querySelector('[data-route="console"]')).toBeNull();
  });
});
