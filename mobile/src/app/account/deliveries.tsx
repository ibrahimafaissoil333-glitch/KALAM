import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { api, errorMessage, Order, Shipment } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { useQuery } from '@/lib/use-query';
import { Button, Card, EmptyState, ErrorBanner, ScreenHeader, Skeleton, T, useToast } from '@/ui/components';
import { color, gutter } from '@/ui/theme';

const SHIPMENT: Record<Shipment['status'], [string, string, string]> = {
  TO_SHIP: ['En préparation', color.warningSoft, color.warningText],
  SHIPPED: ['Expédié', color.accentSoft, color.accentText],
  DELIVERED: ['Reçu', color.successSoft, color.successText],
  CANCELED: ['Annulé', color.neutralSoft, color.neutralText],
};

/** Livres physiques achetés : suivi de l'envoi et confirmation de réception. */
export default function DeliveriesScreen() {
  const { data, error, reload, setData } = useQuery<Order[]>('me/physical-orders');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();

  const received = async (s: Shipment) => {
    setBusy(s.id);
    setActionError(null);
    try {
      const o = await api<Order>(`shipments/${s.id}/delivered`, { method: 'POST' });
      setData((data ?? []).map((x) => (x.id === o.id ? o : x)));
      toast('Réception confirmée');
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(o) => o.id}
      ListHeaderComponent={
        <View>
          <ScreenHeader back title="Livres à recevoir" />
          {(error || actionError) && <View style={{ paddingHorizontal: gutter }}><ErrorBanner message={(error ?? actionError)!} onRetry={error ? reload : undefined} /></View>}
        </View>
      }
      contentContainerStyle={{ paddingBottom: 24, flexGrow: 1, gap: 12 }}
      ListEmptyComponent={!data ? <View style={{ padding: gutter, gap: 12 }}>{[0, 1].map((i) => <Skeleton key={i} h={120} />)}</View> : <EmptyState icon="truck" title="Aucun livre physique" text="Les livres papier que vous achetez apparaîtront ici, avec leur suivi." />}
      renderItem={({ item: o }) => (
        <Card style={{ marginHorizontal: gutter, padding: 16, gap: 10 }}>
          <T weight="bold" style={{ fontSize: 15 }}>Commande {o.reference}</T>
          <T muted style={{ fontSize: 13 }}>{shortDate(o.createdAt)}</T>
          {o.items.filter((i) => i.kind === 'PHYSICAL').map((i) => <T key={i.ebookId} style={{ fontSize: 15 }}>• {i.title}</T>)}
          {o.shipments?.map((s) => {
            const [label, bg, fg] = SHIPMENT[s.status];
            return (
              <View key={s.id} style={{ gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: color.divider }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <T muted style={{ fontSize: 14 }}>Vendeur : {s.seller?.name ?? 'Folio'}</T>
                  <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
                    <T weight="bold" style={{ fontSize: 12, color: fg }}>{label}</T>
                  </View>
                </View>
                {s.tracking && <T style={{ fontSize: 14 }}>Suivi : <T weight="bold">{s.tracking}</T></T>}
                {(s.status === 'SHIPPED' || s.status === 'TO_SHIP') && o.status === 'PAID' && (
                  <Button label="J’ai reçu ce livre" variant="ghost" small icon="check" loading={busy === s.id} onPress={() => received(s)} />
                )}
              </View>
            );
          })}
        </Card>
      )}
    />
  );
}
