
import { useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useStore, User } from '@/lib/store';
import { Button, ErrorBanner, InfoNote, ScreenHeader, T, TextField, useToast } from '@/ui/components';
import { gutter } from '@/ui/theme';

export default function ProfileScreen() {
  const { user, setUser } = useStore();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('Indiquez un prénom ou un pseudonyme.');
    setBusy(true);
    try {
      setUser(await api<User>('me', { method: 'PATCH', body: { name: name.trim() } }));
      toast('Informations enregistrées');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** Export RGPD : partagé via la feuille de partage du système. */
  const exportData = async () => {
    setExporting(true);
    try {
      const data = await api('me/export');
      await Share.share({ title: 'Mes données', message: JSON.stringify(data, null, 2) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <ScreenHeader back title="Informations personnelles" />
      <View style={{ paddingHorizontal: gutter, gap: 20, paddingTop: 8 }}>
        {error && <ErrorBanner message={error} />}
        <TextField label="Prénom ou pseudonyme" value={name} onChangeText={setName} />
        <View style={{ gap: 8 }}>
          <T weight="semibold" style={{ fontSize: 14 }}>Adresse e-mail</T>
          <T muted>{user?.email}</T>
          <T muted style={{ fontSize: 13 }}>Pour changer d’adresse, contactez le support.</T>
        </View>
        <Button label="Enregistrer" variant="accent" loading={busy} onPress={save} />
        <View style={{ gap: 12, paddingTop: 12 }}>
          <T serif accessibilityRole="header" style={{ fontSize: 26 }}>Mes données</T>
          <InfoNote>Vous pouvez obtenir une copie de toutes les données associées à votre compte (commandes, bibliothèque, appareils, consentements).</InfoNote>
          <Button label="Exporter mes données" variant="ghost" loading={exporting} onPress={exportData} />
        </View>
      </View>
    </ScrollView>
  );
}
