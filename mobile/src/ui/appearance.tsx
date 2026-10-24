import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { refreshStyles } from './components';
import { GlassBackdrop } from './glass';
import { applyGlass, applyScheme, color } from './theme';

const GLASS_KEY = 'kalam.glass';
const MODE_KEY = 'kalam.theme';

/** « auto » suit le réglage du téléphone ; « light » / « dark » forcent le thème. */
export type ThemeMode = 'auto' | 'light' | 'dark';

const Ctx = createContext<{ glass: boolean; setGlass: (v: boolean) => void; mode: ThemeMode; setMode: (m: ThemeMode) => void }>({
  glass: false, setGlass: () => {}, mode: 'auto', setMode: () => {},
});
export const useAppearance = () => useContext(Ctx);

/**
 * Thème clair / sombre (automatique selon le téléphone, ou choisi par l'utilisateur) et mode verre.
 * La palette est appliquée avant le rendu ; l'arbre est remonté (key) quand l'un des deux change.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [glass, setGlassState] = useState<boolean | null>(null);
  const [mode, setModeState] = useState<ThemeMode>('auto');
  const scheme = mode === 'auto' ? (system === 'dark' ? 'dark' : 'light') : mode;

  useEffect(() => {
    AsyncStorage.multiGet([GLASS_KEY, MODE_KEY])
      .then(([[, g], [, m]]) => {
        if (m === 'light' || m === 'dark') setModeState(m);
        setGlassState(g === '1');
      })
      .catch(() => setGlassState(false));
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(MODE_KEY, m).catch(() => undefined);
  }, []);

  const setGlass = useCallback((v: boolean) => {
    setGlassState(v);
    AsyncStorage.setItem(GLASS_KEY, v ? '1' : '0').catch(() => undefined);
  }, []);

  applyScheme(scheme);
  applyGlass(!!glass);
  refreshStyles();

  if (glass === null) return null;
  return (
    <Ctx.Provider value={{ glass, setGlass, mode, setMode }}>
      <View key={`${scheme}-${glass}`} style={{ flex: 1, backgroundColor: color.paper }}>
        {glass && <GlassBackdrop />}
        {children}
      </View>
    </Ctx.Provider>
  );
}
