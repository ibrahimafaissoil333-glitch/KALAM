import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { errorMessage } from '@/lib/api';
import { PASSWORD_RULES, passwordOk } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Button, Checkbox, ErrorBanner, LinkButton, Rule, ScreenHeader, T, TextField, useToast } from '@/ui/components';
import { gutter } from '@/ui/theme';
import { continueAfterAuth } from '@/lib/navigation';

export default function SignupScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const { register, afterLogin, setAfterLogin, config } = useStore();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('Indiquez un prénom ou un pseudonyme.');
    if (!email.includes('@')) return setError('Saisissez une adresse e-mail valide.');
    if (!passwordOk(password)) return setError('Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.');
    if (!terms) return setError('Acceptez les conditions pour créer votre compte.');
    setBusy(true);
    try {
      await register({ name: name.trim(), email: email.trim(), password, marketingConsent: marketing });
      toast('Compte créé, bienvenue !');
      continueAfterAuth(afterLogin, setAfterLogin);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openLegal = (url: string | null | undefined) => url && WebBrowser.openBrowserAsync(url);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader back />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: 8, paddingBottom: 32, gap: 20 }}>
        <View style={{ gap: 10 }}>
          <T serif accessibilityRole="header" style={{ fontSize: 38, lineHeight: 40 }}>Créer votre compte</T>
          <T muted>Trois champs, et votre bibliothèque est prête.</T>
        </View>
        {error && <ErrorBanner message={error} />}
        <TextField label="Prénom ou pseudonyme" value={name} onChangeText={setName} autoComplete="given-name" textContentType="givenName" />
        <TextField label="Adresse e-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" placeholder="vous@exemple.fr" />
        <TextField
          label="Mot de passe"
          value={password}
          onChangeText={setPassword}
          password
          autoComplete="new-password"
          textContentType="newPassword"
          hint={<View style={{ gap: 4 }}>{PASSWORD_RULES.map((r) => <Rule key={r.label} ok={r.test(password)} label={r.label} />)}</View>}
        />
        <Checkbox checked={terms} onChange={setTerms}>
          <T style={{ fontSize: 14, lineHeight: 20 }}>
            J’accepte les conditions générales et la politique de confidentialité. <T muted style={{ fontSize: 14 }}>(obligatoire)</T>
          </T>
        </Checkbox>
        {(config?.legal.terms || config?.legal.privacy) && (
          <View style={{ flexDirection: 'row', gap: 16, marginTop: -12, paddingLeft: 34 }}>
            {config.legal.terms && <LinkButton label="Conditions" onPress={() => openLegal(config.legal.terms)} />}
            {config.legal.privacy && <LinkButton label="Confidentialité" onPress={() => openLegal(config.legal.privacy)} />}
          </View>
        )}
        <Checkbox checked={marketing} onChange={setMarketing}>
          <T style={{ fontSize: 14, lineHeight: 20 }}>
            Je souhaite recevoir les nouveautés par e-mail. <T muted style={{ fontSize: 14 }}>(facultatif)</T>
          </T>
        </Checkbox>
        <Button label="Créer mon compte" variant="accent" loading={busy} onPress={submit} />
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          <T muted style={{ fontSize: 14 }}>Déjà un compte ?</T>
          <LinkButton label="Se connecter" onPress={() => router.replace({ pathname: '/login', params: { reason } })} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
