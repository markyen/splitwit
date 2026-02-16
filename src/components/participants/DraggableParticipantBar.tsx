'use client';

import { Participant } from '@/types';
import { DraggableParticipantPill } from './DraggableParticipantPill';

interface DraggableParticipantBarProps {
  participants: Participant[];
  showEverybody: boolean;
  onTap: () => void;
}

export function DraggableParticipantBar({
  participants,
  showEverybody,
  onTap,
}: DraggableParticipantBarProps) {
  if (participants.length === 0) {
    return (
      <button
        onClick={onTap}
        className="w-full rounded-lg border-2 border-dashed border-gray-300 p-4 text-center text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors"
      >
        Tap to add participants
      </button>
    );
  }

  return (
    <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
      <p className="text-xs text-gray-500 mb-2">Drag participants to items below</p>
      <div className="flex flex-wrap gap-2">
        {showEverybody && (
          <DraggableParticipantPill participant="everyone" />
        )}
        {participants.map((participant, index) => (
          <DraggableParticipantPill
            key={participant.id}
            participant={participant}
            isPayer={index === 0}
          />
        ))}
      </div>
    </div>
  );
}
