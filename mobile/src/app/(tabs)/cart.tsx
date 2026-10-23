import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { errorMessage } from '@/lib/api';
import { CONDITION_LABEL, money } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Button, Card, Cover, Divider, EmptyState, ErrorBanner, InfoNote, KindBadge, ScreenHeader, StepBar, T, useToast } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, gutter } from '@/ui/theme';

export default function CartScreen() {
  const { cart, removeFromCart, refreshCart, user, setAfterLogin, online, checkoutMode } = useStore();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refreshCart().catch(() => undefined);
    }, [refreshCart]),
  );

  const remove = async (id: string) => {
    setError(null);
    try {
      await removeFromCart(id);
      toast('Retiré du panier');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const checkout = () => {
    if (user) router.push('/checkout/pay');
    else {
      setAfterLogin('pay');
      router.push({ pathname: '/login', params: { reason: 'checkout' } });
    }
  };

  const hasPhysical = cart.items.some((e) => e.kind === 'PHYSICAL');
  const mixedCurrencies = new Set(cart.items.map((e) => e.currency)).size > 1;

  if (cart.items.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Panier" />
        <EmptyState icon="cart" title="Votre panier est vide" text="Ajoutez un livre depuis le catalogue pour le retrouver ici.">
          <Button label="Explorer le catalogue" onPress={() => router.navigate('/catalog')} />
        </EmptyState>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Panier" />
      <StepBar step={1} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 16 }}>
        {error && <ErrorBanner message={error} />}
        {cart.items.map((e) => (
          <View key={e.id} style={{ flexDirection: 'row', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: color.divider }}>
            <Pressable onPress={() => router.push({ pathname: '/ebook/[slug]', params: { slug: e.slug } })} accessibilityRole="link" accessibilityLabel={`Voir la fiche de ${e.title}`}>
              <Cover title={e.title} author={e.author} cover={e.cover} width={72} />
            </Pressable>
            <View style={{ flex: 1, gap: 4 }}>
              <T weight="bold">{e.title}</T>
              <T muted style={{ fontSize: 14 }}>{e.author}</T>
              <KindBadge kind={e.kind} style={{ marginTop: 2 }} />
              <T muted style={{ fontSize: 13 }}>
                {e.kind === 'PHYSICAL' ? `${e.condition ? CONDITION_LABEL[e.condition] : 'Livre'} · vendu par ${e.seller?.name ?? 'Kalam'}` : 'Exemplaire numérique personnel'}
              </T>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                <T weight="bold">{money(e.priceCents, e.currency)}</T>
                <Pressable onPress={() => remove(e.id)} accessibilityRole="button" accessibilityLabel={`Retirer ${e.title} du panier`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}>
                  <Icon name="trash" size={18} color={color.muted} />
                  <T weight="semibold" muted style={{ fontSize: 14 }}>Retirer</T>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
        <Card style={{ padding: 18, gap: 12, marginTop: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T muted style={{ fontSize: 15 }}>Sous-total ({cart.items.length} livre{cart.items.length > 1 ? 's' : ''})</T>
            <T style={{ fontSize: 15 }}>{money(cart.totalCents, cart.currency)}</T>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T muted style={{ fontSize: 15 }}>{hasPhysical ? 'Livraison' : 'Taxes'}</T>
            <T style={{ fontSize: 15 }}>{hasPhysical ? 'Choisie à l’étape suivante' : 'TTC, détail à la confirmation'}</T>
          </View>
          <Divider />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T weight="bold" style={{ fontSize: 17 }}>{hasPhysical ? 'Total hors livraison' : 'Total'}</T>
            <T weight="bold" style={{ fontSize: 17 }}>{money(cart.totalCents, cart.currency)}</T>
          </View>
        </Card>
        <View style={{ paddingTop: 14, paddingHorizontal: 4 }}>
          {mixedCurrencies ? (
            <InfoNote icon="alert" tone="accent">Vos livres sont dans des devises différentes. Une commande ne peut contenir qu’une devise : retirez les livres d’une autre devise pour continuer.</InfoNote>
          ) : (
            <InfoNote>
              {hasPhysical
                ? 'Les livres physiques sont expédiés par leur vendeur. Les livres numériques sont disponibles dès la confirmation du paiement.'
                : 'Produits numériques : aucun envoi physique. L’accès est activé dès la confirmation du paiement.'}
            </InfoNote>
          )}
        </View>
      </ScrollView>
      <View style={{ padding: gutter, gap: 8 }}>
        {!online && <T muted style={{ fontSize: 13, textAlign: 'center' }}>Le paiement nécessite une connexion internet.</T>}
        {checkoutMode === 'web_only' ? (
          <T muted style={{ fontSize: 14, textAlign: 'center' }}>L’achat se fait sur notre site. Vos e-books apparaîtront ensuite dans votre bibliothèque.</T>
        ) : (
          <Button label="Passer au paiement" variant="accent" iconRight="arrow" disabled={!online || mixedCurrencies} onPress={checkout} />
        )}
      </View>
    </View>
  );
}
