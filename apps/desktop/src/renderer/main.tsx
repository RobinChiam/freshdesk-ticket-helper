/**
 * Renderer entry — React UI only. No Node APIs; all I/O goes through window.desktopApi.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
