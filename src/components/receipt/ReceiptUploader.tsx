'use client';

import { useState, useRef } from 'react';
import { getOCRProvider } from '@/services/ocr';
import { addLineItemsBatch } from '@/services/expenses';
import { ReceiptData } from '@/types';

interface ReceiptUploaderProps {
  code: string;
  startingOrder: number;
  onItemsAdded?: (count: number) => void;
  onError?: (error: string) => void;
}

type UploadState = 'idle' | 'selecting' | 'processing' | 'review' | 'error';

export function ReceiptUploader({
  code,
  startingOrder,
  onItemsAdded,
  onError,
}: ReceiptUploaderProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSelectSource = () => {
    setState('selecting');
  };

  const handleCamera = () => {
    cameraInputRef.current?.click();
  };

  const handlePhotoLibrary = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be selected again
    e.target.value = '';

    await processImage(file);
  };

  const processImage = async (file: File) => {
    setState('processing');
    setProgress(0);
    setError(null);
    setValidationError(null);

    try {
      const provider = getOCRProvider();
      const data = await provider.extractReceipt(file);

      setReceiptData(data);

      // Validate: items should sum to subtotal
      if (data.items.length > 0 && data.subtotal !== null) {
        const itemsSum = data.items.reduce((sum, item) => sum + item.price, 0);
        const diff = Math.abs(itemsSum - data.subtotal);

        if (diff > 0.02) {
          // Allow 2 cent tolerance for rounding
          setValidationError(
            `Items sum to $${itemsSum.toFixed(2)} but subtotal is $${data.subtotal.toFixed(2)}. Please review and correct.`
          );
          setState('review');
          return;
        }
      }

      // Auto-save if valid
      if (data.items.length > 0) {
        await saveItems(data);
      } else {
        setError('No items found in receipt');
        setState('error');
      }
    } catch (err) {
      console.error('OCR error:', err);
      setError('Failed to process receipt. Please try again or add items manually.');
      setState('error');
      onError?.('Failed to process receipt');
    }
  };

  const saveItems = async (data: ReceiptData) => {
    try {
      const items = data.items.map((item, index) => ({
        name: item.name,
        price: item.price,
        order: startingOrder + index,
        assignedTo: [],
      }));

      await addLineItemsBatch(code, items);
      onItemsAdded?.(items.length);
      setState('idle');
      setReceiptData(null);
    } catch (err) {
      console.error('Error saving items:', err);
      setError('Failed to save items');
      setState('error');
    }
  };

  const handleConfirmReview = async () => {
    if (receiptData) {
      await saveItems(receiptData);
    }
  };

  const handleCancel = () => {
    setState('idle');
    setReceiptData(null);
    setError(null);
    setValidationError(null);
  };

  // Hidden file inputs
  const fileInputs = (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </>
  );

  if (state === 'selecting') {
    return (
      <div className="space-y-2">
        {fileInputs}
        <div className="flex gap-2">
          <button
            onClick={handleCamera}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Camera
          </button>
          <button
            onClick={handlePhotoLibrary}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Photos
          </button>
        </div>
        <button
          onClick={handleCancel}
          className="w-full text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (state === 'processing') {
    return (
      <div className="rounded-lg border border-gray-200 p-4 text-center">
        {fileInputs}
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-sm text-gray-600">Processing receipt...</p>
        <p className="text-xs text-gray-400 mt-1">This may take a moment</p>
      </div>
    );
  }

  if (state === 'review' && receiptData) {
    return (
      <div className="rounded-lg border-2 border-yellow-200 bg-yellow-50 p-4">
        {fileInputs}
        <p className="text-sm font-medium text-yellow-800 mb-2">Review Required</p>
        <p className="text-sm text-yellow-700 mb-3">{validationError}</p>

        <div className="bg-white rounded-md p-3 mb-3 max-h-48 overflow-auto">
          <p className="text-xs font-medium text-gray-500 mb-2">
            Found {receiptData.items.length} items:
          </p>
          <ul className="text-sm space-y-1">
            {receiptData.items.map((item, index) => (
              <li key={index} className="flex justify-between">
                <span className="truncate">{item.name}</span>
                <span className="ml-2 font-medium">${item.price.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmReview}
            className="flex-1 rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700"
          >
            Add Anyway
          </button>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
        {fileInputs}
        <p className="text-sm text-red-600 mb-3">{error}</p>
        <button
          onClick={handleCancel}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Idle state
  return (
    <button
      onClick={handleSelectSource}
      className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-600 hover:border-gray-400 hover:text-gray-700 transition-colors"
    >
      {fileInputs}
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      Upload Receipt
    </button>
  );
}
