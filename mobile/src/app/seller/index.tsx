import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import type { SellerEbook } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { useQuery } from '@/lib/use-query';
import { Button, Card, Cover, Divider, EmptyState, ErrorBanner, KindBadge, RowLink, ScreenHeader, Skeleton, T } from '@/ui/components';
import { color, gutter } from '@/ui/theme';

interface Dashboard {
  listings: { onSale: number; paused: number; drafts: number };
  sold: number;
  toShip: number;
  earnings: { currency: string; availableCents: number; paidOutCents: number; totalCents: number }[];
  recentSales: { title: string; kind: 'PHYSICAL' | 'DIGITAL'; date: string; reference: string; currency: string; netCents: number | null; status: string }[];
}

const LISTING_STATUS: Record<SellerEbook['status'], [string, string, string]> = {
  PUBLISHED: ['En vente', color.successSoft, color.successText],
  PAUSED: ['En pause', color.warningSoft, color.warningText],
  DRAFT: ['Brouillon', color.neutralSoft, color.neutralText],
  ARCHIVED: ['Retirée', color.neutralSoft, color.neutralText],
};

/** Espace vendeur : chiffres clés, gains, annonces. Tout utilisateur connecté peut vendre. */
export default function SellerHome() {
  const { data: d, error, reload } = useQuery<Dashboard>('seller/dashboard');
  const { data: listings } = useQuery<SellerEbook[]>('seller/ebooks');

  const stat = (label: string, value: number | string) => (
    <Card style={{ flex: 1, padding: 14, borderRadius: 14 }}>
      <T muted weight="semibold" style={{ fontSize: 12 }}>{label}</T>
      <T weight="bold" style={{ fontSize: 22 }}>{value}</T>
    </Card>
  );

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <ScreenHeader back title="Espace vendeur" sub="Vendez vos livres papier ou numériques à toute la communauté." />
      <View style={{ paddingHorizontal: gutter, gap: 16 }}>
        {error && <ErrorBanner message={error} onRetry={reload} />}
        <Button label="Mettre un livre en vente" variant="accent" icon="plus" onPress={() => router.push('/seller/edit')} />

        {!d ? <Skeleton h={160} /> : (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {stat('En vente', d.listings.onSale)}
              {stat('Vendus', d.sold)}
              {stat('À expédier', d.toShip)}
            </View>
            <Card style={{ padding: 16, gap: 10 }}>
              <T weight="bold" style={{ fontSize: 17 }}>Mes gains</T>
              {d.earnings.length === 0 ? (
                <T muted style={{ fontSize: 14 }}>Vos gains apparaîtront ici après votre première vente (commission Folio déduite).</T>
              ) : d.earnings.map((g) => (
                <View key={g.currency} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <T muted style={{ fontSize: 14 }}>Disponible</T>
                    <T weight="bold" style={{ fontSize: 15, color: color.successText }}>{money(g.availableCents, g.currency)}</T>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <T muted style={{ fontSize: 14 }}>Déjà versé</T>
                    <T style={{ fontSize: 15 }}>{money(g.paidOutCents, g.currency)}</T>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <T muted style={{ fontSize: 14 }}>Total des ventes nettes</T>
                    <T style={{ fontSize: 15 }}>{money(g.totalCents, g.currency)}</T>
                  </View>
                </View>
              ))}
            </Card>
          </>
        )}

        <Card style={{ paddingHorizontal: 16 }}>
          <RowLink icon="truck" label="Expéditions" sub={d?.toShip ? `${d.toShip} livre${d.toShip > 1 ? 's' : ''} à envoyer` : 'Livres physiques vendus'} onPress={() => router.push('/seller/shipments')} />
          <Divider />
          <RowLink icon="wallet" label="Moyens de réception" sub="Compte bancaire ou Mobile Money" onPress={() => router.push('/seller/payout')} />
        </Card>

        <T serif accessibilityRole="header" style={{ fontSize: 26, marginTop: 8 }}>Mes annonces</T>
        {!listings ? <Skeleton h={100} /> : listings.length === 0 ? (
          <EmptyState icon="tag" title="Aucune annonce" text="Ajoutez votre premier livre : physique (état, stock, livraison) ou numérique (PDF ou EPUB)." />
        ) : (
          <Card>
            {listings.map((e, i) => {
              const [label, bg, fg] = LISTING_STATUS[e.status];
              return (
                <Pressable
                  key={e.id}
                  onPress={() => router.push({ pathname: '/seller/edit', params: { id: e.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.title}, ${label}. Modifier`}
                  style={({ pressed }) => [{ flexDirection: 'row', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: color.divider }, pressed && { opacity: 0.7 }]}
                >
                  <Cover title={e.title} author={e.author} cover={e.cover} width={48} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <T weight="bold" style={{ fontSize: 15 }} numberOfLines={2}>{e.title}</T>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <KindBadge kind={e.kind} />
                      <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                        <T weight="bold" style={{ fontSize: 11, color: fg }}>{label}</T>
                      </View>
                    </View>
                    <T muted style={{ fontSize: 13 }}>
                      {money(e.priceCents, e.currency)} · {e.sales} vendu{e.sales > 1 ? 's' : ''}{e.kind === 'PHYSICAL' ? ` · stock ${e.stock ?? 0}` : ''}
                    </T>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}

        {d && d.recentSales.length > 0 && (
          <>
            <T serif accessibilityRole="header" style={{ fontSize: 26, marginTop: 8 }}>Dernières ventes</T>
            <Card>
              {d.recentSales.map((s, i) => (
                <View key={`${s.reference}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: color.divider }}>
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" style={{ fontSize: 15 }}>{s.title}</T>
                    <T muted style={{ fontSize: 13 }}>{shortDate(s.date)} · {s.reference}{s.status === 'REFUNDED' ? ' · remboursée' : ''}</T>
                  </View>
                  <T weight="bold" style={{ fontSize: 15, color: s.status === 'REFUNDED' ? color.muted : color.ink }}>{s.netCents === null ? '—' : money(s.netCents, s.currency)}</T>
                </View>
              ))}
            </Card>
          </>
        )}
      </View>
    </ScrollView>
  );
}
