import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, Ebook, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useQuery } from '@/lib/use-query';
import { Button, Card, Cover, EmptyState, ErrorBanner, IconButton, Skeleton, T, Tag, useToast } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, gutter } from '@/ui/theme';

export default function EbookScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { cart, addToCart, user, setAfterLogin, checkoutMode, config } = useStore();
  const { data: e, error, loading, reload } = useQuery<Ebook>(`catalog/ebooks/${slug}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!e) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top + 12, paddingHorizontal: gutter, gap: 20 }}>
        <IconButton icon="back" label="Retour" onPress={() => router.back()} />
        {loading && (
          <View style={{ alignItems: 'center', gap: 20 }}>
            <Skeleton w={196} h={290} />
            <Skeleton h={40} />
            <Skeleton h={120} />
          </View>
        )}
        {error && (error.includes('introuvable') ? <EmptyState icon="search" title="Cet e-book n’est plus disponible" /> : <ErrorBanner message={error} onRetry={reload} />)}
      </View>
    );
  }

  const inCart = cart.items.some((i) => i.id === e.id);
  const webOnly = checkoutMode === 'web_only';

  const add = async (then?: 'checkout') => {
    setActionError(null);
    setBusy(true);
    try {
      if (!inCart) await addToCart(e);
      if (then === 'checkout') {
        if (user) router.push('/checkout/pay');
        else {
          setAfterLogin('pay');
          router.push({ pathname: '/login', params: { reason: 'checkout' } });
        }
      } else toast('Ajouté au panier');
    } catch (err) {
      setActionError(err instanceof ApiError && err.status === 409 ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const facts = [
    ['Format', e.format ?? 'À définir'],
    ['Pages', e.pages ? String(e.pages) : '—'],
    ['Lecture', 'Dans l’app'],
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ backgroundColor: e.cover.tint, paddingBottom: 32 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: insets.top + 12, paddingHorizontal: gutter, paddingBottom: 12 }}>
            <IconButton icon="back" label="Retour" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
            <IconButton icon="cart" label="Panier" badge={cart.items.length} onPress={() => router.navigate('/cart')} />
          </View>
          <View style={{ alignItems: 'center', paddingTop: 12 }}>
            <Cover title={e.title} author={e.author} cover={e.cover} width={196} />
          </View>
        </View>
        <View style={{ paddingHorizontal: gutter, paddingTop: 24, gap: 12 }}>
          {e.category && <Tag label={e.category.name} />}
          <T serif accessibilityRole="header" style={{ fontSize: 38, lineHeight: 40 }}>{e.title}</T>
          <T>par <T weight="bold">{e.author}</T></T>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: gutter, paddingTop: 20 }}>
          {facts.map(([l, v]) => (
            <Card key={l} style={{ flex: 1, padding: 14, borderRadius: 14 }}>
              <T muted weight="semibold" style={{ fontSize: 12 }}>{l}</T>
              <T weight="bold" style={{ fontSize: 15 }}>{v}</T>
            </Card>
          ))}
        </View>
        <View style={{ paddingHorizontal: gutter, paddingTop: 24, gap: 10 }}>
          <T weight="bold" accessibilityRole="header" style={{ fontSize: 17 }}>Description</T>
          <T style={{ lineHeight: 26, color: '#2E3040' }}>{e.description}</T>
        </View>
        <View style={{ paddingHorizontal: gutter, paddingTop: 20 }}>
          <Pressable
            onPress={() => router.push({ pathname: '/reader/[id]', params: { id: e.owned ? e.id : e.slug, preview: e.owned ? undefined : '1' } })}
            accessibilityRole="button"
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface }, pressed && { opacity: 0.7 }]}
          >
            <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: color.indigoSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="eye" color={color.indigo} />
            </View>
            <View style={{ flex: 1 }}>
              <T weight="bold">{e.owned ? 'Ouvrir dans le lecteur' : 'Lire un extrait gratuit'}</T>
              <T muted style={{ fontSize: 14 }}>{e.owned ? 'Cet e-book est dans votre bibliothèque' : 'Les premières pages, sans compte'}</T>
            </View>
            <Icon name="chevron" color={color.muted} />
          </Pressable>
        </View>
      </ScrollView>

      <View style={{ backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, paddingTop: 14, paddingHorizontal: gutter, paddingBottom: Math.max(insets.bottom, 16), gap: 10 }}>
        {actionError && <ErrorBanner message={actionError} />}
        {e.owned ? (
          <Button label="Lire maintenant" variant="accent" icon="books" onPress={() => router.push({ pathname: '/reader/[id]', params: { id: e.id } })} />
        ) : webOnly ? (
          // Mode « app de lecture » : pas de prix ni d'achat dans l'app (règles des stores).
          <View style={{ gap: 10 }}>
            <T muted style={{ textAlign: 'center', fontSize: 14, lineHeight: 20 }}>
              Cet e-book s’achète sur notre site. Il apparaîtra ensuite dans votre bibliothèque, avec le même compte.
            </T>
            {config?.webCheckoutUrl && <Button label="Ouvrir le site" variant="ghost" small onPress={() => WebBrowser.openBrowserAsync(config.webCheckoutUrl!)} />}
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View>
                <T muted weight="semibold" style={{ fontSize: 12 }}>Prix</T>
                <T weight="bold" style={{ fontSize: 22 }}>{money(e.priceCents, e.currency)}</T>
              </View>
              {inCart ? (
                <Button label="Dans le panier" icon="check" onPress={() => router.navigate('/cart')} style={{ flex: 1 }} />
              ) : (
                <Button label="Ajouter au panier" variant="accent" icon="cart" loading={busy} onPress={() => add()} style={{ flex: 1 }} />
              )}
            </View>
            <Button label="Acheter maintenant" variant="ghost" small disabled={busy} onPress={() => add('checkout')} />
          </>
        )}
      </View>
    </View>
  );
}
