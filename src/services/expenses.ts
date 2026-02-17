import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  Timestamp,
  query,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { Expense, Participant, LineItem } from '@/types';

// Collection references
const expensesCollection = collection(db, 'expenses');

const getParticipantsCollection = (expenseCode: string) =>
  collection(db, 'expenses', expenseCode, 'participants');

const getLineItemsCollection = (expenseCode: string) =>
  collection(db, 'expenses', expenseCode, 'lineItems');

// Share code generation
const SHARE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars (0, O, 1, I)
const SHARE_CODE_LENGTH = 6;

function generateShareCode(): string {
  let code = '';
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
    code += SHARE_CODE_CHARS.charAt(
      Math.floor(Math.random() * SHARE_CODE_CHARS.length)
    );
  }
  return code;
}

async function isShareCodeAvailable(code: string): Promise<boolean> {
  const docRef = doc(expensesCollection, code);
  const docSnap = await getDoc(docRef);
  return !docSnap.exists();
}

// Expense CRUD

export async function createExpense(): Promise<string> {
  let code: string;
  let attempts = 0;
  const maxAttempts = 10;

  // Generate unique share code with collision check
  do {
    code = generateShareCode();
    attempts++;
    if (attempts > maxAttempts) {
      throw new Error('Failed to generate unique share code');
    }
  } while (!(await isShareCodeAvailable(code)));

  const expense: Expense = {
    title: null,
    total: null,
    receiptUrl: null,
    createdAt: Timestamp.now(),
  };

  await setDoc(doc(expensesCollection, code), expense);
  return code;
}

export async function getExpense(code: string): Promise<Expense | null> {
  const docRef = doc(expensesCollection, code);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return docSnap.data() as Expense;
}

export async function updateExpenseTotal(
  code: string,
  total: number | null
): Promise<void> {
  const docRef = doc(expensesCollection, code);
  await updateDoc(docRef, { total });
}

export async function updateExpenseTitle(
  code: string,
  title: string | null
): Promise<void> {
  const docRef = doc(expensesCollection, code);
  await updateDoc(docRef, { title });
}

export async function updateExpenseReceiptUrl(
  code: string,
  receiptUrl: string | null
): Promise<void> {
  const docRef = doc(expensesCollection, code);
  await updateDoc(docRef, { receiptUrl });
}

// Participant CRUD

export async function addParticipant(
  code: string,
  name: string,
  order: number
): Promise<string> {
  const participantsCol = getParticipantsCollection(code);
  const docRef = await addDoc(participantsCol, { name, order });
  return docRef.id;
}

export async function updateParticipant(
  code: string,
  participantId: string,
  data: Partial<Pick<Participant, 'name' | 'order'>>
): Promise<void> {
  const docRef = doc(getParticipantsCollection(code), participantId);
  await updateDoc(docRef, data);
}

export async function removeParticipant(
  code: string,
  participantId: string
): Promise<void> {
  const docRef = doc(getParticipantsCollection(code), participantId);
  await deleteDoc(docRef);
}

// Line Item CRUD

export async function addLineItem(
  code: string,
  item: Omit<LineItem, 'id'>
): Promise<string> {
  const lineItemsCol = getLineItemsCollection(code);
  const docRef = await addDoc(lineItemsCol, item);
  return docRef.id;
}

export async function updateLineItem(
  code: string,
  itemId: string,
  data: Partial<Omit<LineItem, 'id'>>
): Promise<void> {
  const docRef = doc(getLineItemsCollection(code), itemId);
  await updateDoc(docRef, data);
}

export async function removeLineItem(
  code: string,
  itemId: string
): Promise<void> {
  const docRef = doc(getLineItemsCollection(code), itemId);
  await deleteDoc(docRef);
}

export async function removeLineItemsBatch(
  code: string,
  itemIds: string[]
): Promise<void> {
  const batch = writeBatch(db);
  for (const itemId of itemIds) {
    const docRef = doc(getLineItemsCollection(code), itemId);
    batch.delete(docRef);
  }
  await batch.commit();
}

// Batch operations for OCR import

export async function addLineItemsBatch(
  code: string,
  items: Omit<LineItem, 'id'>[]
): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    const id = await addLineItem(code, item);
    ids.push(id);
  }
  return ids;
}

// Query helpers

export function getParticipantsQuery(code: string) {
  return query(getParticipantsCollection(code), orderBy('order', 'asc'));
}

export function getLineItemsQuery(code: string) {
  return query(getLineItemsCollection(code), orderBy('order', 'asc'));
}

export function getExpenseDocRef(code: string) {
  return doc(expensesCollection, code);
}
