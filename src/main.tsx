import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './App.css';
import { hydrateFromServer, installStoreSync } from './services/serverStore';

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </HashRouter>
    </StrictMode>,
  );

  // Auto-update service worker when new version is available
  registerSW({ immediate: true });
}

// Under HA Ingress, pull durable config from the add-on's /data before the app
// reads localStorage; then start mirroring local writes back. Outside Ingress
// both calls are no-ops and render happens immediately.
hydrateFromServer()
  .catch(() => {})
  .finally(() => {
    installStoreSync();
    render();
  });
