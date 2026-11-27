import { doc, runTransaction, serverTimestamp, type Timestamp } from 'firebase/firestore';
import { db } from '@/services/firebase';

// How many Textract calls /api/ocr may make in a window: for one expense, and across the app.
// Expenses are free to create, so the app-wide limit is the one that bounds the cost. Each count is
// a Firestore document, { windowStart, count }: expenses/{code}/usage/ocr and usage/ocr. A window
// starts with the first call after the previous window ended. firestore.rules repeats
// windowSeconds, as the rules refuse to restart a window before it is over.
export const OCR_LIMITS = {
  windowSeconds: 3600,
  perExpense: 20,
  global: 200,
} as const;

export type Reservation =
  | { allowed: true }
  | { allowed: false; limit: 'expense' | 'global'; retryAfterSeconds: number };

interface Usage {
  windowStart: Timestamp;
  count: number;
}

// Counts one Textract call against both limits, or counts nothing when either is used up. Both
// documents are read and written in one transaction. Its commit fails if another request changed
// either document after this one read it, and the SDK then runs the function again from the reads,
// so parallel requests can't take more calls than a limit allows.
export async function reserveTextractCall(code: string): Promise<Reservation> {
  const counters = [
    { limit: 'expense', max: OCR_LIMITS.perExpense, ref: doc(db, 'expenses', code, 'usage', 'ocr') },
    { limit: 'global', max: OCR_LIMITS.global, ref: doc(db, 'usage', 'ocr') },
  ] as const;
  const windowMs = OCR_LIMITS.windowSeconds * 1000;

  return runTransaction(db, async (transaction) => {
    const snapshots = await Promise.all(counters.map(({ ref }) => transaction.get(ref)));
    const now = Date.now();

    // Each counter's count in its current window, or null when the window is over or never began
    const windows = snapshots.map((snapshot) => {
      if (!snapshot.exists()) return null;
      const usage = snapshot.data() as Usage;
      const ends = usage.windowStart.toMillis() + windowMs;
      return now < ends ? { count: usage.count, ends } : null;
    });

    let denied: Reservation | null = null;
    for (let i = 0; i < counters.length; i++) {
      const current = windows[i];
      if (!current || current.count < counters[i].max) continue;
      const retryAfterSeconds = Math.max(1, Math.ceil((current.ends - now) / 1000));
      if (!denied || (!denied.allowed && retryAfterSeconds > denied.retryAfterSeconds)) {
        denied = { allowed: false, limit: counters[i].limit, retryAfterSeconds };
      }
    }
    if (denied) return denied;

    for (let i = 0; i < counters.length; i++) {
      const current = windows[i];
      if (current) {
        transaction.update(counters[i].ref, { count: current.count + 1 });
      } else {
        transaction.set(counters[i].ref, { windowStart: serverTimestamp(), count: 1 });
      }
    }
    return { allowed: true };
  });
}
