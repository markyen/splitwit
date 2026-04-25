import { EVERYONE_MARKER, Participant } from '@/types';

interface ToggleAssignmentParams {
  assignedTo: string[];
  selectedParticipantId: string;
  participants: Participant[];
}

export function toggleAssignmentForParticipant({
  assignedTo,
  selectedParticipantId,
  participants,
}: ToggleAssignmentParams): string[] {
  const participantIds = participants.map((participant) => participant.id);
  const participantIdSet = new Set(participantIds);

  if (selectedParticipantId === EVERYONE_MARKER) {
    const isEveryoneAssigned = assignedTo.includes(EVERYONE_MARKER)
      || (participants.length > 0 && participantIds.every((id) => assignedTo.includes(id)));

    return isEveryoneAssigned ? [] : [EVERYONE_MARKER];
  }

  const nextAssigned = assignedTo.includes(EVERYONE_MARKER)
    ? new Set(participantIds)
    : new Set(assignedTo.filter((id) => participantIdSet.has(id)));

  if (nextAssigned.has(selectedParticipantId)) {
    nextAssigned.delete(selectedParticipantId);
  } else {
    nextAssigned.add(selectedParticipantId);
  }

  if (nextAssigned.size === 0) {
    return [];
  }

  if (participants.length > 0 && nextAssigned.size === participants.length) {
    return [EVERYONE_MARKER];
  }

  return participantIds.filter((id) => nextAssigned.has(id));
}
