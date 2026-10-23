import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { PASSWORD_RULES, passwordOk } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Button, EmptyState, ErrorBanner, Rule, ScreenHeader, T, TextField, useToast } from '@/ui/components';
import { color, gutter } from '@/ui/theme';

/**
 * Ouvert par le lien de l'e-mail : folio://reset?code=… (flux PKCE de Supabase Auth).
 * Le code, à usage unique et limité dans le temps, ouvre une session de récupération.
 */
export default function ResetScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) {
      setExpired(true);
      return;
    }
    supabase.auth.exchangeCodeForSession(code).then(({ error: e }) => (e ? setExpired(true) : setReady(true)));
  }, [code]);

  const submit = async () => {
    setError(null);
    if (!passwordOk(password)) return setError('Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.');
    if (password !== confirm) return setError('Les deux mots de passe ne sont pas identiques.');
    setBusy(true);
    const { error: e } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (e) return setError(e.message);
    // Toutes les sessions sont fermées ; l'utilisateur se reconnecte avec son nouveau mot de passe.
    await supabase.auth.signOut({ scope: 'global' });
    toast('Mot de passe enregistré');
    router.replace('/login');
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
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.accent} />
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
