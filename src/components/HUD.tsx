import { useState, useEffect, useRef } from 'react';
import type { DirectionalLight, HemisphericLight } from '@babylonjs/core';
import { updateSunPosition, minutesToLabel } from '../babylon/SunController';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useSimulationMode } from '../contexts/SimulationModeContext';
import { useTheme } from '../contexts/ThemeContext';
import { getSetting } from '../services/settingsStore';
import { LOGO_2D_VIEWBOX, LOGO_2D_SLASHES } from './logoData';
import './HUD.css';

interface Props {
  latitude: number;
  longitude: number;
  northOffset: number;
  sunLight: DirectionalLight | null;
  hemiLight: HemisphericLight | null;

  /* Sun state (lifted to parent for settings modal) */
  sunLiveMode: boolean;
  sliderValue: number;
  scrubberTime: string;
  onSunLiveModeChange: (live: boolean) => void;
  onSliderValueChange: (mins: number) => void;
  onScrubberTimeChange: (time: string) => void;
  cloudCoverFactor?: number;
}

export default function HUD({
  latitude,
  longitude,
  northOffset,
  sunLight,
  hemiLight,
  sunLiveMode,
  sliderValue,
  scrubberTime,
  onSunLiveModeChange,
  onSliderValueChange,
  onScrubberTimeChange,
  cloudCoverFactor,
}: Props) {
  const { demoMode } = useDemoMode();
  const { simulationMode } = useSimulationMode();
  const { updateAutoTheme } = useTheme();
  const [hudVisible, setHudVisible] = useState(() => getSetting('appearance').hudVisible);
  const [clock, setClock] = useState('--:--');
  const [date, setDate] = useState('---');

  useEffect(() => {
    const handler = () => setHudVisible(getSetting('appearance').hudVisible);
    window.addEventListener('appearance-changed', handler);
    return () => window.removeEventListener('appearance-changed', handler);
  }, []);
  const sunLiveModeRef = useRef(sunLiveMode);
  sunLiveModeRef.current = sunLiveMode;

  // Clock update
  useEffect(() => {
    function tick() {
      const now = new Date();
      setClock(now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      setDate(now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Sun position update
  useEffect(() => {
    if (!sunLight || !hemiLight) return;

    function sunTick() {
      if (!sunLiveModeRef.current || !sunLight || !hemiLight) return;
      const now = new Date();
      const liveMin = now.getHours() * 60 + now.getMinutes();
      onSliderValueChange(liveMin);
      onScrubberTimeChange(minutesToLabel(liveMin));
      updateSunPosition(sunLight, hemiLight, latitude, longitude, undefined, northOffset, cloudCoverFactor);
      updateAutoTheme();
    }

    sunTick();
    const id = setInterval(sunTick, 60000);
    return () => clearInterval(id);
  }, [sunLight, hemiLight, latitude, longitude, northOffset, cloudCoverFactor, onSliderValueChange, onScrubberTimeChange, updateAutoTheme]);

  if (!hudVisible) return null;

  return (
    <div className="hud">
      <div className="corner tl" />
      <div className="corner tr" />
      <div className="corner bl" />
      <div className="corner br" />

      <div className={`title-bar${simulationMode || demoMode ? ' demo' : ''}`}>
        <svg className="hud-logo" viewBox={LOGO_2D_VIEWBOX} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="hud-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="b1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="30" result="b2" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="50" result="b3" />
              <feMerge>
                <feMergeNode in="b3" />
                <feMergeNode in="b2" />
                <feMergeNode in="b1" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {LOGO_2D_SLASHES.map((p, i) => (
            <polygon key={i} points={p} className="hud-logo-front" />
          ))}
          <g filter="url(#hud-glow)" className="hud-logo-glow">
            {LOGO_2D_SLASHES.map((p, i) => (
              <polygon key={i} points={p} fill="none" strokeWidth="6" strokeLinejoin="round" />
            ))}
          </g>
        </svg>
        <div className="label">{'3Dash'}<span className="label-sep">{' · '}</span>{simulationMode || demoMode ? 'Demo View' : 'Live View'}</div>
      </div>

      <div className="time-display">
        <div className="time">{clock}</div>
        <div className="date">{date}</div>
      </div>
    </div>
  );
}
