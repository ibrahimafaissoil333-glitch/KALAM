import { randomUUID } from 'expo-crypto';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Address, api, errorMessage, Order } from '@/lib/api';
import { COUNTRY_LABEL, money, SHIPPING_LABEL } from '@/lib/format';
import { phoneExample, validMsisdn } from '@/lib/msisdn';
import { useStore } from '@/lib/store';
import { useQuery } from '@/lib/use-query';
import { AddressForm } from '@/ui/address-form';
import { Button, Card, Checkbox, Choice, Cover, ErrorBanner, InfoNote, LinkButton, ScreenHeader, StepBar, T, TextField } from '@/ui/components';
import { Icon, IconName } from '@/ui/icons';
import { color, gutter } from '@/ui/theme';

type Method = 'CARD' | 'MOBILE_MONEY' | 'PAYPAL';

/**
 * Paiement : la commande est créée côté serveur (prix figés, stock réservé), puis
 * - carte ou PayPal : la page sécurisée du prestataire s'ouvre dans un navigateur intégré ;
 * - Mobile Money : l'opérateur envoie une demande de confirmation sur le téléphone de l'acheteur.
 * Le résultat n'est JAMAIS déduit côté app : seul le serveur, informé par webhook, fait foi.
 */
export default function PayScreen() {
  const { cart, config } = useStore();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Une clé par visite de l'écran : un double appui ne crée qu'une commande.
  const idem = useRef(randomUUID());

  const physical = cart.items.filter((e) => e.kind === 'PHYSICAL');
  const hasDigital = cart.items.some((e) => e.kind !== 'PHYSICAL');
  const { data: addresses, setData: setAddresses } = useQuery<Address[]>(physical.length ? 'me/addresses' : null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [shipping, setShipping] = useState<Record<string, string>>({});
  const address = addresses?.find((a) => a.id === addressId) ?? null;

  useEffect(() => {
    if (addresses && !addressId && addresses[0]) setAddressId(addresses[0].id);
    if (addresses && addresses.length === 0) setAddingAddress(true);
  }, [addresses, addressId]);

  // Mobile Money : seulement les pays actifs dont la devise est celle de la commande.
  const mmCountries = useMemo(() => (config?.mobileMoney?.countries ?? []).filter((c) => c.currency === cart.currency && c.operators.length > 0), [config, cart.currency]);
  const [method, setMethod] = useState<Method>('CARD');
  const [mmCountry, setMmCountry] = useState<string | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const country = mmCountries.find((c) => c.code === (mmCountry ?? mmCountries[0]?.code));

  // PayPal : activé par l'admin, et seulement pour les commandes en euros.
  const paypalOk = !!config?.paypal?.enabled && (config.paypal.currencies ?? []).includes(cart.currency);
  useEffect(() => {
    if ((method === 'MOBILE_MONEY' && mmCountries.length === 0) || (method === 'PAYPAL' && !paypalOk)) setMethod('CARD');
  }, [mmCountries.length, paypalOk, method]);

  const shippingCents = physical.reduce((n, e) => n + (e.shipping.find((s) => s.id === shipping[e.id])?.priceCents ?? 0), 0);
  const total = cart.totalCents + shippingCents;
  const available = (e: (typeof physical)[number]) => e.shipping.filter((s) => !address || s.countries.length === 0 || s.countries.includes(address.country));

  const pay = async () => {
    setError(null);
    if (physical.length) {
      if (!address) return setError('Choisissez une adresse de livraison.');
      const missing = physical.find((e) => !available(e).some((s) => s.id === shipping[e.id]));
      if (missing) return setError(`Choisissez un mode de livraison pour « ${missing.title} ».`);
    }
    if (method === 'MOBILE_MONEY') {
      if (!country || !operator) return setError('Choisissez votre opérateur Mobile Money.');
      if (!validMsisdn(country.code, phone)) {
        setPhoneError(`Numéro invalide. Exemple : ${country.dialCode} ${phoneExample(country.code)}`);
        return;
      }
    }
    if (!accepted) return setError('Acceptez les conditions générales de vente pour continuer.');
    setBusy(true);
    try {
      // Adresse de retour propre à l'environnement (folio:// en production, exp:// dans Expo Go).
      const returnUrl = Linking.createURL('checkout/return');
      const { order, checkoutUrl, mobileMoney } = await api<{ order: Order; checkoutUrl: string | null; mobileMoney?: { operator: string; masked: string } }>('orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idem.current },
        body: {
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          returnUrl,
          paymentMethod: method,
          ...(method === 'MOBILE_MONEY' && { mobileMoney: { country: country!.code, operator, phone } }),
          ...(physical.length && { addressId, shipping: Object.fromEntries(physical.map((e) => [e.id, shipping[e.id]])) }),
        },
      });
      idem.current = randomUUID();
      if (mobileMoney) {
        router.replace({ pathname: '/checkout/mobile-money', params: { order: order.id, operator: mobileMoney.operator, masked: mobileMoney.masked, total: String(order.totalCents), currency: order.currency } });
        return;
      }
      if (checkoutUrl) await WebBrowser.openAuthSessionAsync(checkoutUrl, returnUrl);
      router.replace({ pathname: '/checkout/result', params: { order: order.id } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const methodCard = (m: Method, icon: IconName, label: string, sub: string) => (
    <Pressable
      key={m}
      onPress={() => { setMethod(m); setError(null); }}
      accessibilityRole="radio"
      accessibilityState={{ checked: method === m }}
      accessibilityLabel={`${label}. ${sub}`}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: method === m ? color.accent : color.border, backgroundColor: color.surface }]}
    >
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={color.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <T weight="bold" style={{ fontSize: 15 }}>{label}</T>
        <T muted style={{ fontSize: 13 }}>{sub}</T>
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: method === m ? color.accent : color.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
        {method === m && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.accent }} />}
      </View>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader back />
      <StepBar step={2} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
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
          {physical.length > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12 }}>
              <T muted style={{ fontSize: 15 }}>Livraison</T>
              <T style={{ fontSize: 15 }}>{shippingCents ? money(shippingCents, cart.currency) : 'Gratuite'}</T>
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 }}>
            <T weight="bold" style={{ fontSize: 17 }}>Total TTC</T>
            <T weight="bold" style={{ fontSize: 17 }}>{money(total, cart.currency)}</T>
          </View>
        </Card>

        {physical.length > 0 && (
          <>
            <T weight="bold" accessibilityRole="header" style={{ fontSize: 17, marginTop: 12 }}>Adresse de livraison</T>
            {addresses?.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => { setAddressId(a.id); setError(null); }}
                accessibilityRole="radio"
                accessibilityState={{ checked: a.id === addressId }}
                style={{ padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: a.id === addressId ? color.accent : color.border, backgroundColor: color.surface }}
              >
                <T weight="bold" style={{ fontSize: 15 }}>{a.fullName}</T>
                <T muted style={{ fontSize: 14 }}>{[a.line1, a.line2, a.postalCode, a.city, COUNTRY_LABEL[a.country] ?? a.country].filter(Boolean).join(', ')}</T>
              </Pressable>
            ))}
            {addingAddress ? (
              <Card style={{ padding: 16 }}>
                <AddressForm
                  onSaved={(a) => { setAddresses([a, ...(addresses ?? [])]); setAddressId(a.id); setAddingAddress(false); }}
                  onCancel={addresses?.length ? () => setAddingAddress(false) : undefined}
                />
              </Card>
            ) : (
              <LinkButton label="+ Ajouter une adresse" onPress={() => setAddingAddress(true)} />
            )}

            <T weight="bold" accessibilityRole="header" style={{ fontSize: 17, marginTop: 12 }}>Mode de livraison</T>
            {physical.map((e) => {
              const opts = available(e);
              return (
                <Card key={e.id} style={{ padding: 16, gap: 4 }}>
                  {opts.length === 0 ? (
                    <T style={{ fontSize: 14, color: color.dangerText }}>« {e.title} » ne peut pas être livré à cette adresse.</T>
                  ) : (
                    <Choice
                      label={`${e.title} · vendu par ${e.seller?.name ?? 'Kalam'}`}
                      value={shipping[e.id]}
                      options={opts.map((s) => [s.id, `${SHIPPING_LABEL[s.mode]} · ${s.priceCents ? money(s.priceCents, e.currency) : 'gratuit'}`] as const)}
                      onChange={(v) => { setShipping({ ...shipping, [e.id]: v }); setError(null); }}
                    />
                  )}
                </Card>
              );
            })}
          </>
        )}

        <T weight="bold" accessibilityRole="header" style={{ fontSize: 17, marginTop: 12 }}>Moyen de paiement</T>
        <View style={{ gap: 10 }} accessibilityRole="radiogroup">
          {methodCard('CARD', 'lock', 'Carte bancaire', 'Page sécurisée de notre prestataire')}
          {paypalOk && methodCard('PAYPAL', 'wallet', 'PayPal', 'Compte PayPal ou carte via PayPal')}
          {mmCountries.length > 0 && methodCard('MOBILE_MONEY', 'phone', 'Mobile Money', mmCountries.flatMap((c) => c.operators.map((o) => o.label)).join(', '))}
        </View>

        {method === 'MOBILE_MONEY' && country && (
          <Card style={{ padding: 16, gap: 14 }}>
            {mmCountries.length > 1 && (
              <Choice label="Pays" value={country.code} options={mmCountries.map((c) => [c.code, c.name] as const)} onChange={(v) => { setMmCountry(v); setOperator(null); }} />
            )}
            <Choice label="Opérateur" value={operator} options={country.operators.map((o) => [o.code, o.label] as const)} onChange={setOperator} />
            <TextField
              label="Numéro Mobile Money"
              value={phone}
              onChangeText={(v) => { setPhone(v); setPhoneError(undefined); }}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder={`${country.dialCode} ${phoneExample(country.code)}`}
              error={phoneError}
            />
            <InfoNote icon="phone">Vous recevrez une demande de paiement sur ce téléphone. Validez-la avec votre code secret pour confirmer la commande.</InfoNote>
          </Card>
        )}
        {method === 'CARD' && (
          <InfoNote icon="shield" tone="box">
            Le paiement est traité sur la page sécurisée de notre prestataire. {config?.appName ?? 'Kalam'} ne conserve aucune donnée bancaire.
          </InfoNote>
        )}
        {method === 'PAYPAL' && (
          <InfoNote icon="shield" tone="box">Vous validez le paiement sur le site de PayPal, puis vous revenez automatiquement dans l’application.</InfoNote>
        )}

        <Checkbox checked={accepted} onChange={(v) => { setAccepted(v); setError(null); }}>
          <T style={{ fontSize: 14, lineHeight: 20 }}>
            J’accepte les conditions générales de vente
            {hasDigital ? ' et je demande l’accès immédiat au contenu numérique, ce qui met fin à mon droit de rétractation pour ces livres.' : '.'}
          </T>
        </Checkbox>
        {config?.legal.salesTerms && <LinkButton label="Lire les conditions générales de vente" onPress={() => WebBrowser.openBrowserAsync(config.legal.salesTerms!)} />}
        {error && <ErrorBanner message={error} />}
      </ScrollView>
      <View style={{ padding: gutter, gap: 6 }}>
        <Button
          label={busy ? (method === 'MOBILE_MONEY' ? 'Envoi de la demande…' : method === 'PAYPAL' ? 'Ouverture de PayPal…' : 'Ouverture du paiement sécurisé…') : method === 'PAYPAL' ? `Payer avec PayPal · ${money(total, cart.currency)}` : `Payer ${money(total, cart.currency)}`}
          variant="accent"
          icon={method === 'MOBILE_MONEY' ? 'phone' : 'lock'}
          loading={busy}
          disabled={cart.items.length === 0}
          onPress={pay}
        />
        <Button label="Annuler et revenir au panier" variant="link" small onPress={() => router.back()} />
      </View>
    </View>
  );
}
