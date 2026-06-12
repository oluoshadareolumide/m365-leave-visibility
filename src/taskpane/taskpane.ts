import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { installMockOffice } from './devMockOffice';
import './styles/taskpane.css';

/* global Office */

declare const __DEV_MODE__: boolean;

function boot(): void {
  const container = document.getElementById('root');
  if (!container) return;
  const root = createRoot(container);
  root.render(React.createElement(App));
}

if (typeof __DEV_MODE__ !== 'undefined' && __DEV_MODE__) {
  // Local dev build: no Office host and no SSO. Install a mock Office runtime
  // and render directly so the taskpane works in a plain browser.
  installMockOffice();
  boot();
} else {
  Office.onReady(() => boot());
}
