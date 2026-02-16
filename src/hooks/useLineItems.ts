'use client';

import { useState, useEffect } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { LineItem } from '@/types';
import { getLineItemsQuery } from '@/services/expenses';

interface UseLineItemsResult {
  lineItems: LineItem[];
  loading: boolean;
  error: string | null;
}

export function useLineItems(code: string): UseLineItemsResult {
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setLoading(false);
      return;
    }

    const q = getLineItemsQuery(code);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: LineItem[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as LineItem[];

        setLineItems(items);
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching line items:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [code]);

  return { lineItems, loading, error };
}
