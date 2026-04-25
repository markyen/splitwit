import { describe, expect, it } from 'vitest';
import { EVERYONE_MARKER, Participant } from '@/types';
import { toggleAssignmentForParticipant } from './assignments';

const participants: Participant[] = [
  { id: 'alice', name: 'Alice', order: 0 },
  { id: 'bob', name: 'Bob', order: 1 },
  { id: 'cara', name: 'Cara', order: 2 },
];

describe('toggleAssignmentForParticipant', () => {
  it('assigns an unassigned participant', () => {
    expect(toggleAssignmentForParticipant({
      assignedTo: [],
      selectedParticipantId: 'alice',
      participants,
    })).toEqual(['alice']);
  });

  it('removes a participant from an everyone assignment', () => {
    expect(toggleAssignmentForParticipant({
      assignedTo: [EVERYONE_MARKER],
      selectedParticipantId: 'alice',
      participants,
    })).toEqual(['bob', 'cara']);
  });

  it('normalizes back to everyone when all participants become assigned', () => {
    expect(toggleAssignmentForParticipant({
      assignedTo: ['bob', 'cara'],
      selectedParticipantId: 'alice',
      participants,
    })).toEqual([EVERYONE_MARKER]);
  });

  it('toggles everyone off when everyone is already effectively assigned', () => {
    expect(toggleAssignmentForParticipant({
      assignedTo: ['alice', 'bob', 'cara'],
      selectedParticipantId: EVERYONE_MARKER,
      participants,
    })).toEqual([]);
  });
});
