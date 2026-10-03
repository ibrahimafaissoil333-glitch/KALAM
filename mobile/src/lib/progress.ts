import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, LibraryItem } from './api';

/**
 * Progression de lecture : enregistrée localement tout de suite, envoyée au serveur ensuite.
 * Hors ligne, elle attend dans une file et part à la prochaine synchronisation.
 */
export interface Progress {
  chapterIndex: number;
  blockIndex: number;
  percent: number;
  updatedAt: string;
}

const PENDING = 'folio.progress.pending';
const LOCAL = 'folio.progress.local';
const LIBRARY_CACHE = 'folio.library.cache';

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    return JSON.parse((await AsyncStorage.getItem(key)) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

export async function localProgress(ebookId: string): Promise<Progress | null> {
  return (await read<Record<string, Progress>>(LOCAL, {}))[ebookId] ?? null;
}

export async function saveProgress(ebookId: string, p: Omit<Progress, 'updatedAt'>) {
  const entry = { ...p, updatedAt: new Date().toISOString() };
  const local = await read<Record<string, Progress>>(LOCAL, {});
  local[ebookId] = entry;
  await AsyncStorage.setItem(LOCAL, JSON.stringify(local));
  try {
    await api(`library/${ebookId}/progress`, { method: 'PUT', body: p });
  } catch {
    const pending = await read<Record<string, Progress>>(PENDING, {});
    pending[ebookId] = entry;
    await AsyncStorage.setItem(PENDING, JSON.stringify(pending));
  }
}

export async function flushProgress() {
  const pending = await read<Record<string, Progress>>(PENDING, {});
  for (const [id, p] of Object.entries(pending)) {
    try {
      await api(`library/${id}/progress`, { method: 'PUT', body: { chapterIndex: p.chapterIndex, blockIndex: p.blockIndex, percent: p.percent } });
      delete pending[id];
    } catch {
      // Droit retiré (403) : inutile de réessayer.
      delete pending[id];
    }
  }
  await AsyncStorage.setItem(PENDING, JSON.stringify(pending));
}

/** La plus récente entre la progression locale et celle du serveur (« dernier écrit gagne »). */
export function latest(a: Progress | null, b: Progress | null): Progress | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a.updatedAt) >= new Date(b.updatedAt) ? a : b;
}

export const cacheLibrary = (items: LibraryItem[]) => AsyncStorage.setItem(LIBRARY_CACHE, JSON.stringify(items));
export const cachedLibrary = () => read<LibraryItem[]>(LIBRARY_CACHE, []);
export const clearLibraryCache = () => AsyncStorage.multiRemove([LIBRARY_CACHE, LOCAL, PENDING]);
