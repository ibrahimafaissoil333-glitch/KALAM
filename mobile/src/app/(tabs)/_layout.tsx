import { Tabs } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/lib/store';
import { OfflineBanner, T } from '@/ui/components';
import { Icon, IconName } from '@/ui/icons';
import { color } from '@/ui/theme';

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'index', label: 'Accueil', icon: 'home' },
  { name: 'catalog', label: 'Catalogue', icon: 'grid' },
  { name: 'library', label: 'Bibliothèque', icon: 'books' },
  { name: 'cart', label: 'Panier', icon: 'cart' },
  { name: 'account', label: 'Compte', icon: 'user' },
];

export default function TabsLayout() {
  const { cart, online } = useStore();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.paper } }}
        tabBar={({ state, navigation }) => (
          <View>
            {!online && <OfflineBanner />}
            <View
              accessibilityRole="tablist"
              style={{ flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, paddingTop: 6, paddingHorizontal: 6, paddingBottom: Math.max(insets.bottom, 10) }}
            >
              {TABS.map((t, i) => {
                const active = state.index === i;
                const badge = t.name === 'cart' && cart.items.length > 0 ? cart.items.length : 0;
                const fg = active ? color.indigo : color.muted;
                return (
                  <Pressable
                    key={t.name}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={badge ? `${t.label}, ${badge} article${badge > 1 ? 's' : ''}` : t.label}
                    onPress={() => {
                      const ev = navigation.emit({ type: 'tabPress', target: state.routes[i].key, canPreventDefault: true });
                      if (!active && !ev.defaultPrevented) navigation.navigate(state.routes[i].name);
                    }}
                    style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 54 }}
                  >
                    <View>
                      <Icon name={t.icon} size={24} color={fg} />
                      {badge > 0 && (
                        <View style={{ position: 'absolute', top: -4, left: 16, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.indigo, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                          <T weight="bold" allowFontScaling={false} style={{ color: '#FFFFFF', fontSize: 11 }}>{badge}</T>
                        </View>
                      )}
                    </View>
                    <T weight="semibold" maxFontSizeMultiplier={1.3} style={{ fontSize: 11, color: fg }}>{t.label}</T>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      >
        {TABS.map((t) => (
          <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
        ))}
      </Tabs>
    </View>
  );
}
