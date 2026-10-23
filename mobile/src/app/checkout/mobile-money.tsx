import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, errorMessage } from '@/lib/api';
import { money, OPERATOR_LABEL } from '@/lib/format';
import { Button, Card, ErrorBanner, InfoNote, StepBar, T } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, gutter } from '@/ui/theme';

const POLL_MS = 3000;
const POLL_LIMIT_MS = 3 * 60_000;

/**
 * Attente de la confirmation Mobile Money : l'acheteur valide la demande sur son téléphone,
 * l'opérateur prévient le serveur (callback), et cet écran interroge le serveur toutes les 3 s.
 */
export default function MobileMoneyWait() {
  const { order, operator, masked, total, currency } = useLocalSearchParams<{ order: string; operator: string; masked: string; total: string; currency: string }>();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      try {
        const s = await api<{ status: string }>(`orders/${order}/status`);
        if (!alive) return;
        setError(null);
        if (s.status !== 'PENDING') {
          router.replace({ pathname: '/checkout/result', params: { order } });
          return;
        }
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
      if (Date.now() - started.current > POLL_LIMIT_MS) setGaveUp(true);
      else timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [order]);

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <StepBar step={2} />
      <View style={{ flex: 1, paddingHorizontal: gutter, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 12px ${color.accentSoft}` }}>
          <Icon name="phone" size={44} color="#FFFFFF" stroke={2} />
        </View>
        <T serif accessibilityRole="header" style={{ fontSize: 34, lineHeight: 36, textAlign: 'center', marginTop: 8 }}>Confirmez sur votre téléphone</T>
        <T muted style={{ textAlign: 'center', lineHeight: 24 }}>
          Une demande de paiement de <T weight="bold">{money(Number(total), currency)}</T> a été envoyée au {masked} ({OPERATOR_LABEL[operator] ?? operator}). Validez-la avec votre code secret.
        </T>
        <Card style={{ alignSelf: 'stretch', padding: 16, gap: 8 }}>
          <T weight="bold" style={{ fontSize: 15 }}>Vous ne voyez pas la demande ?</T>
          <T muted style={{ fontSize: 14 }}>• Vérifiez que votre téléphone a du réseau</T>
          <T muted style={{ fontSize: 14 }}>• Ouvrez le menu de votre opérateur pour les paiements en attente</T>
          <T muted style={{ fontSize: 14 }}>• Assurez-vous que votre solde est suffisant</T>
        </Card>
        {!gaveUp ? (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }} accessibilityLiveRegion="polite">
            <ActivityIndicator color={color.accent} />
            <T muted style={{ fontSize: 14 }}>En attente de votre confirmation…</T>
          </View>
        ) : (
          <InfoNote icon="mail" tone="accent">La confirmation n’est pas encore arrivée. Si vous avez validé le paiement, votre commande sera confirmée par e-mail dès réception.</InfoNote>
        )}
        {error && <ErrorBanner message={error} />}
      </View>
      <View style={{ padding: gutter, paddingBottom: Math.max(insets.bottom, 20), gap: 10 }}>
        <Button label="Voir l’état de la commande" variant="ghost" onPress={() => router.replace({ pathname: '/checkout/result', params: { order } })} />
      </View>
    </View>
  );
}
