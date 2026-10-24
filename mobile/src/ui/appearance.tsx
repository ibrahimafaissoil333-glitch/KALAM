import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { refreshStyles } from './components';
import { GlassBackdrop } from './glass';
import { applyGlass, applyScheme, color } from './theme';

const GLASS_KEY = 'kalam.glass';

const Ctx = createContext<{ glass: boolean; setGlass: (v: boolean) => void }>({ glass: false, setGlass: () => {} });
export const useAppearance = () => useContext(Ctx);

/**
 * Thème clair / sombre selon le réglage du téléphone, et mode verre choisi par l'utilisateur.
 * La palette est appliquée avant le rendu ; l'arbre est remonté (key) quand l'un des deux change.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const scheme = system === 'dark' ? 'dark' : 'light';
  const [glass, setGlassState] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(GLASS_KEY).then((v) => setGlassState(v === '1')).catch(() => setGlassState(false));
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
    <Ctx.Provider value={{ glass, setGlass }}>
      <View key={`${scheme}-${glass}`} style={{ flex: 1, backgroundColor: color.paper }}>
        {glass && <GlassBackdrop />}
        {children}
      </View>
    </Ctx.Provider>
  );
}
