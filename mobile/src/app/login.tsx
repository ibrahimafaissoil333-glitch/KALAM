import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { errorMessage } from '@/lib/api';
import { plural } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Button, ErrorBanner, InfoNote, LinkButton, ScreenHeader, T, TextField, useToast } from '@/ui/components';
import { continueAfterAuth } from '@/lib/navigation';
import { gutter } from '@/ui/theme';

export default function LoginScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const { login, cart, afterLogin, setAfterLogin } = useStore();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.includes('@')) return setError('Saisissez une adresse e-mail valide.');
    if (!password) return setError('Saisissez votre mot de passe.');
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast('Connexion réussie');
      continueAfterAuth(afterLogin, setAfterLogin);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader back />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 8, paddingBottom: 32, gap: 22 }}>
        <View style={{ gap: 10 }}>
          <T serif accessibilityRole="header" style={{ fontSize: 38, lineHeight: 40 }}>
            {reason === 'checkout' ? 'Connectez-vous pour finaliser l’achat' : 'Connexion'}
          </T>
          <T muted style={{ lineHeight: 24 }}>Vos e-books sont rattachés à votre compte : vous les retrouvez sur tous vos appareils.</T>
        </View>
        {cart.items.length > 0 && <InfoNote icon="cart" tone="indigo">Votre panier est conservé ({plural(cart.items.length)})</InfoNote>}
        {error && <ErrorBanner message={error} />}
        <TextField label="Adresse e-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" placeholder="vous@exemple.fr" />
        <View>
          <TextField label="Mot de passe" value={password} onChangeText={setPassword} password autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
          <LinkButton label="Mot de passe oublié ?" onPress={() => router.push({ pathname: '/forgot', params: { email } })} style={{ alignSelf: 'flex-end' }} />
        </View>
        <Button label="Se connecter" variant="accent" loading={busy} onPress={submit} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: '#E0DFD9' }} />
          <T muted style={{ fontSize: 14 }}>Nouveau sur Folio ?</T>
          <View style={{ flex: 1, height: 1, backgroundColor: '#E0DFD9' }} />
        </View>
        <Button label="Créer un compte" variant="ghost" onPress={() => router.replace({ pathname: '/signup', params: { reason } })} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
