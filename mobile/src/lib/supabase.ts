import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseKey?: string };
export const SUPABASE_URL: string = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? 'http://127.0.0.1:54321';
export const SUPABASE_KEY: string = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? extra.supabaseKey ?? '';

/**
 * Session chiffrée : la session (trop longue pour le Keychain) est stockée chiffrée en AES-256-GCM
 * dans AsyncStorage, avec une clé gardée dans le Keychain / Keystore.
 */
const KEY_NAME = 'folio.session.key';
let keyP: Promise<AESEncryptionKey> | null = null;
const key = () =>
  (keyP ??= (async () => {
    const k = await SecureStore.getItemAsync(KEY_NAME);
    if (k) return AESEncryptionKey.import(k, 'base64');
    const g = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(KEY_NAME, await g.encoded('base64'));
    return g;
  })());

const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const secureStorage = {
  async getItem(name: string) {
    const v = await AsyncStorage.getItem(name);
    if (!v) return null;
    try {
      const plain = (await aesDecryptAsync(AESSealedData.fromCombined(fromB64(v)), await key(), { output: 'bytes' })) as Uint8Array;
      return new TextDecoder().decode(plain);
    } catch {
      await AsyncStorage.removeItem(name);
      return null;
    }
  },
  async setItem(name: string, value: string) {
    const sealed = await aesEncryptAsync(new TextEncoder().encode(value), await key());
    await AsyncStorage.setItem(name, toB64((await sealed.combined('bytes')) as Uint8Array));
  },
  removeItem: (name: string) => AsyncStorage.removeItem(name),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
});

export const coverUrl = (path: string | null | undefined) => (path ? `${SUPABASE_URL}/storage/v1/object/public/covers/${path}` : null);
