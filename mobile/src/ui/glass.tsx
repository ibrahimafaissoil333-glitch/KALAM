import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { color, scheme } from './theme';

const liquid = (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

/**
 * Surface « verre » : Liquid Glass natif sur iOS 26 et plus, sinon flou translucide (expo-blur)
 * avec un liseré clair. Utilisée par Card et la barre d'onglets quand le mode verre est actif.
 */
export function GlassSurface({ children, style, radius = 18 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius?: number }) {
  if (liquid) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme={scheme} style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: color.glassBorder }, style]}>
      <BlurView intensity={40} tint={scheme === 'dark' ? 'dark' : 'light'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.glassFill }} />
      {children}
    </View>
  );
}

/**
 * Fond doux derrière les écrans en mode verre : quelques halos colorés (cercles concentriques
 * de plus en plus transparents) que les surfaces en verre laissent deviner.
 */
export function GlassBackdrop() {
  const halo = (c: string, s: number, pos: ViewStyle) => (
    <View style={[{ position: 'absolute', width: s, height: s, alignItems: 'center', justifyContent: 'center' }, pos]}>
      {[1, 0.88, 0.76, 0.64, 0.52, 0.4, 0.28].map((k) => (
        <View key={k} style={{ position: 'absolute', width: s * k, height: s * k, borderRadius: (s * k) / 2, backgroundColor: c, opacity: scheme === 'dark' ? 0.045 : 0.04 }} />
      ))}
    </View>
  );
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.paper, overflow: 'hidden' }}>
      {halo(color.accent, 520, { top: -200, left: -220 })}
      {halo(color.gold, 460, { top: 240, right: -240 })}
      {halo(color.accent, 420, { bottom: -180, left: -120 })}
    </View>
  );
}
