import { Timestamp } from 'firebase/firestore';

// Firestore document types

export interface Expense {
  title: string | null;
  total: number | null;
  receiptUrl: string | null;
  createdAt: Timestamp;
}

export interface Participant {
  id: string;
  name: string;
  order: number; // 0 = payer
}

export interface LineItem {
  id: string;
  name: string;
  price: number;
  order: number;
  assignedTo: string[]; // participant IDs, or ["everyone"], or []
}

// Special marker for "everyone" assignment
export const EVERYONE_MARKER = 'everyone';

// OCR types

export interface ReceiptItem {
  name: string;
  price: number;
}

export interface ReceiptData {
  items: ReceiptItem[];
  subtotal: number | null;
  total: number | null;
  raw?: string; // raw OCR text for debugging
}

// UI state types

export interface ExpenseState {
  expense: Expense | null;
  participants: Participant[];
  lineItems: LineItem[];
  loading: boolean;
  error: string | null;
}
