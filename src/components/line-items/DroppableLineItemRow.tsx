'use client';

import { useDroppable } from '@dnd-kit/core';
import { LineItem, Participant, EVERYONE_MARKER } from '@/types';

interface DroppableLineItemRowProps {
  item: LineItem;
  participants: Participant[];
  onEdit: () => void;
  onRemoveAssignment: (participantId: string) => void;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
}

export function DroppableLineItemRow({
  item,
  participants,
  onEdit,
  onRemoveAssignment,
  isSelectionMode,
  isSelected,
  onToggleSelect,
}: DroppableLineItemRowProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `lineitem-${item.id}`,
    data: {
      type: 'lineitem',
      lineItemId: item.id,
    },
  });

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price);
  };

  const hasEveryone = item.assignedTo.includes(EVERYONE_MARKER);
  const assignedParticipants = hasEveryone
    ? []
    : item.assignedTo
        .map((id) => participants.find((p) => p.id === id))
        .filter(Boolean) as Participant[];

  const handleRowClick = () => {
    if (isSelectionMode) {
      onToggleSelect();
    }
  };

  return (
    <div
      ref={setNodeRef}
      onClick={handleRowClick}
      className={`rounded-lg bg-white p-3 border-2 transition-colors ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : isOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-200 hover:border-gray-300'
      } ${isSelectionMode ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        {isSelectionMode && (
          <div className="flex items-center pt-0.5">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <button
            onClick={(e) => {
              if (!isSelectionMode) {
                onEdit();
              }
            }}
            className="text-left w-full"
            disabled={isSelectionMode}
          >
            <p className="font-medium text-gray-900 truncate">{item.name}</p>
          </button>

          {/* Assigned participants */}
          <div className="flex flex-wrap gap-1 mt-2 min-h-[28px]">
            {item.assignedTo.length === 0 ? (
              <span className="text-xs text-gray-400 py-1">
                Drag a participant here
              </span>
            ) : hasEveryone ? (
              <span
                onClick={() => onRemoveAssignment(EVERYONE_MARKER)}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 cursor-pointer hover:bg-blue-200"
              >
                👥 Everybody
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </span>
            ) : (
              assignedParticipants.map((p) => (
                <span
                  key={p.id}
                  onClick={() => onRemoveAssignment(p.id)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 cursor-pointer hover:bg-gray-200"
                >
                  {p.name}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
              ))
            )}
          </div>
        </div>

        <button
          onClick={onEdit}
          className="font-medium text-gray-900 shrink-0"
        >
          {formatPrice(item.price)}
        </button>
      </div>
    </div>
  );
}
