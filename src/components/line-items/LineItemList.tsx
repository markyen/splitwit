'use client';

import { useState, useEffect, useRef } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { LineItem, Participant } from '@/types';
import { SortableLineItemRow } from './SortableLineItemRow';
import { LineItemEditor, LineItemEditorHandle } from './LineItemEditor';
import { ReceiptUploader } from '@/components/receipt/ReceiptUploader';
import { addLineItem, updateLineItem, removeLineItemsBatch } from '@/services/expenses';

interface LineItemListProps {
  code: string;
  lineItems: LineItem[];
  participants: Participant[];
  dismissEditor?: boolean;
  onEditorDismissed?: () => void;
}

export function LineItemList({ code, lineItems, participants, dismissEditor, onEditorDismissed }: LineItemListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'name' | 'price'>('name');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const editorRef = useRef<LineItemEditorHandle>(null);

  // Dismiss editor when requested by parent (save first if editing existing item)
  useEffect(() => {
    if (dismissEditor) {
      const handleDismiss = async () => {
        // Save existing item if being edited
        if (editingId && editorRef.current) {
          await editorRef.current.saveIfValid();
          setEditingId(null);
        }
        // Dismiss new item editor
        if (isAddingNew) {
          setIsAddingNew(false);
        }
        onEditorDismissed?.();
      };
      handleDismiss();
    }
  }, [dismissEditor, editingId, isAddingNew, onEditorDismissed]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingAdds, setPendingAdds] = useState(0);

  // Calculate max order for new items
  const maxOrder = lineItems.length > 0
    ? Math.max(...lineItems.map((item) => item.order))
    : -1;
  const nextOrder = maxOrder + pendingAdds + 1;

  const handleAddItem = async (name: string, price: number) => {
    const order = nextOrder;

    setPendingAdds((p) => p + 1);
    try {
      await addLineItem(code, { name, price, order, assignedTo: [] });
    } finally {
      setPendingAdds((p) => p - 1);
    }
  };

  const handleToggleSelect = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === lineItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(lineItems.map((item) => item.id)));
    }
  };

  const handleCancelSelection = () => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;

    setIsDeleting(true);
    try {
      await removeLineItemsBatch(code, Array.from(selectedIds));
      setSelectedIds(new Set());
      setIsSelectionMode(false);
    } catch (error) {
      console.error('Error deleting items:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRemoveAssignment = async (itemId: string, participantId: string) => {
    const item = lineItems.find((li) => li.id === itemId);
    if (!item) return;

    const newAssignedTo = item.assignedTo.filter((id) => id !== participantId);
    try {
      await updateLineItem(code, itemId, { assignedTo: newAssignedTo });
    } catch (error) {
      console.error('Error removing assignment:', error);
    }
  };

  if (lineItems.length === 0 && !isAddingNew) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-gray-500 mb-4">No items yet</p>
          <div className="flex flex-col gap-3">
            <ReceiptUploader
              code={code}
              startingOrder={0}
            />
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-gray-50 px-2 text-gray-400">or</span>
              </div>
            </div>
            <button
              onClick={() => setIsAddingNew(true)}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Add Item Manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {isSelectionMode ? (
        <div className="flex items-center justify-between mb-3 bg-blue-50 -mx-4 px-4 py-2 border-y border-blue-200">
          <div className="flex items-center gap-3">
            <button
              onClick={handleSelectAll}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              {selectedIds.size === lineItems.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-sm text-gray-600">
              {selectedIds.size} selected
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0 || isDeleting}
              className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
            <button
              onClick={handleCancelSelection}
              className="text-sm text-gray-600 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-700">Items</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSelectionMode(true)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Select
            </button>
            <ReceiptUploader
              code={code}
              startingOrder={nextOrder}
            />
          </div>
        </div>
      )}

      <SortableContext items={lineItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {lineItems.map((item) => (
            editingId === item.id && !isSelectionMode ? (
              <LineItemEditor
                key={item.id}
                ref={editorRef}
                code={code}
                item={item}
                onClose={() => setEditingId(null)}
                initialField={editingField}
              />
            ) : (
              <SortableLineItemRow
                key={item.id}
                item={item}
                participants={participants}
                onEdit={(field) => {
                  setIsAddingNew(false);
                  setEditingField(field);
                  setEditingId(item.id);
                }}
                onRemoveAssignment={(participantId) => handleRemoveAssignment(item.id, participantId)}
                isSelectionMode={isSelectionMode}
                isSelected={selectedIds.has(item.id)}
                onToggleSelect={() => handleToggleSelect(item.id)}
              />
            )
          ))}

          {isAddingNew ? (
            <LineItemEditor
              code={code}
              item={null}
              onClose={() => setIsAddingNew(false)}
              onSaveNew={handleAddItem}
              keepOpenAfterSave
            />
          ) : !isSelectionMode && (
            <button
              onClick={() => setIsAddingNew(true)}
              className="w-full rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors"
            >
              + Add Item
            </button>
          )}
        </div>
      </SortableContext>
    </div>
  );
}
