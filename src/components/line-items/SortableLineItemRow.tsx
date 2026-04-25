'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LineItem, Participant, EVERYONE_MARKER } from '@/types';
import {
  getParticipantActiveChipClassesForParticipant,
  getParticipantChipClassesForParticipant,
} from '@/utils/colors';

const EVERYONE_DEFAULT_CLASSES = 'border-slate-200 bg-slate-100 text-slate-700';
const EVERYONE_ACTIVE_CLASSES = 'border-slate-800 bg-slate-800 text-white';

interface SortableLineItemRowProps {
  item: LineItem;
  participants: Participant[];
  selectedParticipantId: string | null;
  onEdit: (field: 'name' | 'price') => void;
  onToggleAssignment: () => void;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
}

export function SortableLineItemRow({
  item,
  participants,
  selectedParticipantId,
  onEdit,
  onToggleAssignment,
  isSelectionMode,
  isSelected,
  onToggleSelect,
}: SortableLineItemRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: {
      type: 'sortable-lineitem',
      lineItemId: item.id,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

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
    } else if (selectedParticipantId) {
      onToggleAssignment();
    }
  };

  return (
    <div
      ref={setSortableRef}
      style={style}
      className={`${isDragging ? 'opacity-50 z-10' : ''}`}
    >
      <div
        onClick={handleRowClick}
        className={`rounded-lg bg-white p-3 border-2 transition-colors ${
          isSelected
            ? 'border-blue-500 bg-blue-50'
            : selectedParticipantId
              ? 'cursor-pointer border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
              : 'border-gray-200 hover:border-gray-300'
        } ${isSelectionMode ? 'cursor-pointer' : ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          {/* Drag handle - only show when not in selection mode */}
          {!isSelectionMode && (
            <div
              {...attributes}
              {...listeners}
              className="flex items-center pt-1 cursor-grab active:cursor-grabbing touch-none text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
              </svg>
            </div>
          )}

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
                e.stopPropagation();
                if (selectedParticipantId && !isSelectionMode) {
                  onToggleAssignment();
                } else if (!isSelectionMode) {
                  onEdit('name');
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
                  {selectedParticipantId ? 'Tap to assign selected chip' : 'No participants assigned'}
                </span>
              ) : hasEveryone ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs transition-all ${
                    selectedParticipantId === EVERYONE_MARKER
                      ? `font-bold shadow-sm ring-2 ring-black/10 ${EVERYONE_ACTIVE_CLASSES}`
                      : `font-medium ${EVERYONE_DEFAULT_CLASSES}`
                  }`}
                >
                  Everyone
                </span>
              ) : (
                assignedParticipants.map((p) => (
                  <span
                    key={p.id}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs transition-all ${
                      selectedParticipantId === p.id
                        ? `font-bold shadow-sm ring-2 ring-black/10 ${getParticipantActiveChipClassesForParticipant(p, participants)}`
                        : `font-medium ${getParticipantChipClassesForParticipant(p, participants)}`
                    }`}
                  >
                    {p.name}
                  </span>
                ))
              )}
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              if (selectedParticipantId && !isSelectionMode) {
                onToggleAssignment();
              } else if (!isSelectionMode) {
                onEdit('price');
              }
            }}
            disabled={isSelectionMode}
            className="font-medium text-gray-900 shrink-0"
          >
            {formatPrice(item.price)}
          </button>
        </div>
      </div>
    </div>
  );
}
