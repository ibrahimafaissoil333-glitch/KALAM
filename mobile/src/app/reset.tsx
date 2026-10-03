import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { ApiError, api, errorMessage } from '@/lib/api';
import { PASSWORD_RULES, passwordOk } from '@/lib/format';
import { Button, EmptyState, ErrorBanner, Rule, ScreenHeader, T, TextField, useToast } from '@/ui/components';
import { gutter } from '@/ui/theme';

/** Ouvert par le lien de l'e-mail : folio://reset?token=… */
export default function ResetScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(!token);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!passwordOk(password)) return setError('Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.');
    if (password !== confirm) return setError('Les deux mots de passe ne sont pas identiques.');
    setBusy(true);
    try {
      await api('auth/reset-password', { method: 'POST', auth: false, body: { token, password } });
      toast('Mot de passe enregistré');
      router.replace('/login');
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && e.message.includes('expiré')) setExpired(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (expired) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader back />
        <EmptyState icon="clock" title="Ce lien a expiré" text="Pour votre sécurité, un lien n’est valable que 30 minutes et ne sert qu’une fois.">
          <Button label="Demander un nouveau lien" variant="accent" onPress={() => router.replace('/forgot')} />
        </EmptyState>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader back />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 8, gap: 20 }}>
        <T serif accessibilityRole="header" style={{ fontSize: 38, lineHeight: 40 }}>Nouveau mot de passe</T>
        {error && <ErrorBanner message={error} />}
        <TextField
          label="Nouveau mot de passe"
          value={password}
          onChangeText={setPassword}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          hint={<View style={{ gap: 4 }}>{PASSWORD_RULES.map((r) => <Rule key={r.label} ok={r.test(password)} label={r.label} />)}</View>}
        />
        <TextField label="Confirmer le mot de passe" value={confirm} onChangeText={setConfirm} password autoComplete="new-password" onSubmitEditing={submit} />
        <Button label="Enregistrer" variant="accent" loading={busy} onPress={submit} />
        <T muted style={{ fontSize: 13 }}>Toutes vos sessions seront fermées : reconnectez-vous ensuite sur vos appareils.</T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
