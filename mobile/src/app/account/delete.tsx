import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Button, Card, ErrorBanner, ScreenHeader, T, TextField, useToast } from '@/ui/components';
import { color, gutter } from '@/ui/theme';

const WORD = 'SUPPRIMER';

/** Suppression du compte : double confirmation (mot à saisir + mot de passe). */
export default function DeleteAccount() {
  const { logout } = useStore();
  const toast = useToast();
  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('me', { method: 'DELETE', body: { password } });
      await logout();
      toast('Votre compte a été supprimé');
      router.dismissTo('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <ScreenHeader back title="Supprimer mon compte" />
      <View style={{ paddingHorizontal: gutter, gap: 20, paddingTop: 8 }}>
        <Card style={{ padding: 16, gap: 8, backgroundColor: color.dangerSoft, borderColor: '#F0C4C6' }}>
          <T weight="bold" style={{ color: color.dangerText }}>Cette action est définitive</T>
          <T style={{ fontSize: 14, lineHeight: 20, color: color.dangerText }}>
            Vous perdrez l’accès à tous vos e-books, sur tous vos appareils. Vos données personnelles seront effacées ; les factures sont conservées le temps imposé par la loi, sans lien avec votre identité.
          </T>
        </Card>
        {error && <ErrorBanner message={error} />}
        <TextField label={`Saisissez ${WORD} pour confirmer`} value={word} onChangeText={setWord} autoCapitalize="characters" autoCorrect={false} />
        <TextField label="Mot de passe" value={password} onChangeText={setPassword} password autoComplete="current-password" />
        <Button label="Supprimer définitivement" variant="danger" loading={busy} disabled={word.trim() !== WORD || !password} onPress={submit} />
        <Button label="Annuler" variant="ghost" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}
