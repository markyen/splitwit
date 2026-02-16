'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createExpense } from '@/services/expenses';

export default function HomePage() {
  const router = useRouter();
  const [shareCode, setShareCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = shareCode.trim().toUpperCase();
    if (code.length === 6) {
      router.push(`/expense/${code}`);
    } else {
      setError('Please enter a 6-character code');
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError('');
    try {
      const code = await createExpense();
      router.push(`/expense/${code}`);
    } catch (err) {
      console.error('Error creating expense:', err);
      setError('Failed to create expense. Please try again.');
      setIsCreating(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <main className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900">Splitwit</h1>
          <p className="mt-2 text-gray-600">Split bills with friends easily</p>
        </div>

        <div className="space-y-6">
          {/* Join existing expense */}
          <form onSubmit={handleJoin} className="space-y-3">
            <label
              htmlFor="shareCode"
              className="block text-sm font-medium text-gray-700"
            >
              Have a share code?
            </label>
            <input
              type="text"
              id="shareCode"
              value={shareCode}
              onChange={(e) => {
                setShareCode(e.target.value.toUpperCase());
                setError('');
              }}
              placeholder="Enter 6-character code"
              maxLength={6}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-xl font-mono tracking-widest uppercase focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <button
              type="submit"
              disabled={shareCode.length !== 6}
              className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Join Expense
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-gray-50 px-2 text-gray-500">or</span>
            </div>
          </div>

          {/* Create new expense */}
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="w-full rounded-lg border-2 border-blue-500 bg-blue-50 px-4 py-3 font-medium text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? 'Creating...' : 'Create New Expense'}
          </button>

          {error && (
            <p className="text-center text-sm text-red-600">{error}</p>
          )}
        </div>
      </main>
    </div>
  );
}
