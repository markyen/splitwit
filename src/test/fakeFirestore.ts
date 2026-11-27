// An in-memory stand-in for the Firestore calls the server makes (doc, runTransaction and
// serverTimestamp), with the web SDK's optimistic transactions: each read notes the document's
// version, the commit fails if any document read has changed since, and the update function then
// runs again from its reads, up to the SDK's default of five attempts. Reads and the commit each
// wait a turn of the event loop first, so parallel requests interleave between them.

type Data = Record<string, unknown>;
type Ref = { path: string };

class FakeTimestamp {
  constructor(private readonly ms: number) {}

  toMillis() {
    return this.ms;
  }
}

const SERVER_TIMESTAMP = Symbol('serverTimestamp');

const firestoreError = (code: string) =>
  Object.assign(new Error(`Fake Firestore: ${code}`), { name: 'FirebaseError', code });

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeFirestore {
  private docs = new Map<string, { version: number; data: Data }>();
  private version = 0;
  // Transaction attempts started, and those whose commit found a changed document
  attempts = 0;
  conflicts = 0;
  // When set, every transaction rejects with it
  failure: Error | null = null;

  reset() {
    this.docs.clear();
    this.attempts = 0;
    this.conflicts = 0;
    this.failure = null;
  }

  timestamp(ms: number) {
    return new FakeTimestamp(ms);
  }

  seed(path: string, data: Data) {
    this.docs.set(path, { version: ++this.version, data });
  }

  get(path: string): Data | undefined {
    return this.docs.get(path)?.data;
  }

  paths() {
    return [...this.docs.keys()].sort();
  }

  readonly module = {
    doc: (_db: unknown, ...segments: string[]): Ref => ({ path: segments.join('/') }),
    serverTimestamp: () => SERVER_TIMESTAMP,
    runTransaction: <T>(_db: unknown, update: (transaction: unknown) => Promise<T>, options?: { maxAttempts?: number }) =>
      this.runTransaction(update, options?.maxAttempts ?? 5),
  };

  private async runTransaction<T>(update: (transaction: unknown) => Promise<T>, maxAttempts: number): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      this.attempts++;
      if (this.failure) throw this.failure;

      const reads = new Map<string, number>();
      const writes: { path: string; data: Data; merge: boolean }[] = [];
      const transaction = {
        get: async (ref: Ref) => {
          if (writes.length) throw firestoreError('invalid-argument');
          await nextTurn();
          const stored = this.docs.get(ref.path);
          reads.set(ref.path, stored?.version ?? 0);
          const data = stored && { ...stored.data };
          return { exists: () => data !== undefined, data: () => data };
        },
        set: (ref: Ref, data: Data) => {
          writes.push({ path: ref.path, data, merge: false });
          return transaction;
        },
        update: (ref: Ref, data: Data) => {
          if (!reads.has(ref.path) || !this.docs.has(ref.path)) throw firestoreError('not-found');
          writes.push({ path: ref.path, data, merge: true });
          return transaction;
        },
      };

      const result = await update(transaction);
      await nextTurn();
      const changed = [...reads].some(([path, version]) => (this.docs.get(path)?.version ?? 0) !== version);
      if (!changed) {
        for (const { path, data, merge } of writes) {
          const values = Object.fromEntries(
            Object.entries(data).map(([key, value]) => [
              key,
              value === SERVER_TIMESTAMP ? new FakeTimestamp(Date.now()) : value,
            ])
          );
          const before = merge ? this.docs.get(path)?.data : undefined;
          this.docs.set(path, { version: ++this.version, data: { ...before, ...values } });
        }
        return result;
      }

      this.conflicts++;
      if (attempt >= maxAttempts) throw firestoreError('aborted');
    }
  }
}

export const fakeFirestore = new FakeFirestore();
