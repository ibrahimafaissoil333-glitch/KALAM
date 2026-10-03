import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { BookContent } from './api';

/**
 * Lecture hors ligne chiffrée (docs/03-conception-technique.md §6).
 * Contenu chiffré en AES-256-GCM ; clé propre à l'appareil, gardée dans le Keychain / Keystore.
 */
const KEY_NAME = 'folio.offline.key';
const META_KEY = 'folio.offline.meta';
const dir = () => new Directory(Paths.document, 'offline');
const fileFor = (ebookId: string) => new File(dir(), `${ebookId}.bin`);

export interface OfflineMeta {
  [ebookId: string]: { version: string | null; savedAt: string };
}

let keyPromise: Promise<AESEncryptionKey> | null = null;
function key(): Promise<AESEncryptionKey> {
  keyPromise ??= (async () => {
    const stored = await SecureStore.getItemAsync(KEY_NAME);
    if (stored) return AESEncryptionKey.import(stored, 'base64');
    const k = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(KEY_NAME, await k.encoded('base64'));
    return k;
  })();
  return keyPromise;
}

export async function offlineMeta(): Promise<OfflineMeta> {
  try {
    return JSON.parse((await AsyncStorage.getItem(META_KEY)) ?? '{}');
  } catch {
    return {};
  }
}

async function setMeta(m: OfflineMeta) {
  await AsyncStorage.setItem(META_KEY, JSON.stringify(m));
}

export async function saveOffline(content: BookContent) {
  const d = dir();
  if (!d.exists) d.create({ intermediates: true });
  const plain = new TextEncoder().encode(JSON.stringify(content));
  const sealed = await aesEncryptAsync(plain, await key());
  const f = fileFor(content.ebookId);
  if (f.exists) f.delete();
  f.create();
  f.write((await sealed.combined('bytes')) as Uint8Array);
  const meta = await offlineMeta();
  meta[content.ebookId] = { version: content.contentVersion ?? null, savedAt: new Date().toISOString() };
  await setMeta(meta);
}

export async function loadOffline(ebookId: string): Promise<BookContent | null> {
  const f = fileFor(ebookId);
  if (!f.exists) return null;
  try {
    const sealed = AESSealedData.fromCombined(await f.bytes());
    const plain = (await aesDecryptAsync(sealed, await key(), { output: 'bytes' })) as Uint8Array;
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    await removeOffline(ebookId);
    return null;
  }
}

export async function removeOffline(ebookId: string) {
  const f = fileFor(ebookId);
  if (f.exists) f.delete();
  const meta = await offlineMeta();
  delete meta[ebookId];
  await setMeta(meta);
}

/**
 * Synchronise avec les droits du serveur : un e-book remboursé ou retiré est effacé de l'appareil,
 * et une version de contenu obsolète est supprimée (elle sera retéléchargée).
 */
export async function reconcileOffline(owned: { id: string; contentVersion: string | null }[]) {
  const meta = await offlineMeta();
  const byId = new Map(owned.map((o) => [o.id, o.contentVersion]));
  for (const [id, m] of Object.entries(meta)) {
    if (!byId.has(id) || (byId.get(id) && m.version && byId.get(id) !== m.version)) await removeOffline(id);
  }
}

/** À la déconnexion, les contenus du compte quittent l'appareil. */
export async function wipeOffline() {
  const d = dir();
  if (d.exists) d.delete();
  await AsyncStorage.removeItem(META_KEY);
}
