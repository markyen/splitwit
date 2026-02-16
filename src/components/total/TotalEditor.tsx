'use client';

import { useState } from 'react';
import { updateExpenseTotal } from '@/services/expenses';

interface TotalEditorProps {
  code: string;
  total: number | null;
  subtotal: number;
  onEditStart?: () => void;
}

export function TotalEditor({ code, total, subtotal, onEditStart }: TotalEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const displayTotal = total ?? subtotal;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price);
  };

  const handleStartEdit = () => {
    onEditStart?.();
    setEditValue(displayTotal.toFixed(2));
    setIsEditing(true);
  };

  const handleSave = async (value: number) => {
    setIsSaving(true);
    try {
      await updateExpenseTotal(code, value);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving total:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = () => {
    const value = parseFloat(editValue);
    if (!isNaN(value) && value >= 0) {
      handleSave(value);
    }
  };

  const handleShortcut = (multiplier: number) => {
    const value = subtotal * multiplier;
    handleSave(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  if (!isEditing) {
    return (
      <div
        onClick={handleStartEdit}
        className="rounded-lg bg-white border border-gray-200 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-2xl font-bold text-gray-900">
              {formatPrice(displayTotal)}
            </p>
          </div>
          <div className="text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </div>
        </div>
        {total !== null && total !== subtotal && (
          <p className="text-xs text-gray-400 mt-1">
            Subtotal: {formatPrice(subtotal)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-blue-50 border-2 border-blue-200 p-4">
      <p className="text-sm font-medium text-gray-700 mb-2">Edit Total</p>

      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">$</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className="w-full rounded-lg border border-gray-300 pl-8 pr-4 py-3 text-xl font-bold focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Tip shortcuts */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 mb-2">Quick tip options:</p>
        <div className="flex gap-2">
          <button
            onClick={() => handleShortcut(1)}
            disabled={isSaving}
            className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            No tip
          </button>
          <button
            onClick={() => handleShortcut(1.2)}
            disabled={isSaving}
            className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            20%
          </button>
          <button
            onClick={() => handleShortcut(1.25)}
            disabled={isSaving}
            className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            25%
          </button>
          <button
            onClick={() => handleShortcut(1.3)}
            disabled={isSaving}
            className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            30%
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setIsEditing(false)}
          disabled={isSaving}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={isSaving}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
