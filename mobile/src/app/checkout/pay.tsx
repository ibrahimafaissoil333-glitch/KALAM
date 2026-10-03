import { randomUUID } from 'expo-crypto';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { api, errorMessage, Order } from '@/lib/api';
import { money } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Button, Card, Checkbox, Cover, ErrorBanner, InfoNote, LinkButton, ScreenHeader, StepBar, T } from '@/ui/components';
import { color, gutter } from '@/ui/theme';

/**
 * Paiement : la commande est créée côté serveur, puis la page sécurisée du prestataire
 * s'ouvre dans un navigateur intégré. Le résultat n'est JAMAIS déduit du retour du navigateur :
 * l'écran suivant interroge le serveur, seul informé par webhook.
 */
export default function PayScreen() {
  const { cart, config } = useStore();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Une clé par visite de l'écran : un double appui ne crée qu'une commande.
  const idem = useRef(randomUUID());

  const pay = async () => {
    setError(null);
    if (!accepted) return setError('Acceptez les conditions générales de vente pour continuer.');
    setBusy(true);
    try {
      // Adresse de retour propre à l'environnement (folio:// en production, exp:// dans Expo Go).
      const returnUrl = Linking.createURL('checkout/return');
      const { order, checkoutUrl } = await api<{ order: Order; checkoutUrl: string | null }>('orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idem.current },
        body: { platform: Platform.OS === 'ios' ? 'ios' : 'android', returnUrl },
      });
      if (checkoutUrl) await WebBrowser.openAuthSessionAsync(checkoutUrl, returnUrl);
      idem.current = randomUUID();
      router.replace({ pathname: '/checkout/result', params: { order: order.id } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader back />
      <StepBar step={2} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 16, gap: 12 }}>
        <T serif accessibilityRole="header" style={{ fontSize: 34, marginTop: 4 }}>Paiement</T>
        <T weight="bold" accessibilityRole="header" style={{ fontSize: 17, marginTop: 8 }}>Récapitulatif</T>
        <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          {cart.items.map((e) => (
            <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.divider }}>
              <Cover title={e.title} author={e.author} cover={e.cover} width={40} />
              <T weight="semibold" style={{ flex: 1, fontSize: 15 }}>{e.title}</T>
              <T weight="bold" style={{ fontSize: 15 }}>{money(e.priceCents, e.currency)}</T>
            </View>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 }}>
            <T weight="bold" style={{ fontSize: 17 }}>Total TTC</T>
            <T weight="bold" style={{ fontSize: 17 }}>{money(cart.totalCents, cart.currency)}</T>
          </View>
        </Card>
        <InfoNote icon="shield" tone="box">
          Le paiement est traité sur la page sécurisée de notre prestataire. {config?.appName ?? 'Folio'} ne conserve aucune donnée bancaire.
        </InfoNote>
        <Checkbox checked={accepted} onChange={(v) => { setAccepted(v); setError(null); }}>
          <T style={{ fontSize: 14, lineHeight: 20 }}>
            J’accepte les conditions générales de vente et je demande l’accès immédiat au contenu numérique, ce qui met fin à mon droit de rétractation.
          </T>
        </Checkbox>
        {config?.legal.salesTerms && <LinkButton label="Lire les conditions générales de vente" onPress={() => WebBrowser.openBrowserAsync(config.legal.salesTerms!)} />}
        {error && <ErrorBanner message={error} />}
      </ScrollView>
      <View style={{ padding: gutter, gap: 6 }}>
        <Button label={busy ? 'Ouverture du paiement sécurisé…' : `Payer ${money(cart.totalCents, cart.currency)}`} variant="accent" icon="lock" loading={busy} disabled={cart.items.length === 0} onPress={pay} />
        <Button label="Annuler et revenir au panier" variant="link" small onPress={() => router.back()} />
      </View>
    </View>
  );
}
