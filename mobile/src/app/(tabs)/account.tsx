import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { api, errorMessage, Order } from '@/lib/api';
import { money, plural, shortDate } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Button, Card, Divider, EmptyState, ErrorBanner, RowLink, ScreenHeader, StatusPill, Switch, T, useToast } from '@/ui/components';
import { color, gutter } from '@/ui/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Prefs {
  orders: boolean;
  ebookUpdates: boolean;
  marketing: boolean;
}

export default function AccountScreen() {
  const { user, logout, config } = useStore();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      Promise.all([api<Order[]>('orders'), api<Prefs>('me/notifications')])
        .then(([o, p]) => {
          setOrders(o);
          setPrefs(p);
          setError(null);
        })
        .catch((e) => setError(errorMessage(e)));
    }, [user]),
  );

  if (!user) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Compte" />
        <EmptyState icon="user" title="Retrouvez vos achats partout">
          <Button label="Se connecter" variant="accent" onPress={() => router.push('/login')} />
          <Button label="Créer un compte" variant="ghost" onPress={() => router.push('/signup')} />
        </EmptyState>
        <View style={{ paddingHorizontal: gutter, paddingBottom: 16 }}>
          <RowLink icon="help" label="Aide" onPress={() => router.push('/account/help')} />
        </View>
      </View>
    );
  }

  const setPref = async (k: 'ebookUpdates' | 'marketing', v: boolean) => {
    if (!prefs) return;
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    try {
      setPrefs(await api<Prefs>('me/notifications', { method: 'PUT', body: { ebookUpdates: next.ebookUpdates, marketing: next.marketing } }));
    } catch (e) {
      setPrefs(prefs);
      toast(errorMessage(e));
    }
  };

  const openLegal = (url: string | null | undefined) => (url ? WebBrowser.openBrowserAsync(url) : toast('Document bientôt disponible'));

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <T serif style={{ fontSize: 28, color: color.lime }}>{user.name.charAt(0).toUpperCase()}</T>
        </View>
        <View style={{ flex: 1 }}>
          <T weight="bold" accessibilityRole="header" style={{ fontSize: 22 }}>{user.name}</T>
          <T muted style={{ fontSize: 14 }}>{user.email}</T>
        </View>
      </View>

      {error && <View style={{ paddingHorizontal: gutter, paddingTop: 16 }}><ErrorBanner message={error} /></View>}

      <View style={{ paddingHorizontal: gutter, paddingTop: 24, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T serif accessibilityRole="header" style={{ fontSize: 26 }}>Mes commandes</T>
          {orders && orders.length > 3 && <Button label="Tout voir" variant="link" small onPress={() => router.push('/account/orders')} />}
        </View>
        {orders && orders.length === 0 && <Card style={{ padding: 16 }}><T muted style={{ fontSize: 14 }}>Aucune commande pour le moment.</T></Card>}
        {orders && orders.length > 0 && (
          <Card>
            {orders.slice(0, 3).map((o, i) => (
              <Pressable key={o.id} onPress={() => router.push({ pathname: '/checkout/result', params: { order: o.id } })} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: i ? 1 : 0, borderTopColor: color.divider }}>
                <View style={{ flex: 1 }}>
                  <T weight="bold" style={{ fontSize: 15 }}>Commande {o.reference}</T>
                  <T muted style={{ fontSize: 13 }}>{shortDate(o.createdAt)} · {plural(o.items.length)} · {money(o.totalCents, o.currency)}</T>
                </View>
                <StatusPill status={o.status} />
              </Pressable>
            ))}
          </Card>
        )}
      </View>

      <View style={{ paddingHorizontal: gutter, paddingTop: 24, gap: 10 }}>
        <T serif accessibilityRole="header" style={{ fontSize: 26 }}>Notifications</T>
        <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          <Switch value label="Commandes et compte" sub="Toujours actif, nécessaire au service" disabled />
          <Divider />
          <Switch value={prefs?.ebookUpdates ?? true} onChange={(v) => setPref('ebookUpdates', v)} label="Mises à jour d’e-books" sub="Quand un e-book acheté est mis à jour" />
          <Divider />
          <Switch value={prefs?.marketing ?? false} onChange={(v) => setPref('marketing', v)} label="Nouveautés et offres" sub="Avec votre accord uniquement" />
        </Card>
      </View>

      <View style={{ paddingHorizontal: gutter, paddingTop: 24, gap: 10 }}>
        <T serif accessibilityRole="header" style={{ fontSize: 26 }}>Paramètres</T>
        <Card style={{ paddingHorizontal: 16 }}>
          <RowLink icon="user" label="Informations personnelles" onPress={() => router.push('/account/profile')} />
          <Divider />
          <RowLink icon="shield" label="Sécurité" sub="Mot de passe, appareils" onPress={() => router.push('/account/security')} />
          <Divider />
          <RowLink icon="help" label="Aide" onPress={() => router.push('/account/help')} />
          <Divider />
          <RowLink icon="doc" label="Conditions générales" onPress={() => openLegal(config?.legal.terms)} />
          <Divider />
          <RowLink icon="lock" label="Confidentialité" onPress={() => openLegal(config?.legal.privacy)} />
        </Card>
      </View>

      <View style={{ paddingHorizontal: gutter, paddingTop: 24, gap: 12 }}>
        <Button label="Se déconnecter" variant="ghost" icon="logout" onPress={async () => { await logout(); toast('Vous êtes déconnecté'); router.navigate('/'); }} />
        <Button label="Supprimer mon compte" variant="danger" small onPress={() => router.push('/account/delete')} />
      </View>
    </ScrollView>
  );
}
