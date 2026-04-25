'use client';

import { EVERYONE_MARKER, Participant } from '@/types';
import { getParticipantActiveChipClasses, getParticipantChipClasses } from '@/utils/colors';

const EVERYONE_DEFAULT_CLASSES = 'border-slate-200 bg-slate-100 text-slate-700';
const EVERYONE_ACTIVE_CLASSES = 'border-slate-800 bg-slate-800 text-white';

interface ParticipantChipListProps {
  participants: Participant[];
  selectedParticipantId: string | null;
  onSelectionChange: (participantId: string | null) => void;
  onTapEmptyState: () => void;
}

export function ParticipantChipList({
  participants,
  selectedParticipantId,
  onSelectionChange,
  onTapEmptyState,
}: ParticipantChipListProps) {
  if (participants.length === 0) {
    return (
      <button
        onClick={onTapEmptyState}
        className="w-full rounded-lg border-2 border-dashed border-gray-300 p-4 text-center text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors"
      >
        Tap to add participants
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="mb-2 text-xs text-gray-500">
        Select one chip, then tap items below to toggle assignments.
      </p>
      <div className="flex flex-wrap gap-2">
        <Chip
          label="Everyone"
          isSelected={selectedParticipantId === EVERYONE_MARKER}
          onClick={() => onSelectionChange(selectedParticipantId === EVERYONE_MARKER ? null : EVERYONE_MARKER)}
          className={selectedParticipantId === EVERYONE_MARKER ? EVERYONE_ACTIVE_CLASSES : EVERYONE_DEFAULT_CLASSES}
        />
        {participants.map((participant, index) => (
          <Chip
            key={participant.id}
              label={participant.name}
              isSelected={selectedParticipantId === participant.id}
              onClick={() => onSelectionChange(selectedParticipantId === participant.id ? null : participant.id)}
              className={selectedParticipantId === participant.id
              ? getParticipantActiveChipClasses(participant.name)
              : getParticipantChipClasses(participant.name)}
            prefix={index === 0 ? 'Paid' : undefined}
          />
        ))}
      </div>
    </div>
  );
}

interface ChipProps {
  label: string;
  isSelected: boolean;
  onClick: () => void;
  className: string;
  prefix?: string;
}

function Chip({ label, isSelected, onClick, className, prefix }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm transition-all ${
        isSelected
          ? 'scale-[1.03] font-bold shadow-md ring-2 ring-black/10 ring-offset-1'
          : 'font-medium opacity-85 hover:-translate-y-px hover:opacity-100'
      } ${className}`}
    >
      {prefix && <span className="text-[10px] uppercase tracking-wide opacity-80">{prefix}</span>}
      <span className="truncate max-w-[120px]">{label}</span>
    </button>
  );
}
