'use client';

import { ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  closestCenter,
  pointerWithin,
  CollisionDetection,
} from '@dnd-kit/core';

interface DndProviderProps {
  children: ReactNode;
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  overlay?: ReactNode;
}

// Custom collision detection:
// - For participant drags: use pointerWithin (strict - must be inside the item)
// - For line item reordering: use closestCenter (for smooth reordering)
const customCollisionDetection: CollisionDetection = (args) => {
  const { active } = args;
  const isParticipantDrag = active.data.current?.type === 'participant';

  if (isParticipantDrag) {
    // Filter out sortable droppables — only consider explicit lineitem-* droppables.
    // Without this, the sortable strategy can extend a line item's sortable rect
    // downward into the next item's space, causing drops to target the item above.
    const filtered = {
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => container.data.current?.type === 'lineitem'
      ),
    };
    return pointerWithin(filtered);
  }

  // Use closestCenter for line item reordering
  return closestCenter(args);
};

export function DndProvider({
  children,
  onDragStart,
  onDragEnd,
  overlay,
}: DndProviderProps) {
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 5,
    },
  });

  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 150,
      tolerance: 5,
    },
  });

  const sensors = useSensors(mouseSensor, touchSensor);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {overlay}
      </DragOverlay>
    </DndContext>
  );
}
