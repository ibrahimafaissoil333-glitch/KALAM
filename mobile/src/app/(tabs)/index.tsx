import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Ebook } from '@/lib/api';
import { money } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useQuery } from '@/lib/use-query';
import { Button, Chip, Cover, ErrorBanner, IconButton, LinkButton, Skeleton, T, Tag } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, gutter } from '@/ui/theme';

interface Home {
  featured: Ebook[];
  latest: Ebook[];
  categories: { name: string; slug: string }[];
}

const priceLabel = (e: Ebook) => (e.owned ? 'Acheté' : money(e.priceCents, e.currency));
const open = (e: Ebook) => router.push({ pathname: '/ebook/[slug]', params: { slug: e.slug } });

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, config } = useStore();
  const { data, error, loading, reload } = useQuery<Home>('catalog/home');
  const hero = data?.featured.slice(0, 2) ?? [];
  const appName = config?.appName ?? 'Folio';

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: gutter, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T serif accessibilityRole="header" style={{ fontSize: 32 }}>
          {appName}
          <T serif style={{ fontSize: 32, color: color.indigo }}>.</T>
        </T>
        <IconButton icon="user" label={user ? 'Mon compte' : 'Se connecter'} onPress={() => router.navigate('/account')} />
      </View>

      <View style={{ paddingHorizontal: gutter, paddingTop: 12 }}>
        <View style={{ backgroundColor: color.ink, borderRadius: 24, padding: 22, paddingTop: 24, minHeight: 248, overflow: 'hidden' }}>
          <View style={{ width: 200, gap: 14, zIndex: 1 }}>
            <T weight="bold" style={{ fontSize: 12, letterSpacing: 1.7, textTransform: 'uppercase', color: color.lime }}>{user ? `Bonjour ${user.name}` : 'Nouveauté'}</T>
            <T serif accessibilityRole="header" style={{ color: '#FFFFFF', fontSize: 34, lineHeight: 35 }}>Achetez, puis lisez dans la minute.</T>
            <Button label="Explorer" variant="lime" small iconRight="arrow" onPress={() => router.navigate('/catalog')} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
          </View>
          {hero[0] && (
            <View style={{ position: 'absolute', right: -18, top: 30, transform: [{ rotate: '8deg' }] }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Cover title={hero[0].title} author={hero[0].author} cover={hero[0].cover} width={118} />
            </View>
          )}
          {hero[1] && (
            <View style={{ position: 'absolute', right: 52, top: 70, transform: [{ rotate: '-6deg' }] }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Cover title={hero[1].title} author={hero[1].author} cover={hero[1].cover} width={104} />
            </View>
          )}
        </View>
      </View>

      <View style={{ paddingHorizontal: gutter, paddingTop: 20 }}>
        <Pressable
          onPress={() => router.navigate({ pathname: '/catalog', params: { focus: '1' } })}
          accessibilityRole="search"
          accessibilityLabel="Rechercher un titre, un auteur ou un mot-clé"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderRadius: 14, borderWidth: 1.5, borderColor: color.borderStrong, backgroundColor: color.surface, paddingHorizontal: 16 }}
        >
          <Icon name="search" color={color.muted} />
          <T muted>Titre, auteur, mot-clé</T>
        </Pressable>
      </View>

      {error && !data && (
        <View style={{ padding: gutter }}>
          <ErrorBanner message={error} onRetry={reload} />
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: gutter, paddingTop: 20 }}>
        {(data?.categories ?? []).map((c) => (
          <Chip key={c.slug} label={c.name} onPress={() => router.navigate({ pathname: '/catalog', params: { category: c.slug } })} />
        ))}
      </ScrollView>

      <View style={{ paddingTop: 32, gap: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: gutter }}>
          <T serif accessibilityRole="header" style={{ fontSize: 28 }}>Sélection du moment</T>
          <LinkButton label="Tout voir" onPress={() => router.navigate('/catalog')} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingHorizontal: gutter, paddingBottom: 12 }}>
          {!data && loading && [0, 1, 2].map((i) => <Skeleton key={i} w={132} h={196} />)}
          {data?.featured.map((e) => (
            <Pressable key={e.id} onPress={() => open(e)} accessibilityRole="button" accessibilityLabel={`${e.title}, ${e.author}, ${priceLabel(e)}`} style={{ width: 132, gap: 10 }}>
              <Cover title={e.title} author={e.author} cover={e.cover} width={132} />
              <View style={{ gap: 2 }}>
                <T weight="bold" style={{ fontSize: 15, lineHeight: 19 }}>{e.title}</T>
                <T muted style={{ fontSize: 13 }}>{e.author}</T>
                <T weight="bold" style={{ fontSize: 14, marginTop: 4, color: e.owned ? color.successText : color.ink }}>{priceLabel(e)}</T>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={{ paddingTop: 20, paddingHorizontal: gutter, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T serif accessibilityRole="header" style={{ fontSize: 28 }}>Dernières parutions</T>
          <LinkButton label="Tout voir" onPress={() => router.navigate('/catalog')} />
        </View>
        {!data && loading && [0, 1, 2].map((i) => <Skeleton key={i} h={94} style={{ marginVertical: 6 }} />)}
        {data?.latest.map((e) => (
          <Pressable key={e.id} onPress={() => open(e)} accessibilityRole="button" accessibilityLabel={`${e.title}, ${e.author}, ${e.category?.name ?? ''}, ${priceLabel(e)}`} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.divider }, pressed && { opacity: 0.7 }]}>
            <Cover title={e.title} author={e.author} cover={e.cover} width={64} />
            <View style={{ flex: 1, gap: 4 }}>
              {e.category && <Tag label={e.category.name} />}
              <T weight="bold">{e.title}</T>
              <T muted style={{ fontSize: 14 }}>{e.author}</T>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              <T weight="bold" style={{ fontSize: 14, color: e.owned ? color.successText : color.ink }}>{priceLabel(e)}</T>
              <Icon name="chevron" size={20} color={color.muted} />
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
