import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, Ebook, errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { useStore } from '@/lib/store';
import { useQuery } from '@/lib/use-query';
import { Button, Chip, Cover, EmptyState, ErrorBanner, H1, IconButton, LinkButton, Skeleton, T } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, font, gutter } from '@/ui/theme';

const SORTS = [
  ['new', 'Nouveautés'],
  ['title', 'Titre A → Z'],
  ['author', 'Auteur A → Z'],
] as const;

interface Page {
  items: Ebook[];
  total: number;
  page: number;
  pageSize: number;
}

export default function CatalogScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ category?: string; focus?: string }>();
  const { cart } = useStore();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState(params.category ?? '');
  const [sort, setSort] = useState(0);
  const [items, setItems] = useState<Ebook[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<TextInput>(null);
  const seq = useRef(0);
  const { data: categories } = useQuery<{ name: string; slug: string }[]>('catalog/categories');

  useEffect(() => {
    if (params.category !== undefined) setCategory(params.category);
  }, [params.category]);
  useEffect(() => {
    if (params.focus) setTimeout(() => input.current?.focus(), 300);
  }, [params.focus]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = async (p: number) => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ sort: SORTS[sort][0], page: String(p), pageSize: '20', ...(debounced && { q: debounced }), ...(category && { category }) });
      const res = await api<Page>(`catalog/ebooks?${qs}`);
      if (n !== seq.current) return;
      setItems((prev) => (p === 1 ? res.items : [...(prev ?? []), ...res.items]));
      setTotal(res.total);
      setPage(p);
    } catch (e) {
      if (n === seq.current) setError(errorMessage(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, category, sort]);

  const catName = categories?.find((c) => c.slug === category)?.name;
  const filtered = !!category || !!q.trim();
  const clear = () => {
    setQ('');
    setCategory('');
  };

  const header = (
    <View>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: gutter, gap: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <H1>Catalogue</H1>
            <T muted style={{ fontSize: 14, marginTop: 6 }} accessibilityLiveRegion="polite">
              {total} e-book{total > 1 ? 's' : ''}{catName ? ` · ${catName}` : ''}
            </T>
          </View>
          <IconButton icon="cart" label="Panier" badge={cart.items.length} onPress={() => router.navigate('/cart')} />
        </View>
        <View>
          <View style={{ position: 'absolute', left: 16, top: 15, zIndex: 1 }} pointerEvents="none">
            <Icon name="search" color={color.muted} />
          </View>
          <TextInput
            ref={input}
            value={q}
            onChangeText={setQ}
            placeholder="Titre, auteur, mot-clé"
            placeholderTextColor={color.placeholder}
            accessibilityLabel="Rechercher un e-book"
            returnKeyType="search"
            autoCorrect={false}
            maxFontSizeMultiplier={2}
            style={{ minHeight: 52, borderRadius: 14, borderWidth: 1.5, borderColor: color.borderStrong, backgroundColor: color.surface, paddingLeft: 48, paddingRight: 16, fontSize: 16, fontFamily: font.regular, color: color.ink }}
          />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: gutter, paddingTop: 16 }}>
        <Chip label="Tous" selected={!category} onPress={() => setCategory('')} />
        {categories?.map((c) => <Chip key={c.slug} label={c.name} selected={category === c.slug} onPress={() => setCategory(c.slug)} />)}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: gutter, paddingTop: 8, minHeight: 52 }}>
        <Pressable onPress={() => setSort((sort + 1) % SORTS.length)} accessibilityRole="button" accessibilityLabel={`Trier : ${SORTS[sort][1]}. Toucher pour changer`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <Icon name="sort" size={18} />
          <T weight="semibold" style={{ fontSize: 14 }}>Trier : {SORTS[sort][1]}</T>
        </Pressable>
        {filtered && <LinkButton label="Effacer les filtres" onPress={clear} />}
      </View>
      {error && (
        <View style={{ paddingHorizontal: gutter, paddingBottom: 8 }}>
          <ErrorBanner message={error} onRetry={() => load(1)} />
        </View>
      )}
    </View>
  );

  return (
    <FlatList
      data={items ?? []}
      keyExtractor={(e) => e.id}
      numColumns={2}
      ListHeaderComponent={header}
      columnWrapperStyle={{ gap: 16, paddingHorizontal: gutter }}
      contentContainerStyle={{ gap: 24, paddingBottom: 24, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (!loading && items && items.length < total) load(page + 1);
      }}
      ListEmptyComponent={
        !items || (loading && items.length === 0) ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingHorizontal: gutter }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} w={'47%' as const} h={250} />)}
          </View>
        ) : error ? null : (
          <EmptyState icon="search" title="Aucun e-book ne correspond" text="Vérifiez l’orthographe, essayez un mot plus général ou retirez un filtre.">
            <Button label="Effacer la recherche et les filtres" onPress={clear} />
          </EmptyState>
        )
      }
      renderItem={({ item: e }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/ebook/[slug]', params: { slug: e.slug } })}
          accessibilityRole="button"
          accessibilityLabel={`${e.title}, ${e.author}, ${e.owned ? 'acheté' : money(e.priceCents, e.currency)}`}
          style={({ pressed }) => [{ flex: 1, gap: 10 }, pressed && { opacity: 0.75 }]}
          onLayout={undefined}
        >
          <Cover title={e.title} author={e.author} cover={e.cover} width={168} style={{ width: '100%', height: 250 }} />
          <View style={{ gap: 3 }}>
            <T weight="bold" style={{ fontSize: 15, lineHeight: 19 }}>{e.title}</T>
            <T muted style={{ fontSize: 13 }}>{e.author}</T>
            <T weight="bold" style={{ fontSize: 14, marginTop: 4, color: e.owned ? color.successText : color.ink }}>{e.owned ? 'Acheté' : money(e.priceCents, e.currency)}</T>
          </View>
        </Pressable>
      )}
    />
  );
}
