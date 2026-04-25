'use client';

import { use, useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useExpense } from '@/hooks/useExpense';
import { useParticipants } from '@/hooks/useParticipants';
import { useLineItems } from '@/hooks/useLineItems';
import { DndProvider } from '@/components/dnd/DndProvider';
import { LineItemList } from '@/components/line-items/LineItemList';
import { ParticipantChipList } from '@/components/participants/ParticipantChipList';
import { ParticipantEditorModal } from '@/components/participants/ParticipantEditorModal';
import { TotalEditor } from '@/components/total/TotalEditor';
import { ShareButton } from '@/components/share/ShareButton';
import { SummarySection } from '@/components/summary/SummarySection';
import { updateLineItem, updateExpenseTitle } from '@/services/expenses';
import { EVERYONE_MARKER } from '@/types';

interface ExpensePageProps {
  params: Promise<{ code: string }>;
}

export default function ExpensePage({ params }: ExpensePageProps) {
  const { code } = use(params);
  const { expense, loading: expenseLoading, error: expenseError } = useExpense(code);
  const { participants, loading: participantsLoading } = useParticipants(code);
  const { lineItems, loading: lineItemsLoading } = useLineItems(code);

  const [isParticipantModalOpen, setIsParticipantModalOpen] = useState(false);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [dismissLineItemEditor, setDismissLineItemEditor] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [isEditingTitle]);

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

  const effectiveSelectedParticipantId = useMemo(() => {
    if (!selectedParticipantId) {
      return null;
    }

    if (selectedParticipantId === EVERYONE_MARKER) {
      return participants.length > 0 ? EVERYONE_MARKER : null;
    }

    return participants.some((participant) => participant.id === selectedParticipantId)
      ? selectedParticipantId
      : null;
  }, [participants, selectedParticipantId]);

  const handleDragStart = () => {
    setDismissLineItemEditor(true);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

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
          {/* Title Section */}
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  const trimmed = titleValue.trim();
                  await updateExpenseTitle(code, trimmed || null);
                  setIsEditingTitle(false);
                } else if (e.key === 'Escape') {
                  setTitleValue(expense?.title ?? '');
                  setIsEditingTitle(false);
                }
              }}
              onBlur={async () => {
                const trimmed = titleValue.trim();
                await updateExpenseTitle(code, trimmed || null);
                setIsEditingTitle(false);
              }}
              placeholder="Add a title..."
              className="w-full text-lg font-semibold text-gray-900 placeholder-gray-400 bg-transparent border-b-2 border-blue-500 outline-none pb-1"
            />
          ) : (
            <button
              onClick={() => {
                setTitleValue(expense?.title ?? '');
                setIsEditingTitle(true);
              }}
              className="w-full text-left"
            >
              {expense?.title ? (
                <span className="text-lg font-semibold text-gray-900">{expense.title}</span>
              ) : (
                <span className="text-lg text-gray-400">Add a title...</span>
              )}
            </button>
          )}

          {/* Participants Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-700">Participants</h2>
              {participants.length > 0 && (
                <button
                  onClick={() => {
                    setDismissLineItemEditor(true);
                    setIsParticipantModalOpen(true);
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Edit
                </button>
              )}
            </div>
            <ParticipantChipList
              participants={participants}
              selectedParticipantId={effectiveSelectedParticipantId}
              onSelectionChange={(participantId) => {
                setDismissLineItemEditor(true);
                setSelectedParticipantId(participantId);
              }}
              onTapEmptyState={() => {
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
              selectedParticipantId={effectiveSelectedParticipantId}
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
                total={expense.total}
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
