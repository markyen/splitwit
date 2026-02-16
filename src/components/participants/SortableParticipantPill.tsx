'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Participant } from '@/types';
import { getParticipantColorClasses } from '@/utils/colors';

interface SortableParticipantPillProps {
  participant: Participant;
  isPayer: boolean;
  onRemove: () => void;
}

export function SortableParticipantPill({
  participant,
  isPayer,
  onRemove,
}: SortableParticipantPillProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: participant.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const colorClasses = getParticipantColorClasses(participant.name);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium touch-none border ${
        isDragging ? 'opacity-50 z-10' : ''
      } ${colorClasses}`}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing mr-1 text-gray-400"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
        </svg>
      </span>
      {isPayer && <span className="text-xs mr-0.5" title="Payer">💰</span>}
      <span className="truncate max-w-[100px]">{participant.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="ml-1 text-gray-400 hover:text-gray-600"
        aria-label={`Remove ${participant.name}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
