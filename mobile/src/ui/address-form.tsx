import { useState } from 'react';
import { View } from 'react-native';
import { Address, api, errorMessage } from '@/lib/api';
import { COUNTRY_LABEL } from '@/lib/format';
import { Button, Choice, ErrorBanner, TextField } from './components';

const COUNTRIES = Object.entries(COUNTRY_LABEL) as [string, string][];

/** Nouvelle adresse de livraison (validée aussi côté serveur par save_address). */
export function AddressForm({ onSaved, onCancel }: { onSaved: (a: Address) => void; onCancel?: () => void }) {
  const [f, setF] = useState({ fullName: '', line1: '', line2: '', city: '', postalCode: '', country: 'KM', phone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => {
    setF({ ...f, [k]: v });
    setErrors({ ...errors, [k]: '' });
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.fullName.trim()) e.fullName = 'Indiquez le nom du destinataire.';
    if (!f.line1.trim()) e.line1 = 'Indiquez l’adresse.';
    if (!f.city.trim()) e.city = 'Indiquez la ville.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<Address>('me/addresses', { method: 'POST', body: f }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <TextField label="Nom du destinataire" value={f.fullName} onChangeText={set('fullName')} error={errors.fullName} autoComplete="name" />
      <TextField label="Adresse" value={f.line1} onChangeText={set('line1')} error={errors.line1} placeholder="Rue, quartier" autoComplete="street-address" />
      <TextField label="Complément (facultatif)" value={f.line2} onChangeText={set('line2')} placeholder="Bâtiment, repère" />
      <TextField label="Ville" value={f.city} onChangeText={set('city')} error={errors.city} />
      <TextField label="Code postal (facultatif)" value={f.postalCode} onChangeText={set('postalCode')} keyboardType="number-pad" />
      <Choice label="Pays" value={f.country} options={COUNTRIES} onChange={set('country')} />
      <TextField label="Téléphone (facultatif)" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" hint={undefined} />
      {error && <ErrorBanner message={error} />}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {onCancel && <Button label="Annuler" variant="ghost" small onPress={onCancel} style={{ flex: 1 }} />}
        <Button label="Enregistrer l’adresse" small loading={busy} onPress={save} style={{ flex: 2 }} />
      </View>
    </View>
  );
}
