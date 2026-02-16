'use client';

import { useState, useEffect } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { Expense } from '@/types';
import { getExpenseDocRef } from '@/services/expenses';

interface UseExpenseResult {
  expense: Expense | null;
  loading: boolean;
  error: string | null;
}

export function useExpense(code: string): UseExpenseResult {
  const [expense, setExpense] = useState<Expense | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setLoading(false);
      return;
    }

    const docRef = getExpenseDocRef(code);

    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setExpense(docSnap.data() as Expense);
          setError(null);
        } else {
          setExpense(null);
          setError('Expense not found');
        }
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching expense:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [code]);

  return { expense, loading, error };
}
