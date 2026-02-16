'use client';

import { useState, useEffect } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { Participant } from '@/types';
import { getParticipantsQuery } from '@/services/expenses';

interface UseParticipantsResult {
  participants: Participant[];
  loading: boolean;
  error: string | null;
}

export function useParticipants(code: string): UseParticipantsResult {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setLoading(false);
      return;
    }

    const q = getParticipantsQuery(code);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const participantList: Participant[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Participant[];

        setParticipants(participantList);
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching participants:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [code]);

  return { participants, loading, error };
}
