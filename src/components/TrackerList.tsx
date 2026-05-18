import type { TrackerConfig } from '../types';

interface Props {
  trackers: TrackerConfig[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  onDelete: (idx: number) => void;
  onDuplicate: (idx: number) => void;
}

export default function TrackerList({ trackers, selectedIdx, onSelect, onDelete, onDuplicate }: Props) {
  if (trackers.length === 0) {
    return (
      <div className="list-empty">
        No trackers configured.<br />
        Click <strong>Add Tracker</strong> to place one, or open the dashboard to auto-discover BLE devices.
      </div>
    );
  }

  return (
    <>
      {trackers.map((t, i) => {
        const roomCount = Object.keys(t.areaPositions || {}).length;
        return (
          <div
            key={t.entityId}
            className={`light-item${selectedIdx === i ? ' selected' : ''}`}
            onClick={() => onSelect(i)}
          >
            <div
              className="light-item-icon"
              style={{
                color: t.color ?? '#4ade80',
                textShadow: `0 0 6px ${t.color ?? '#4ade80'}`,
              }}
            >
              {'●'}
            </div>
            <div className="light-item-info">
              <div className="light-item-name">{t.label || t.entityId}</div>
              <div className="light-item-meta">
                {t.entityId} &middot; {roomCount} room{roomCount === 1 ? '' : 's'}
                {t.areaEntityId ? ` · ${t.areaEntityId}` : ''}
              </div>
            </div>
            <button
              className="light-item-dup"
              title="Duplicate"
              onClick={(e) => { e.stopPropagation(); onDuplicate(i); }}
            >
              &#x29C9;
            </button>
            <button
              className="light-item-del"
              onClick={(e) => { e.stopPropagation(); onDelete(i); }}
            >
              &times;
            </button>
          </div>
        );
      })}
    </>
  );
}
