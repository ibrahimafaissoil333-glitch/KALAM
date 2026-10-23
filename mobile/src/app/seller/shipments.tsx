import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { api, Address, errorMessage, ShippingMode } from '@/lib/api';
import { COUNTRY_LABEL, SHIPPING_LABEL, shortDate } from '@/lib/format';
import { useQuery } from '@/lib/use-query';
import { Button, Card, EmptyState, ErrorBanner, ScreenHeader, Skeleton, T, TextField, useToast } from '@/ui/components';
import { color, gutter } from '@/ui/theme';

interface SellerShipment {
  id: string;
  status: 'TO_SHIP' | 'SHIPPED' | 'DELIVERED' | 'CANCELED';
  address: Omit<Address, 'id'>;
  tracking: string | null;
  createdAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  reference: string;
  items: { title: string; shippingMode: ShippingMode | null }[];
}

const LABEL = { TO_SHIP: 'À expédier', SHIPPED: 'Expédié', DELIVERED: 'Reçu par l’acheteur', CANCELED: 'Annulé (remboursé)' } as const;

/** Livres physiques vendus : adresse de l'acheteur (visible du seul vendeur) et envoi. */
export default function SellerShipments() {
  const { data, error, reload, setData } = useQuery<SellerShipment[]>('seller/shipments');
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const toast = useToast();

  const shipped = async (s: SellerShipment) => {
    setBusy(s.id);
    setActionError(null);
    try {
      setData(await api<SellerShipment[]>(`seller/shipments/${s.id}/shipped`, { method: 'POST', body: { tracking: tracking[s.id] } }));
      toast('Expédition enregistrée, l’acheteur est prévenu');
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={
        <View>
          <ScreenHeader back title="Expéditions" />
          {(error || actionError) && <View style={{ paddingHorizontal: gutter }}><ErrorBanner message={(error ?? actionError)!} onRetry={error ? reload : undefined} /></View>}
        </View>
      }
      contentContainerStyle={{ paddingBottom: 24, flexGrow: 1, gap: 12 }}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={!data ? <View style={{ padding: gutter }}><Skeleton h={140} /></View> : <EmptyState icon="truck" title="Rien à expédier" text="Quand vous vendez un livre physique, l’adresse de l’acheteur apparaît ici." />}
      renderItem={({ item: s }) => (
        <Card style={{ marginHorizontal: gutter, padding: 16, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T weight="bold" style={{ fontSize: 15 }}>Commande {s.reference}</T>
            <T weight="semibold" style={{ fontSize: 13, color: s.status === 'TO_SHIP' ? color.warningText : color.muted }}>{LABEL[s.status]}</T>
          </View>
          <T muted style={{ fontSize: 13 }}>{shortDate(s.createdAt)}</T>
          {s.items.map((i, n) => <T key={n} style={{ fontSize: 15 }}>• {i.title}{i.shippingMode ? ` — ${SHIPPING_LABEL[i.shippingMode]}` : ''}</T>)}
          <View style={{ backgroundColor: color.paper, borderRadius: 12, padding: 12, gap: 2 }}>
            <T weight="semibold" style={{ fontSize: 14 }}>{s.address.fullName}</T>
            <T style={{ fontSize: 14 }}>{[s.address.line1, s.address.line2].filter(Boolean).join(', ')}</T>
            <T style={{ fontSize: 14 }}>{[s.address.postalCode, s.address.city, COUNTRY_LABEL[s.address.country] ?? s.address.country].filter(Boolean).join(' ')}</T>
            {s.address.phone && <T style={{ fontSize: 14 }}>Tél. {s.address.phone}</T>}
          </View>
          {s.tracking && <T style={{ fontSize: 14 }}>Suivi : <T weight="bold">{s.tracking}</T></T>}
          {s.status === 'TO_SHIP' && (
            <>
              <TextField label="Numéro de suivi (facultatif)" value={tracking[s.id] ?? ''} onChangeText={(v) => setTracking({ ...tracking, [s.id]: v })} autoCapitalize="characters" />
              <Button label="Marquer comme expédié" variant="accent" small icon="truck" loading={busy === s.id} onPress={() => shipped(s)} />
            </>
          )}
        </Card>
      )}
    />
  );
}
