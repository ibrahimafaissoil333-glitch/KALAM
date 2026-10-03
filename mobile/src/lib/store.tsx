import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNetInfo } from '@react-native-community/netinfo';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { api, deviceInfo, Ebook, PublicConfig, session, SessionResponse } from './api';
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
    session.setAccess(null);
    await session.setRefresh(null);
    await wipeOffline();
    await clearLibraryCache();
    setUserState(null);
    setCart(EMPTY);
  }, []);

  // Démarrage : configuration publique, puis reprise de session si un jeton existe.
  useEffect(() => {
    session.onLost(() => {
      setUserState(null);
      loadGuestCart();
    });
    (async () => {
      api<PublicConfig>('config', { auth: false }).then(setConfig).catch(() => undefined);
      try {
        if (await session.getRefresh()) {
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
  }, [loadGuestCart, refreshCart]);

  /** Après connexion : le panier invité est fusionné dans le panier du compte (CDC §5.4). */
  const startSession = useCallback(async (s: SessionResponse) => {
    session.setAccess(s.accessToken);
    await session.setRefresh(s.refreshToken);
    setUserState(s.user);
    userRef.current = s.user;
    const guest: Ebook[] = JSON.parse((await AsyncStorage.getItem(GUEST_CART)) ?? '[]');
    const merged = await api<{ items: Ebook[]; totalCents: number; currency: string }>('cart/merge', { method: 'POST', body: { ebookIds: guest.map((e) => e.id) } });
    await AsyncStorage.removeItem(GUEST_CART);
    setCart({ items: merged.items, totalCents: merged.totalCents, currency: merged.currency });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const s = await api<SessionResponse>('auth/login', { method: 'POST', auth: false, body: { email, password, ...(await deviceInfo()) } });
    await startSession(s);
  }, [startSession]);

  const register = useCallback(async (input: { name: string; email: string; password: string; marketingConsent: boolean }) => {
    const s = await api<SessionResponse>('auth/register', { method: 'POST', auth: false, body: { ...input, acceptTerms: true, ...(await deviceInfo()) } });
    await startSession(s);
  }, [startSession]);

  const logout = useCallback(async () => {
    const rt = await session.getRefresh();
    if (rt) api('auth/logout', { method: 'POST', auth: false, body: { refreshToken: rt } }).catch(() => undefined);
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
