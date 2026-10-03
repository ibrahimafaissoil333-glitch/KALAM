import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api, deviceInfo, errorMessage } from '@/lib/api';
import { PASSWORD_RULES, passwordOk, shortDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Button, Card, Divider, ErrorBanner, InfoNote, Rule, ScreenHeader, T, TextField, useToast } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, gutter } from '@/ui/theme';

interface Device {
  id: string;
  label: string;
  platform: string;
  lastSeenAt: string;
}

export default function SecurityScreen() {
  const { logout } = useStore();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [thisLabel, setThisLabel] = useState<string>('');

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await api<Device[]>('me/devices'));
      setThisLabel((await deviceInfo()).deviceLabel);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const change = async () => {
    setError(null);
    if (!current) return setError('Saisissez votre mot de passe actuel.');
    if (!passwordOk(next)) return setError('Le nouveau mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.');
    setBusy(true);
    try {
      await api('me/password', { method: 'PUT', body: { currentPassword: current, newPassword: next } });
      toast('Mot de passe modifié. Reconnectez-vous.');
      await logout();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Device) => {
    try {
      await api(`me/devices/${d.id}`, { method: 'DELETE' });
      toast('Appareil retiré');
      loadDevices();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <ScreenHeader back title="Sécurité" />
      <View style={{ paddingHorizontal: gutter, gap: 20, paddingTop: 8 }}>
        {error && <ErrorBanner message={error} />}
        <T serif accessibilityRole="header" style={{ fontSize: 26 }}>Mot de passe</T>
        <TextField label="Mot de passe actuel" value={current} onChangeText={setCurrent} password autoComplete="current-password" />
        <TextField
          label="Nouveau mot de passe"
          value={next}
          onChangeText={setNext}
          password
          autoComplete="new-password"
          hint={<View style={{ gap: 4 }}>{PASSWORD_RULES.map((r) => <Rule key={r.label} ok={r.test(next)} label={r.label} />)}</View>}
        />
        <Button label="Changer le mot de passe" variant="accent" loading={busy} onPress={change} />
        <InfoNote>Toutes vos sessions seront fermées après le changement.</InfoNote>

        <T serif accessibilityRole="header" style={{ fontSize: 26, marginTop: 12 }}>Appareils connectés</T>
        <Card style={{ paddingHorizontal: 16 }}>
          {devices?.map((d, i) => (
            <View key={d.id}>
              {i > 0 && <Divider />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
                <Icon name="device" color={color.muted} />
                <View style={{ flex: 1 }}>
                  <T weight="semibold" style={{ fontSize: 15 }}>{d.label}{d.label === thisLabel ? ' (cet appareil)' : ''}</T>
                  <T muted style={{ fontSize: 13 }}>Dernière activité : {shortDate(d.lastSeenAt)}</T>
                </View>
                {d.label !== thisLabel && <Button label="Retirer" variant="danger" small onPress={() => remove(d)} accessibilityLabel={`Retirer ${d.label}`} />}
              </View>
            </View>
          ))}
          {devices?.length === 0 && <T muted style={{ paddingVertical: 14, fontSize: 14 }}>Aucun appareil enregistré.</T>}
        </Card>
      </View>
    </ScrollView>
  );
}
