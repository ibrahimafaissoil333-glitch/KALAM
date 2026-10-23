import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import * as Linking from 'expo-linking';
import { errorMessage } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Button, EmptyState, ErrorBanner, LinkButton, ScreenHeader, T, TextField } from '@/ui/components';
import { gutter } from '@/ui/theme';

const RESEND_DELAY = 60;

export default function ForgotScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setError(null);
    if (!email.includes('@')) return setError('Saisissez une adresse e-mail valide.');
    setBusy(true);
    try {
      // Réponse identique que le compte existe ou non (pas d'énumération des comptes).
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: Linking.createURL('reset') });
      if (error && error.status === 429) throw new Error('Trop de demandes. Réessayez dans quelques minutes.');
      setSent(true);
      setWait(RESEND_DELAY);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader back />
        <EmptyState icon="mail" title="Vérifiez votre boîte mail" text={`Si un compte existe pour ${email.trim()}, vous allez recevoir un lien pour choisir un nouveau mot de passe. Il est valable 30 minutes.`}>
          {error && <ErrorBanner message={error} />}
          <Button label={wait > 0 ? `Renvoyer dans ${wait} s` : 'Renvoyer le lien'} variant="ghost" disabled={wait > 0} loading={busy} onPress={send} />
          <LinkButton label="Revenir à la connexion" onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} style={{ alignSelf: 'center' }} />
        </EmptyState>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader back />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 8, gap: 22 }}>
        <View style={{ gap: 10 }}>
          <T serif accessibilityRole="header" style={{ fontSize: 38, lineHeight: 40 }}>Mot de passe oublié</T>
          <T muted style={{ lineHeight: 24 }}>Saisissez l’e-mail de votre compte, nous vous envoyons un lien valable 30 minutes.</T>
        </View>
        {error && <ErrorBanner message={error} />}
        <TextField label="Adresse e-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="vous@exemple.fr" onSubmitEditing={send} />
        <Button label="Envoyer le lien" variant="accent" loading={busy} onPress={send} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
