import { router } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import type { Order } from '@/lib/api';
import { money, plural, shortDate } from '@/lib/format';
import { useQuery } from '@/lib/use-query';
import { EmptyState, ErrorBanner, ScreenHeader, Skeleton, StatusPill, T } from '@/ui/components';
import { color, gutter } from '@/ui/theme';

export default function OrdersScreen() {
  const { data, error, reload } = useQuery<Order[]>('orders');
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(o) => o.id}
      ListHeaderComponent={
        <View>
          <ScreenHeader back title="Mes commandes" />
          {error && <View style={{ paddingHorizontal: gutter }}><ErrorBanner message={error} onRetry={reload} /></View>}
        </View>
      }
      contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
      ListEmptyComponent={!data ? <View style={{ padding: gutter, gap: 12 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={64} />)}</View> : <EmptyState icon="doc" title="Aucune commande" />}
      renderItem={({ item: o }) => (
        <Pressable onPress={() => router.push({ pathname: '/checkout/result', params: { order: o.id } })} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, marginHorizontal: gutter, borderBottomWidth: 1, borderBottomColor: color.divider }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T weight="bold" style={{ fontSize: 15 }}>Commande {o.reference}</T>
            <T muted style={{ fontSize: 13 }}>{shortDate(o.createdAt)} · {plural(o.items.length)} · {money(o.totalCents, o.currency)}</T>
            <T muted numberOfLines={1} style={{ fontSize: 13 }}>{o.items.map((i) => i.title).join(', ')}</T>
          </View>
          <StatusPill status={o.status} />
        </Pressable>
      )}
    />
  );
}
