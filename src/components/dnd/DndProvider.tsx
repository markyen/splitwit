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
  MeasuringStrategy,
} from '@dnd-kit/core';

interface DndProviderProps {
  children: ReactNode;
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  overlay?: ReactNode;
}

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
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      measuring={{
        droppable: {
          strategy: MeasuringStrategy.Always,
          frequency: 100,
        },
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {overlay}
      </DragOverlay>
    </DndContext>
  );
}
