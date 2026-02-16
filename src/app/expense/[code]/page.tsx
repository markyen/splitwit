'use client';

import { use, useState, useMemo } from 'react';
import Link from 'next/link';
import { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useExpense } from '@/hooks/useExpense';
import { useParticipants } from '@/hooks/useParticipants';
import { useLineItems } from '@/hooks/useLineItems';
import { DndProvider } from '@/components/dnd/DndProvider';
import { LineItemList } from '@/components/line-items/LineItemList';
import { DraggableParticipantBar } from '@/components/participants/DraggableParticipantBar';
import { ParticipantPillOverlay } from '@/components/participants/DraggableParticipantPill';
import { ParticipantEditorModal } from '@/components/participants/ParticipantEditorModal';
import { TotalEditor } from '@/components/total/TotalEditor';
import { ShareButton } from '@/components/share/ShareButton';
import { SummarySection } from '@/components/summary/SummarySection';
import { updateLineItem } from '@/services/expenses';
import { Participant, EVERYONE_MARKER } from '@/types';

interface ExpensePageProps {
  params: Promise<{ code: string }>;
}

export default function ExpensePage({ params }: ExpensePageProps) {
  const { code } = use(params);
  const { expense, loading: expenseLoading, error: expenseError } = useExpense(code);
  const { participants, loading: participantsLoading } = useParticipants(code);
  const { lineItems, loading: lineItemsLoading } = useLineItems(code);

  const [isParticipantModalOpen, setIsParticipantModalOpen] = useState(false);
  const [activeParticipant, setActiveParticipant] = useState<Participant | 'everyone' | null>(null);
  const [dismissLineItemEditor, setDismissLineItemEditor] = useState(false);

  const loading = expenseLoading || participantsLoading || lineItemsLoading;

  // Calculate subtotal from line items
  const subtotal = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + item.price, 0);
  }, [lineItems]);

  // Check if all items are assigned
  const allItemsAssigned = useMemo(() => {
    if (lineItems.length === 0) return false;
    return lineItems.every((item) => item.assignedTo.length > 0);
  }, [lineItems]);

  // Determine if "Everybody" should be shown
  const showEverybodyPill = participants.length > 0;

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    // Dismiss line item editor on any drag
    setDismissLineItemEditor(true);
    if (active.data.current?.type === 'participant') {
      setActiveParticipant(active.data.current.participant);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveParticipant(null);

    if (!over) return;

    // Check if a participant is being dragged (for assignment to line item)
    const isParticipantDrag = active.data.current?.type === 'participant';

    if (isParticipantDrag) {
      // Handle participant assignment to line item
      const overData = over.data.current;
      let lineItemId: string | undefined;

      if (overData?.type === 'lineitem' || overData?.type === 'sortable-lineitem') {
        // Dropped on the line item (either droppable or sortable area)
        lineItemId = overData.lineItemId as string;
      }

      // Only assign when dropped on a line item, not above/below
      if (!lineItemId) return;

      const lineItem = lineItems.find((li) => li.id === lineItemId);
      if (!lineItem) return;

      const participantId = active.id as string;

      // Don't add if already assigned
      if (lineItem.assignedTo.includes(participantId)) return;

      // If adding "everyone", replace all other assignments
      // If already has "everyone", don't add individual participants
      let newAssignedTo: string[];
      if (participantId === EVERYONE_MARKER) {
        newAssignedTo = [EVERYONE_MARKER];
      } else if (lineItem.assignedTo.includes(EVERYONE_MARKER)) {
        // Can't add individual when everyone is assigned
        return;
      } else {
        newAssignedTo = [...lineItem.assignedTo, participantId];
      }

      try {
        await updateLineItem(code, lineItemId, { assignedTo: newAssignedTo });
      } catch (error) {
        console.error('Error assigning participant:', error);
      }
      return;
    }

    // Check if this is a line item reorder (both active and over are line item IDs)
    const activeLineItem = lineItems.find((li) => li.id === active.id);
    const overLineItem = lineItems.find((li) => li.id === over.id);

    if (activeLineItem && overLineItem && active.id !== over.id) {
      // Line item reordering
      const oldIndex = lineItems.findIndex((li) => li.id === active.id);
      const newIndex = lineItems.findIndex((li) => li.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(lineItems, oldIndex, newIndex);

        // Update orders in Firestore
        try {
          for (let i = 0; i < reordered.length; i++) {
            if (reordered[i].order !== i) {
              await updateLineItem(code, reordered[i].id, { order: i });
            }
          }
        } catch (error) {
          console.error('Error reordering line items:', error);
        }
      }
      return;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (expenseError || !expense) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-gray-600">Expense not found</p>
          <Link
            href="/"
            className="inline-block rounded-lg bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <DndProvider
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      overlay={
        activeParticipant && (
          <ParticipantPillOverlay
            participant={activeParticipant}
            isPayer={activeParticipant !== 'everyone' && participants[0]?.id === activeParticipant.id}
          />
        )
      }
    >
      <div className="min-h-screen pb-24">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between max-w-lg mx-auto">
            <Link href="/" className="text-xl font-bold text-gray-900">
              Splitwit
            </Link>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-gray-500">{code}</span>
              <ShareButton code={code} />
            </div>
          </div>
        </header>

        <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
          {/* Participants Section - moved above items for better drag UX */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-700">Participants</h2>
              <button
                onClick={() => {
                  setDismissLineItemEditor(true);
                  setIsParticipantModalOpen(true);
                }}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                {participants.length === 0 ? 'Add participants' : 'Edit'}
              </button>
            </div>
            <DraggableParticipantBar
              participants={participants}
              showEverybody={showEverybodyPill}
              onTap={() => {
                setDismissLineItemEditor(true);
                setIsParticipantModalOpen(true);
              }}
            />
          </section>

          {/* Line Items Section */}
          <section>
            <LineItemList
              code={code}
              lineItems={lineItems}
              participants={participants}
              dismissEditor={dismissLineItemEditor}
              onEditorDismissed={() => setDismissLineItemEditor(false)}
            />
          </section>

          {/* Total Section */}
          <section>
            <TotalEditor
              code={code}
              total={expense.total}
              subtotal={subtotal}
              onEditStart={() => setDismissLineItemEditor(true)}
            />
          </section>

          {/* Summary Section (only when all items assigned) */}
          {allItemsAssigned && (
            <section>
              <SummarySection
                lineItems={lineItems}
                participants={participants}
              />
            </section>
          )}
        </main>

        {/* Participant Editor Modal */}
        <ParticipantEditorModal
          isOpen={isParticipantModalOpen}
          onClose={() => setIsParticipantModalOpen(false)}
          code={code}
          participants={participants}
        />
      </div>
    </DndProvider>
  );
}
