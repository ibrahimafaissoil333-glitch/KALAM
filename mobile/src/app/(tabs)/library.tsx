import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { api, errorMessage, LibraryItem, BookContent } from '@/lib/api';
import { normalize } from '@/lib/format';
import { offlineMeta, OfflineMeta, reconcileOffline, removeOffline, saveOffline } from '@/lib/offline';
import { cacheLibrary, cachedLibrary, flushProgress, latest, localProgress } from '@/lib/progress';
import { useStore } from '@/lib/store';
import { Button, Cover, EmptyState, ErrorBanner, IconButton, ScreenHeader, Skeleton, StatusPill, T, Tag, useToast } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, font, gutter } from '@/ui/theme';

const TABS = [
  ['all', 'Tous'],
  ['reading', 'En cours'],
  ['offline', 'Hors ligne'],
] as const;
type Tab = (typeof TABS)[number][0];

const RECENT_MS = 3 * 86_400_000;

export default function LibraryScreen() {
  const { user, online, setAfterLogin } = useStore();
  const toast = useToast();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [meta, setMeta] = useState<OfflineMeta>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      await flushProgress();
      const list = await api<LibraryItem[]>('library');
      // Progression locale plus récente (lecture hors ligne) prioritaire.
      for (const it of list) {
        const p = latest(await localProgress(it.id), it.progress);
        it.progress = p;
      }
      await reconcileOffline(list.map((i) => ({ id: i.id, contentVersion: i.contentVersion })));
      await cacheLibrary(list);
      setItems(list);
    } catch (e) {
      // Hors ligne : on affiche la dernière liste connue.
      const cached = await cachedLibrary();
      if (cached.length) setItems(cached);
      setError(errorMessage(e));
    } finally {
      setMeta(await offlineMeta());
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const visible = useMemo(() => {
    let list = items ?? [];
    if (!online || tab === 'offline') list = list.filter((i) => meta[i.id]);
    if (tab === 'reading') list = list.filter((i) => (i.progress?.percent ?? 0) > 0 && (i.progress?.percent ?? 0) < 100);
    if (q.trim()) {
      const n = normalize(q);
      list = list.filter((i) => normalize(`${i.title} ${i.author}`).includes(n));
    }
    return list;
  }, [items, tab, q, meta, online]);

  const download = async (it: LibraryItem) => {
    setDownloading(it.id);
    try {
      const content = await api<BookContent>(`library/${it.id}/content`);
      await saveOffline(content);
      setMeta(await offlineMeta());
      toast('Téléchargé pour une lecture hors ligne');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setDownloading(null);
    }
  };

  const removeDownload = async (it: LibraryItem) => {
    await removeOffline(it.id);
    setMeta(await offlineMeta());
    toast('Retiré de l’appareil');
  };

  if (!user) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Ma bibliothèque" />
        <EmptyState icon="lock" title="Connectez-vous pour voir vos e-books">
          <Button label="Se connecter" variant="accent" onPress={() => { setAfterLogin('library'); router.push('/login'); }} />
          <Button label="Créer un compte" variant="ghost" onPress={() => { setAfterLogin('library'); router.push('/signup'); }} />
        </EmptyState>
      </View>
    );
  }

  if (items && items.length === 0 && !error) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Ma bibliothèque" />
        <EmptyState icon="books" title="Aucun e-book pour l’instant" text="Vos achats apparaîtront ici dès la confirmation du paiement.">
          <Button label="Explorer le catalogue" onPress={() => router.navigate('/catalog')} />
        </EmptyState>
      </View>
    );
  }

  const header = (
    <View style={{ gap: 14, paddingBottom: 8 }}>
      <ScreenHeader title="Ma bibliothèque" />
      <View style={{ paddingHorizontal: gutter, gap: 14 }}>
        <View>
          <View style={{ position: 'absolute', left: 16, top: 15, zIndex: 1 }} pointerEvents="none">
            <Icon name="search" color={color.muted} />
          </View>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Rechercher dans ma bibliothèque"
            placeholderTextColor={color.placeholder}
            accessibilityLabel="Rechercher dans ma bibliothèque"
            maxFontSizeMultiplier={2}
            style={{ minHeight: 52, borderRadius: 14, borderWidth: 1.5, borderColor: color.borderStrong, backgroundColor: color.surface, paddingLeft: 48, paddingRight: 16, fontSize: 16, fontFamily: font.regular, color: color.ink }}
          />
        </View>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: '#EFEEE9', borderRadius: 12, padding: 4 }}>
          {TABS.map(([k, l]) => (
            <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={{ flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === k ? color.surface : 'transparent' }}>
              <T weight="semibold" style={{ fontSize: 14, color: tab === k ? color.ink : color.muted }}>{l}</T>
            </Pressable>
          ))}
        </View>
        {error && online && <ErrorBanner message={error} onRetry={load} />}
      </View>
    </View>
  );

  return (
    <FlatList
      data={visible}
      keyExtractor={(i) => i.id}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={loading && !!items} onRefresh={load} />}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        !items ? (
          <View style={{ paddingHorizontal: gutter, gap: 16 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={112} />)}</View>
        ) : (
          <EmptyState
            icon={tab === 'offline' || !online ? 'download' : 'search'}
            title={q ? 'Aucun résultat' : tab === 'offline' || !online ? 'Aucun e-book téléchargé' : 'Aucune lecture en cours'}
            text={tab === 'offline' || !online ? 'Touchez l’icône de téléchargement d’un e-book pour le lire sans connexion.' : undefined}
          />
        )
      }
      renderItem={({ item: it }) => {
        const p = it.progress?.percent ?? 0;
        const isNew = Date.now() - new Date(it.grantedAt).getTime() < RECENT_MS && p === 0;
        const off = !!meta[it.id];
        return (
          <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 16, marginHorizontal: gutter, borderBottomWidth: 1, borderBottomColor: color.divider }}>
            <Cover title={it.title} author={it.author} cover={it.cover} width={76} />
            <View style={{ flex: 1, gap: 4 }}>
              {isNew && <Tag label="Nouveau" tone="lime" />}
              <T weight="bold">{it.title}</T>
              <T muted style={{ fontSize: 14 }}>{it.author}</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }} accessibilityLabel={`Progression : ${p} %`}>
                <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: color.border }}>
                  <View style={{ width: `${p}%`, height: 4, borderRadius: 2, backgroundColor: color.indigo }} />
                </View>
                <T muted weight="semibold" style={{ fontSize: 12 }}>{p} %</T>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 'auto', paddingTop: 8 }}>
                <Button
                  label={p > 0 ? 'Reprendre' : 'Lire'}
                  variant="accent"
                  small
                  disabled={!it.readable || (!online && !off)}
                  accessibilityLabel={`${p > 0 ? 'Reprendre' : 'Lire'} ${it.title}`}
                  onPress={() => router.push({ pathname: '/reader/[id]', params: { id: it.id } })}
                  style={{ minHeight: 44 }}
                />
                {off ? (
                  <Pressable onPress={() => removeDownload(it)} accessibilityRole="button" accessibilityLabel={`${it.title} est disponible hors ligne. Toucher pour le retirer de l’appareil`}>
                    <StatusPill status="OFFLINE" />
                  </Pressable>
                ) : (
                  it.readable && online && (
                    downloading === it.id ? <T muted style={{ fontSize: 13 }}>Téléchargement…</T> : <IconButton icon="download" label={`Télécharger ${it.title} pour le lire hors ligne`} onPress={() => download(it)} />
                  )
                )}
              </View>
            </View>
          </View>
        );
      }}
    />
  );
}

