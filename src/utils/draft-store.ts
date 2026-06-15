import type { PageState, Annotation } from './pdf-manager';

const DB_NAME = 'pdf-editor-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'current-draft';

export interface SavedDraft {
  pdfBytes: Uint8Array;
  pagesState: PageState[];
  annotations: Annotation[];
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveDraft(
  pdfBytes: Uint8Array,
  pagesState: PageState[],
  annotations: Annotation[]
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const draft: SavedDraft = {
        pdfBytes,
        pagesState,
        annotations,
        savedAt: Date.now(),
      };

      const request = store.put(draft, DRAFT_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Failed to save draft to IndexedDB:', error);
  }
}

export async function loadDraft(): Promise<SavedDraft | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(DRAFT_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  } catch (error) {
    console.error('Failed to load draft from IndexedDB:', error);
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(DRAFT_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('Failed to clear draft from IndexedDB:', error);
  }
}
