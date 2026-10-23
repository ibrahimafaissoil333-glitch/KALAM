import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNetInfo } from '@react-native-community/netinfo';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api, ApiError, deviceInfo, Ebook, PublicConfig, rpc } from './api';
import { supabase } from './supabase';
import { wipeOffline } from './offline';
import { clearLibraryCache } from './progress';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Cart {
  items: Ebook[];
  totalCents: number;
  currency: string;
}

interface Store {
  ready: boolean;
  online: boolean;
  user: User | null;
  config: PublicConfig | null;
  checkoutMode: 'external' | 'web_only';
  cart: Cart;
  cartBusy: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { name: string; email: string; password: string; marketingConsent: boolean }): Promise<void>;
  logout(): Promise<void>;
  setUser(u: User): void;
  addToCart(e: Ebook): Promise<void>;
  removeFromCart(id: string): Promise<void>;
  refreshCart(): Promise<void>;
  /** Action à reprendre après la connexion (ex. « pay »). */
  afterLogin: string | null;
  setAfterLogin(a: string | null): void;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider manquant');
  return s;
};

const GUEST_CART = 'folio.guestCart';
const EMPTY: Cart = { items: [], totalCents: 0, currency: 'EUR' };

function summarize(items: Ebook[]): Cart {
  return { items, totalCents: items.reduce((n, e) => n + (e.priceCents ?? 0), 0), currency: items[0]?.currency ?? 'EUR' };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<User | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [cartBusy, setCartBusy] = useState(false);
  const [afterLogin, setAfterLogin] = useState<string | null>(null);
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const loadGuestCart = useCallback(async () => {
    try {
      setCart(summarize(JSON.parse((await AsyncStorage.getItem(GUEST_CART)) ?? '[]')));
    } catch {
      setCart(EMPTY);
    }
  }, []);

  const refreshCart = useCallback(async () => {
    if (!userRef.current) return loadGuestCart();
    const c = await api<{ items: Ebook[]; totalCents: number; currency: string }>('cart');
    setCart({ items: c.items, totalCents: c.totalCents, currency: c.currency });
  }, [loadGuestCart]);

  const resetLocal = useCallback(async () => {
    await wipeOffline();
    await clearLibraryCache();
    setUserState(null);
    setCart(EMPTY);
  }, []);

  // Démarrage : configuration publique, puis reprise de la session Supabase si elle existe.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUserState(null);
        userRef.current = null;
        loadGuestCart();
      }
    });
    (async () => {
      api<PublicConfig>('config').then(setConfig).catch(() => undefined);
      try {
        if ((await supabase.auth.getSession()).data.session) {
          const me = await api<User>('me');
          setUserState(me);
          userRef.current = me;
          await refreshCart();
        } else {
          await loadGuestCart();
        }
      } catch {
        // Hors ligne au démarrage : le compte reste connu tant que le jeton existe.
        await loadGuestCart();
      } finally {
        setReady(true);
      }
    })();
    return () => sub.subscription.unsubscribe();
  }, [loadGuestCart, refreshCart]);

  /**
   * Après connexion : enregistrement de l'appareil (limite configurable), puis fusion du panier
   * invité dans le panier du compte (CDC §5.4).
   */
  const startSession = useCallback(async () => {
    const d = await deviceInfo();
    try {
      await rpc('register_device', { p_key: d.deviceKey, p_label: d.deviceLabel, p_platform: d.platform });
    } catch (e) {
      await supabase.auth.signOut();
      throw e;
    }
    const me = await rpc<User>('me');
    setUserState(me);
    userRef.current = me;
    const guest: Ebook[] = JSON.parse((await AsyncStorage.getItem(GUEST_CART)) ?? '[]');
    const merged = await api<{ items: Ebook[]; totalCents: number; currency: string }>('cart/merge', { method: 'POST', body: { ebookIds: guest.map((e) => e.id) } });
    await AsyncStorage.removeItem(GUEST_CART);
    setCart({ items: merged.items, totalCents: merged.totalCents, currency: merged.currency });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // Message générique : on ne révèle pas si le compte existe (CA-09).
    if (error) throw new ApiError(error.status === 429 ? 429 : 401, error.status === 429 ? 'Trop de tentatives. Réessayez dans quelques minutes.' : 'E-mail ou mot de passe incorrect.');
    await startSession();
  }, [startSession]);

  const register = useCallback(async (input: { name: string; email: string; password: string; marketingConsent: boolean }) => {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { name: input.name, accept_terms: true, marketing_consent: input.marketingConsent } },
    });
    if (error) {
      const msg = /already/i.test(error.message) ? 'Un compte existe déjà avec cette adresse e-mail.'
        : /password/i.test(error.message) ? 'Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.'
        : error.message;
      throw new ApiError(400, msg);
    }
    if (!data.session) throw new ApiError(400, 'Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.');
    await startSession();
  }, [startSession]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut().catch(() => undefined);
    await resetLocal();
  }, [resetLocal]);

  const addToCart = useCallback(async (e: Ebook) => {
    setCartBusy(true);
    try {
      if (userRef.current) {
        const c = await api<Cart & { items: Ebook[] }>('cart/items', { method: 'POST', body: { ebookId: e.id } });
        setCart({ items: c.items, totalCents: c.totalCents, currency: c.currency });
      } else {
        const items = cart.items.some((i) => i.id === e.id) ? cart.items : [...cart.items, e];
        await AsyncStorage.setItem(GUEST_CART, JSON.stringify(items));
        setCart(summarize(items));
      }
    } finally {
      setCartBusy(false);
    }
  }, [cart.items]);

  const removeFromCart = useCallback(async (id: string) => {
    if (userRef.current) {
      const c = await api<Cart & { items: Ebook[] }>(`cart/items/${id}`, { method: 'DELETE' });
      setCart({ items: c.items, totalCents: c.totalCents, currency: c.currency });
    } else {
      const items = cart.items.filter((i) => i.id !== id);
      await AsyncStorage.setItem(GUEST_CART, JSON.stringify(items));
      setCart(summarize(items));
    }
  }, [cart.items]);

  const value = useMemo<Store>(() => ({
    ready, online, user, config, cart, cartBusy, afterLogin,
    checkoutMode: config?.checkoutMode[Platform.OS === 'ios' ? 'ios' : 'android'] ?? 'external',
    login, register, logout, addToCart, removeFromCart, refreshCart, setAfterLogin,
    setUser: setUserState,
  }), [ready, online, user, config, cart, cartBusy, afterLogin, login, register, logout, addToCart, removeFromCart, refreshCart]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
