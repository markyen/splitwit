'use client';

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { LineItem } from '@/types';
import { updateLineItem, removeLineItem } from '@/services/expenses';

export interface LineItemEditorHandle {
  saveIfValid: () => Promise<boolean>;
}

interface LineItemEditorProps {
  code: string;
  item: LineItem | null;
  onClose: () => void;
  onSaveNew?: (name: string, price: number) => Promise<void>;
  keepOpenAfterSave?: boolean;
  initialField?: 'name' | 'price';
}

export const LineItemEditor = forwardRef<LineItemEditorHandle, LineItemEditorProps>(function LineItemEditor(
  { code, item, onClose, onSaveNew, keepOpenAfterSave, initialField = 'name' },
  ref
) {
  const isNew = item === null;
  const [name, setName] = useState(item?.name || '');
  const [priceStr, setPriceStr] = useState(item ? item.price.toString() : '');
  const [isSaving, setIsSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<'name' | 'price'>(initialField);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusedField === 'name') {
      nameInputRef.current?.focus();
    } else {
      priceInputRef.current?.focus();
    }
  }, [focusedField]);

  // Expose save method for external triggers (e.g., when drag starts)
  useImperativeHandle(ref, () => ({
    saveIfValid: async () => {
      const trimmedName = name.trim();
      const price = parseFloat(priceStr) || 0;

      if (!trimmedName || price <= 0) {
        return false;
      }

      if (item) {
        try {
          await updateLineItem(code, item.id, { name: trimmedName, price });
          return true;
        } catch (error) {
          console.error('Error saving line item:', error);
          return false;
        }
      }
      return false;
    },
  }), [name, priceStr, item, code]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    const price = parseFloat(priceStr) || 0;

    if (!trimmedName || price <= 0) {
      return;
    }

    if (isNew && onSaveNew) {
      if (keepOpenAfterSave) {
        // Reset and refocus BEFORE async save to stay within user gesture
        setName('');
        setPriceStr('');
        nameInputRef.current?.focus();
      }
      // Fire save in background - don't await before focus
      onSaveNew(trimmedName, price).catch((error) => {
        console.error('Error saving line item:', error);
      });
    } else if (item) {
      setIsSaving(true);
      try {
        await updateLineItem(code, item.id, { name: trimmedName, price });
        onClose();
      } catch (error) {
        console.error('Error saving line item:', error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!item) return;

    setIsSaving(true);
    try {
      await removeLineItem(code, item.id);
      onClose();
    } catch (error) {
      console.error('Error deleting line item:', error);
      setIsSaving(false);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setFocusedField('price');
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handlePriceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const canSave = name.trim().length > 0 && parseFloat(priceStr) > 0;

  return (
    <div className="rounded-lg bg-blue-50 border-2 border-blue-200 p-3">
      <div className="flex gap-2">
        <input
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleNameKeyDown}
          onFocus={() => setFocusedField('name')}
          placeholder="Item name"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="relative w-24">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
          <input
            ref={priceInputRef}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            onKeyDown={handlePriceKeyDown}
            onFocus={() => setFocusedField('price')}
            placeholder="0.00"
            className="w-full rounded-md border border-gray-300 pl-7 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex gap-2">
          {!isNew && (
            <button
              onClick={handleDelete}
              disabled={isSaving}
              className="text-red-600 hover:text-red-700 p-2 -m-2"
              aria-label="Delete item"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || isSaving}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
});
