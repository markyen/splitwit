'use client';

import { useState, useRef, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Participant } from '@/types';
import { addParticipant, removeParticipant, updateParticipant } from '@/services/expenses';
import { SortableParticipantPill } from './SortableParticipantPill';

interface ParticipantEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  participants: Participant[];
}

export function ParticipantEditorModal({
  isOpen,
  onClose,
  code,
  participants,
}: ParticipantEditorModalProps) {
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleAddParticipant = () => {
    const name = newName.trim();
    if (!name) return;

    // Clear and refocus BEFORE async save to stay within user gesture (keeps mobile keyboard open)
    setNewName('');
    inputRef.current?.focus();

    // Fire save in background
    const order = participants.length;
    addParticipant(code, name, order).catch((error) => {
      console.error('Error adding participant:', error);
    });
  };

  const handleRemoveParticipant = async (participantId: string) => {
    try {
      await removeParticipant(code, participantId);
      // Reorder remaining participants
      const remaining = participants
        .filter((p) => p.id !== participantId)
        .sort((a, b) => a.order - b.order);

      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].order !== i) {
          await updateParticipant(code, remaining[i].id, { order: i });
        }
      }
    } catch (error) {
      console.error('Error removing participant:', error);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = participants.findIndex((p) => p.id === active.id);
    const newIndex = participants.findIndex((p) => p.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(participants, oldIndex, newIndex);

    // Update orders in Firestore
    try {
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].order !== i) {
          await updateParticipant(code, reordered[i].id, { order: i });
        }
      }
    } catch (error) {
      console.error('Error reordering participants:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddParticipant();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  const sortedParticipants = [...participants].sort((a, b) => a.order - b.order);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-6 max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Participants</h2>
          <button
            onClick={onClose}
            className="p-2 -m-2 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Add new participant */}
        <div className="flex gap-2 mb-4">
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter name and press Enter"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleAddParticipant}
            disabled={!newName.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>

        {/* Participant list */}
        {sortedParticipants.length === 0 ? (
          <p className="text-center text-gray-500 py-4">
            No participants yet. Add some above!
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-2">
              First participant is the payer. Drag to reorder.
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedParticipants.map((p) => p.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex flex-wrap gap-2">
                  {sortedParticipants.map((participant, index) => (
                    <SortableParticipantPill
                      key={participant.id}
                      participant={participant}
                      isPayer={index === 0}
                      onRemove={() => handleRemoveParticipant(participant.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white hover:bg-gray-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
