/**
 * UI entry point. No StrictMode: the engine is a singleton with an AudioContext;
 * dev double-invocation buys nothing here and risks double pumps.
 */

import { createRoot } from 'react-dom/client';
import { installGlobalErrorHandlers } from './errorLog';

// Wire window 'error' + 'unhandledrejection' to the visible ErrorOverlay BEFORE first
// render, so a startup throw or a silent rAF/audio failure surfaces instead of vanishing.
installGlobalErrorHandlers();

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
const reactRoot = createRoot(root);

// App is dynamically imported so the engine module graph is pulled in only for the
// console window — the seam the Phase 2 dev-harness route (#/dev/audio-tests) plugs
// into without dragging the engine into the harness chunk.
void import('./App').then(({ App }) => reactRoot.render(<App />));
