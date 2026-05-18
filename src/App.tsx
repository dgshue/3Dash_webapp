import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { DemoModeProvider } from './contexts/DemoModeContext';
import { SimulationModeProvider, useSimulationMode } from './contexts/SimulationModeContext';
import { CameraControlsProvider } from './contexts/CameraControlsContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { hasConfig, getConfig } from './services/configApi';
import { applyEmbedBodyClass } from './utils/embedMode';
import Dashboard from './pages/Dashboard/Dashboard';

const ConfigEditor = lazy(() => import('./pages/ConfigEditor/ConfigEditor'));
const Onboarding = lazy(() => import('./pages/Onboarding/Onboarding'));

function AppRoutes() {
  const location = useLocation();
  const { simulationMode } = useSimulationMode();

  // No config at all → onboarding. Config exists but not completed → onboarding.
  const configExists = hasConfig();
  const onboardingDone = configExists && (getConfig().onboarding?.completed ?? false);

  // Redirect to onboarding if not completed and not already there
  // (simulation mode bypasses onboarding)
  if (!onboardingDone && !simulationMode && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/editor" element={<Suspense fallback={null}><ConfigEditor /></Suspense>} />
      <Route path="/onboarding" element={<Suspense fallback={null}><Onboarding /></Suspense>} />
    </Routes>
  );
}

export default function App() {
  useEffect(() => {
    return applyEmbedBodyClass();
  }, []);
  return (
    <ThemeProvider>
      <DemoModeProvider>
        <SimulationModeProvider>
          <CameraControlsProvider>
            <AppRoutes />
          </CameraControlsProvider>
        </SimulationModeProvider>
      </DemoModeProvider>
    </ThemeProvider>
  );
}
