'use client';

import { useDraggable } from '@dnd-kit/core';
import { Participant, EVERYONE_MARKER } from '@/types';
import { getParticipantColorClasses } from '@/utils/colors';

interface DraggableParticipantPillProps {
  participant: Participant | 'everyone';
  isPayer?: boolean;
}

export function DraggableParticipantPill({
  participant,
  isPayer = false,
}: DraggableParticipantPillProps) {
  const isEveryone = participant === 'everyone';
  const id = isEveryone ? EVERYONE_MARKER : participant.id;
  const name = isEveryone ? 'Everybody' : participant.name;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: {
      type: 'participant',
      participant,
    },
  });

  const colorClasses = isEveryone
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : getParticipantColorClasses(name);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium cursor-grab active:cursor-grabbing touch-none select-none border ${
        isDragging ? 'opacity-50' : ''
      } ${colorClasses}`}
    >
      {isEveryone && <span className="text-xs mr-0.5">👥</span>}
      {!isEveryone && isPayer && <span className="text-xs mr-0.5">💰</span>}
      <span className="truncate max-w-[100px]">{name}</span>
    </div>
  );
}

// Overlay version for drag preview
export function ParticipantPillOverlay({
  participant,
  isPayer = false,
}: DraggableParticipantPillProps) {
  const isEveryone = participant === 'everyone';
  const name = isEveryone ? 'Everybody' : participant.name;

  const colorClasses = isEveryone
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : getParticipantColorClasses(name);

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium shadow-lg border ${colorClasses}`}
    >
      {isEveryone && <span className="text-xs mr-0.5">👥</span>}
      {!isEveryone && isPayer && <span className="text-xs mr-0.5">💰</span>}
      <span className="truncate max-w-[100px]">{name}</span>
    </div>
  );
}
