import { useRef, useState, useEffect, useCallback } from 'react';
import type { SidePanelConfig, SidePanelCard, HAState, CardLayout } from '../../types';
import type { HALike } from '../../services/haWebSocket';
import CardGrid from './CardGrid';
import './SidePanel.css';

interface Props {
  config: SidePanelConfig | undefined;
  ha: HALike | null;
  cardStates: Record<string, HAState>;
  onSettingsOpen?: () => void;
  /** Current panel size in px (width on desktop, height on mobile). */
  panelSize: number;
  /** Called while dragging the resize handle. */
  onPanelResize: (size: number) => void;
  editMode?: boolean;
  onEditDone?: () => void;
  onLayoutChange?: (layouts: Record<string, CardLayout>) => void;
  onSetTemperature?: (entityId: string, temperature: number) => void;
  onSetHvacMode?: (entityId: string, mode: string) => void;
  onCardEdit?: (card: SidePanelCard) => void;
  onCardDelete?: (cardId: string) => void;
  onCardAdd?: () => void;
  onExitSimulation?: () => void;
}

const PANEL_PADDING = 24; // 12px each side

export default function SidePanel({ config, ha, cardStates, onSettingsOpen, panelSize, onPanelResize, editMode, onEditDone, onLayoutChange, onSetTemperature, onSetHvacMode, onCardEdit, onCardDelete, onCardAdd, onExitSimulation }: Props) {
  const innerRef = useRef<HTMLDivElement>(null);
  const gridWidth = panelSize - PANEL_PADDING;
  const [gridHeight, setGridHeight] = useState(200);
  const dragging = useRef(false);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setGridHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Detect mobile layout (matches CSS media query)
  const isMobile = useCallback(() => window.matchMedia('(max-width: 768px)').matches, []);

  // Drag handling — works for both mouse and touch
  const onDragStart = useCallback((startX: number, startY: number) => {
    dragging.current = true;
    const startSize = panelSize;
    const mobile = isMobile();

    const onMove = (clientX: number, clientY: number) => {
      if (!dragging.current) return;
      if (mobile) {
        // Dragging up = larger panel (startY is at bottom edge going up)
        const newSize = startSize + (startY - clientY);
        onPanelResize(Math.max(120, Math.min(newSize, window.innerHeight * 0.7)));
      } else {
        // Dragging right = larger panel
        const newSize = startSize + (clientX - startX);
        onPanelResize(Math.max(350, Math.min(newSize, window.innerWidth * 0.5)));
      }
    };

    const onEnd = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', onEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const handleMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    document.body.style.cursor = mobile ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelSize, onPanelResize, isMobile]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onDragStart(e.clientX, e.clientY);
  }, [onDragStart]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      onDragStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, [onDragStart]);

  // The panel only earns its rail when it has cards to show or is being edited.
  // Otherwise it collapses to nothing and the Settings gear floats in a corner,
  // so an unconfigured dashboard doesn't show an empty bar down the left edge.
  const hasContent = !!(config && config.cards.length > 0) || !!editMode;

  return (
    <div
      className={`side-panel${hasContent ? '' : ' side-panel--collapsed'}`}
      style={hasContent ? { width: `${panelSize}px` } : undefined}
    >
      <div className="side-panel-inner" ref={innerRef}>
        <div className="side-panel-content">
          {config && config.cards.length > 0 && (
            <CardGrid
              config={config}
              ha={ha}
              cardStates={cardStates}
              width={gridWidth}
              height={gridHeight}
              editMode={editMode}
              onLayoutChange={onLayoutChange}
              onSetTemperature={onSetTemperature}
              onSetHvacMode={onSetHvacMode}
              onCardEdit={onCardEdit}
              onCardDelete={onCardDelete}
            />
          )}
          {editMode ? (
            <>
              <button className="side-panel-add-btn" onClick={onCardAdd}>
                + Add Card
              </button>
              <button className="side-panel-done-btn" onClick={onEditDone}>
                Done
              </button>
            </>
          ) : (
            <>
              {onSettingsOpen && (
                <button className="side-panel-settings-btn" onClick={onSettingsOpen}>
                  &#9881; Settings
                </button>
              )}
              {onExitSimulation && (
                <button className="side-panel-exit-sim-btn" onClick={onExitSimulation}>
                  Exit Demo
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {hasContent && (
        <div
          className="side-panel-handle"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          <div className="side-panel-handle-bar" />
        </div>
      )}
    </div>
  );
}
