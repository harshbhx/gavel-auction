import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import './design/themes.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root element missing');
}
const root = container;

function showBootError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const box = document.createElement('pre');
  box.setAttribute('role', 'alert');
  box.textContent = message;
  root.replaceChildren(box);
}

// Validate configuration before the app loads; a bad config shows a readable list of names.
import('./config')
  .then(async ({ config }) => ({ config, ...(await import('./App')) }))
  .then(({ App, config }) => {
    createRoot(root).render(
      <StrictMode>
        <App liveBase={config.wsBase} />
      </StrictMode>,
    );
  })
  .catch(showBootError);
