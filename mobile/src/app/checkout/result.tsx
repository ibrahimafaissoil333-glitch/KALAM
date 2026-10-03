import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, errorMessage, Order } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Button, Card, ErrorBanner, InfoNote, LinkButton, StatusPill, StepBar, T } from '@/ui/components';
import { Icon, IconName } from '@/ui/icons';
import { color, gutter } from '@/ui/theme';

const POLL_MS = 3000;
const POLL_LIMIT_MS = 2 * 60_000;

/** Résultat d'un paiement, selon le statut renvoyé par le serveur (interrogation toutes les 3 s). */
export default function CheckoutResult() {
  const { order: id } = useLocalSearchParams<{ order: string }>();
  const insets = useSafeAreaInsets();
  const { refreshCart, config } = useStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      try {
        const o = await api<Order>(`orders/${id}`);
        if (!alive) return;
        setOrder(o);
        setError(null);
        if (o.status !== 'PENDING') {
          refreshCart().catch(() => undefined);
          return;
        }
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
      if (Date.now() - started.current > POLL_LIMIT_MS) setGaveUp(true);
      else timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, refreshCart]);

  const status = order?.status;
  const hero = (icon: IconName, bg: string, ring: string, title: string, sub?: React.ReactNode) => (
    <View style={{ alignItems: 'center', gap: 16, paddingTop: 32 }}>
      <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 10px ${ring}` }}>
        <Icon name={icon} size={42} color="#FFFFFF" stroke={2.4} />
      </View>
      <T serif accessibilityRole="header" style={{ fontSize: 36, lineHeight: 38, textAlign: 'center', marginTop: 8 }}>{title}</T>
      {sub}
    </View>
  );

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <StepBar step={status === 'PAID' ? 3 : 2} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 16, gap: 20, flexGrow: 1 }}>
        {!order && !error && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <ActivityIndicator size="large" color={color.indigo} />
            <T muted>Vérification du paiement…</T>
          </View>
        )}
        {error && !order && <ErrorBanner message={error} />}

        {status === 'PAID' && order && (
          <>
            {hero('check', color.success, color.successRing, 'Merci, votre commande est confirmée', (
              <View style={{ alignItems: 'center', gap: 4 }}>
                <T muted style={{ fontSize: 15 }}>Commande n° <T weight="bold">{order.reference}</T></T>
                <T muted style={{ fontSize: 14 }}>{dateTime(order.paidAt ?? order.createdAt)}</T>
              </View>
            ))}
            <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
              {order.items.map((i) => (
                <View key={i.ebookId} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.divider }}>
                  <T weight="bold" style={{ flex: 1, fontSize: 15 }}>{i.title}</T>
                  <StatusPill status="OK" />
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 }}>
                <T weight="bold">Total payé</T>
                <T weight="bold">{money(order.totalCents, order.currency)}</T>
              </View>
            </Card>
            <InfoNote icon="mail">Un récapitulatif vous a été envoyé par e-mail.</InfoNote>
          </>
        )}

        {(status === 'FAILED' || status === 'CANCELED') && (
          <>
            {hero('close', color.danger, color.dangerRing, 'Le paiement n’a pas abouti', (
              <T muted style={{ textAlign: 'center', lineHeight: 24 }}>Aucun montant n’a été débité et aucun accès n’a été activé. Votre panier est conservé.</T>
            ))}
            <Card style={{ padding: 16, gap: 8 }}>
              <T weight="bold" style={{ fontSize: 15 }}>Causes fréquentes</T>
              {['Carte refusée ou expirée', 'Plafond de paiement atteint', 'Validation bancaire (3-D Secure) non terminée', 'Connexion interrompue pendant le paiement'].map((c) => (
                <T key={c} muted style={{ fontSize: 14 }}>• {c}</T>
              ))}
            </Card>
          </>
        )}

        {status === 'PENDING' && (
          <>
            {hero('clock', color.warningText, color.warningSoft, 'Paiement en vérification', (
              <T muted style={{ textAlign: 'center', lineHeight: 24 }}>
                Nous attendons la confirmation de notre prestataire. Vos e-books apparaîtront dans votre bibliothèque dès qu’elle sera reçue. Aucun accès n’est activé avant.
              </T>
            ))}
            {!gaveUp ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={color.indigo} />
                <T muted style={{ fontSize: 14 }}>Vérification automatique en cours…</T>
              </View>
            ) : (
              <InfoNote icon="mail" tone="indigo">La confirmation prend plus de temps que prévu. Vous recevrez un e-mail dès qu’elle arrivera ; vous pouvez fermer cet écran.</InfoNote>
            )}
          </>
        )}

        {status === 'REFUNDED' && hero('info', color.neutralText, color.neutralSoft, 'Commande remboursée')}
      </ScrollView>

      <View style={{ padding: gutter, paddingBottom: Math.max(insets.bottom, 20), gap: 10 }}>
        {status === 'PAID' && (
          <>
            <Button label="Ouvrir ma bibliothèque" variant="accent" icon="books" onPress={() => router.dismissTo('/library')} />
            <Button label="Continuer mes achats" variant="ghost" onPress={() => router.dismissTo('/')} />
          </>
        )}
        {(status === 'FAILED' || status === 'CANCELED') && (
          <>
            <Button label="Réessayer le paiement" variant="accent" onPress={() => router.replace('/checkout/pay')} />
            <Button label="Revenir au panier" variant="ghost" onPress={() => router.dismissTo('/cart')} />
            {config?.supportEmail && <LinkButton label="Contacter le support" onPress={() => router.push('/account/help')} style={{ alignSelf: 'center' }} />}
          </>
        )}
        {(status === 'PENDING' || status === 'REFUNDED' || (!order && error)) && <Button label="Revenir à l’accueil" variant="ghost" onPress={() => router.dismissTo('/')} />}
      </View>
    </View>
  );
}
