import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { api, errorMessage, PayoutAccount } from '@/lib/api';
import { COUNTRY_LABEL, OPERATOR_LABEL } from '@/lib/format';
import { phoneExample, validMsisdn } from '@/lib/msisdn';
import { useQuery } from '@/lib/use-query';
import { Button, Card, Choice, Divider, ErrorBanner, InfoNote, LinkButton, ScreenHeader, Skeleton, T, TextField, useToast } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, gutter } from '@/ui/theme';

const OPERATORS: Record<string, readonly (readonly [string, string])[]> = {
  KM: [['HURI_MONEY', 'Huri Money'], ['MVOLA_KM', 'Mvola Comores']],
  MG: [['MVOLA', 'MVola'], ['ORANGE_MONEY', 'Orange Money'], ['AIRTEL_MONEY', 'Airtel Money']],
};
const BANK_COUNTRIES = [['KM', 'Comores'], ['MG', 'Madagascar'], ['FR', 'France']] as const;
const MM_COUNTRIES = [['KM', 'Comores'], ['MG', 'Madagascar']] as const;

/**
 * Moyens de réception des gains. Les coordonnées sont chiffrées par le serveur dès l'envoi :
 * l'app n'affiche ensuite que les 4 derniers caractères (****1234).
 */
export default function PayoutScreen() {
  const { data, error, reload, setData } = useQuery<PayoutAccount[]>('me/payout-accounts');
  const toast = useToast();
  const [adding, setAdding] = useState<'BANK' | 'MOBILE_MONEY' | null>(null);
  const [f, setF] = useState({ holderName: '', country: 'KM', iban: '', bankName: '', operator: '', phone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => {
    setF({ ...f, [k]: v });
    setErrors({ ...errors, [k]: '' });
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.holderName.trim()) e.holderName = 'Indiquez le nom du titulaire.';
    if (adding === 'BANK' && f.iban.replace(/\s/g, '').length < 14) e.iban = 'IBAN ou RIB incomplet.';
    if (adding === 'MOBILE_MONEY') {
      if (!f.operator) e.operator = 'Choisissez l’opérateur.';
      if (!validMsisdn(f.country, f.phone)) e.phone = `Numéro invalide. Exemple : ${phoneExample(f.country)}`;
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setActionError(null);
    try {
      const body = adding === 'BANK'
        ? { kind: 'BANK', holderName: f.holderName, country: f.country, iban: f.iban, bankName: f.bankName }
        : { kind: 'MOBILE_MONEY', holderName: f.holderName, country: f.country, operator: f.operator, phone: f.phone };
      setData(await api<PayoutAccount[]>('me/payout-accounts', { method: 'POST', body }));
      setAdding(null);
      setF({ holderName: '', country: 'KM', iban: '', bankName: '', operator: '', phone: '' });
      toast('Moyen de réception enregistré');
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: string, method: string, msg: string) => {
    setActionError(null);
    try {
      setData(await api<PayoutAccount[]>(path, { method }));
      toast(msg);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };
  const remove = (a: PayoutAccount) =>
    Alert.alert('Supprimer ce moyen de réception ?', a.masked, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => act(`me/payout-accounts/${a.id}`, 'DELETE', 'Supprimé') },
    ]);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <ScreenHeader back title="Moyens de réception" sub="Où vous recevez l’argent de vos ventes." />
      <View style={{ paddingHorizontal: gutter, gap: 14 }}>
        {(error || actionError) && <ErrorBanner message={(error ?? actionError)!} onRetry={error ? reload : undefined} />}
        <InfoNote icon="lock" tone="box">Vos coordonnées sont chiffrées et ne sont jamais affichées en entier. Mobile Money : versement automatique. Compte bancaire : virement effectué par l’équipe Folio.</InfoNote>

        {!data ? <Skeleton h={80} /> : data.length > 0 && (
          <Card style={{ paddingHorizontal: 16 }}>
            {data.map((a, i) => (
              <View key={a.id}>
                {i > 0 && <Divider />}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }}>
                  <Icon name={a.kind === 'BANK' ? 'wallet' : 'phone'} color={color.ink} />
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" style={{ fontSize: 15 }}>
                      {a.kind === 'BANK' ? a.bankName || 'Compte bancaire' : OPERATOR_LABEL[a.operator ?? ''] ?? a.operator} · {a.masked}
                    </T>
                    <T muted style={{ fontSize: 13 }}>{a.holderName} · {COUNTRY_LABEL[a.country] ?? a.country}{a.isDefault ? ' · par défaut' : ''}</T>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 16, paddingBottom: 8 }}>
                  {!a.isDefault && <LinkButton label="Utiliser par défaut" onPress={() => act(`me/payout-accounts/${a.id}/default`, 'POST', 'Moyen par défaut modifié')} />}
                  <LinkButton label="Supprimer" onPress={() => remove(a)} />
                </View>
              </View>
            ))}
          </Card>
        )}

        {adding ? (
          <Card style={{ padding: 16, gap: 14 }}>
            <T weight="bold" style={{ fontSize: 17 }}>{adding === 'BANK' ? 'Compte bancaire' : 'Mobile Money'}</T>
            <TextField label="Nom du titulaire" value={f.holderName} onChangeText={set('holderName')} error={errors.holderName} autoComplete="name" />
            <Choice label="Pays" value={f.country} options={adding === 'BANK' ? BANK_COUNTRIES : MM_COUNTRIES} onChange={(v) => setF({ ...f, country: v, operator: '' })} />
            {adding === 'BANK' ? (
              <>
                <TextField label="IBAN ou RIB" value={f.iban} onChangeText={set('iban')} error={errors.iban} autoCapitalize="characters" autoCorrect={false} placeholder="KM46 …" />
                <TextField label="Banque (facultatif)" value={f.bankName} onChangeText={set('bankName')} />
              </>
            ) : (
              <>
                <Choice label="Opérateur" value={f.operator} options={OPERATORS[f.country]} onChange={set('operator')} error={errors.operator} />
                <TextField label="Numéro Mobile Money" value={f.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" placeholder={phoneExample(f.country)} />
              </>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Annuler" variant="ghost" small onPress={() => setAdding(null)} style={{ flex: 1 }} />
              <Button label="Enregistrer" small loading={busy} onPress={save} style={{ flex: 2 }} />
            </View>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            <Button label="Ajouter un numéro Mobile Money" variant="accent" icon="phone" onPress={() => setAdding('MOBILE_MONEY')} />
            <Button label="Ajouter un compte bancaire" variant="ghost" icon="wallet" onPress={() => setAdding('BANK')} />
          </View>
        )}
      </View>
    </ScrollView>
  );
}
