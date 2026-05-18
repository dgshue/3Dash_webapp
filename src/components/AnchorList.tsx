import type { AnchorConfig } from '../types';

interface Props {
  anchors: AnchorConfig[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  onDelete: (idx: number) => void;
  onDuplicate: (idx: number) => void;
}

export default function AnchorList({ anchors, selectedIdx, onSelect, onDelete, onDuplicate }: Props) {
  if (anchors.length === 0) {
    return (
      <div className="list-empty">
        No anchors configured.<br />
        Click <strong>Add Anchor</strong> to place one, or open the dashboard
        to auto-discover ESPHome anchors from Home Assistant.
      </div>
    );
  }

  return (
    <>
      {anchors.map((a, i) => (
        <div
          key={a.deviceId}
          className={`light-item${selectedIdx === i ? ' selected' : ''}`}
          onClick={() => onSelect(i)}
        >
          <div
            className="light-item-icon"
            style={{ color: '#22d3ee', textShadow: '0 0 6px #22d3ee' }}
          >
            {'▼'}
          </div>
          <div className="light-item-info">
            <div className="light-item-name">{a.label || a.deviceId}</div>
            <div className="light-item-meta">
              {a.deviceId} &middot; floor: {a.floor}
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
      ))}
    </>
  );
}
