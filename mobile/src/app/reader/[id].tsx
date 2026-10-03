import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, BookContent, errorMessage, LibraryItem } from '@/lib/api';
import { loadOffline } from '@/lib/offline';
import { latest, localProgress, saveProgress } from '@/lib/progress';
import { useStore } from '@/lib/store';
import { Button, EmptyState, IconButton, T } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, font } from '@/ui/theme';

const SIZE_MIN = 15;
const SIZE_MAX = 27;
const PREFS = 'folio.reader.prefs';
const WORDS_PER_MINUTE = 230;

/**
 * Lecteur natif : le contenu arrive en blocs de texte (titres, paragraphes, citations).
 * Taille et interligne réglables, sommaire, temps restant, progression synchronisée.
 * `preview=1` : extrait gratuit, `id` est alors le slug de l'e-book.
 */
export default function Reader() {
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const isPreview = preview === '1';
  const insets = useSafeAreaInsets();
  const { online, user, addToCart, setAfterLogin, checkoutMode } = useStore();
  const [book, setBook] = useState<BookContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapter, setChapter] = useState(0);
  const [fontSize, setFontSize] = useState(19);
  const [lineHeight, setLineHeight] = useState(1.55);
  const [sheet, setSheet] = useState<'toc' | 'display' | null>(null);
  const [frac, setFrac] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const contentH = useRef(0);
  const viewH = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Chargement : hors ligne d'abord (chiffré sur l'appareil), sinon le serveur.
  useEffect(() => {
    (async () => {
      try {
        AsyncStorage.getItem(PREFS).then((p) => {
          if (!p) return;
          const v = JSON.parse(p);
          setFontSize(v.fontSize ?? 19);
          setLineHeight(v.lineHeight ?? 1.55);
        });
        if (isPreview) {
          setBook(await api<BookContent>(`catalog/ebooks/${id}/preview`, { auth: false }));
          return;
        }
        const offline = await loadOffline(id);
        const content = offline ?? (await api<BookContent>(`library/${id}/content`));
        setBook(content);
        let server: LibraryItem['progress'] = null;
        if (online) {
          const lib = await api<LibraryItem[]>('library').catch(() => [] as LibraryItem[]);
          server = lib.find((b) => b.id === id)?.progress ?? null;
        }
        const p = latest(await localProgress(id), server);
        if (p) {
          const ch = Math.min(p.chapterIndex, content.chapters.length - 1);
          setChapter(ch);
          resumeAt.current = content.chapters[ch].blocks.length ? p.blockIndex / content.chapters[ch].blocks.length : 0;
        }
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [id, isPreview, online]);

  const counts = useMemo(() => book?.chapters.map((c) => c.blocks.length) ?? [], [book]);
  const totalBlocks = counts.reduce((a, b) => a + b, 0);
  const before = counts.slice(0, chapter).reduce((a, b) => a + b, 0);
  const current = book?.chapters[chapter];
  const blockIndex = current ? Math.min(current.blocks.length - 1, Math.floor(frac * current.blocks.length)) : 0;
  const percent = totalBlocks ? Math.min(100, Math.round(((before + frac * (current?.blocks.length ?? 0)) / totalBlocks) * 100)) : 0;

  const wordsLeft = useMemo(() => {
    if (!book) return 0;
    let n = 0;
    book.chapters.forEach((c, ci) =>
      c.blocks.forEach((b, bi) => {
        if (ci > chapter || (ci === chapter && bi >= blockIndex)) n += b.text.split(/\s+/).length;
      }),
    );
    return n;
  }, [book, chapter, blockIndex]);
  const minutesLeft = Math.max(1, Math.round(wordsLeft / WORDS_PER_MINUTE));

  const persist = useCallback(() => {
    if (isPreview || !book) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveProgress(id, { chapterIndex: chapter, blockIndex, percent }), 1200);
  }, [isPreview, book, id, chapter, blockIndex, percent]);

  useEffect(() => {
    persist();
  }, [persist]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const max = Math.max(1, contentH.current - viewH.current);
    setFrac(Math.max(0, Math.min(1, e.nativeEvent.contentOffset.y / max)));
  };

  const goChapter = (i: number) => {
    setSheet(null);
    setChapter(i);
    setFrac(0);
    resumeAt.current = null;
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const setPrefs = (fs: number, lh: number) => {
    setFontSize(fs);
    setLineHeight(lh);
    AsyncStorage.setItem(PREFS, JSON.stringify({ fontSize: fs, lineHeight: lh }));
  };

  const buy = async () => {
    try {
      const e = await api<import('@/lib/api').Ebook>(`catalog/ebooks/${id}`);
      if (!e.owned) await addToCart(e);
      if (user) router.replace('/checkout/pay');
      else {
        setAfterLogin('pay');
        router.replace({ pathname: '/login', params: { reason: 'checkout' } });
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/library'));

  if (error && !book) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top + 12, backgroundColor: color.readerPaper }}>
        <View style={{ paddingHorizontal: 16 }}>
          <IconButton icon="back" label="Fermer la lecture" tone="reader" onPress={close} />
        </View>
        <EmptyState icon={online ? 'alert' : 'offline'} title={online ? 'Lecture impossible' : 'Disponible en ligne uniquement'} text={online ? error : 'Téléchargez cet e-book depuis votre bibliothèque pour le lire sans connexion.'} />
      </View>
    );
  }
  if (!book || !current) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.readerPaper }}>
        <ActivityIndicator color={color.ink} />
      </View>
    );
  }

  const textStyle = { fontFamily: font.serif, fontSize, lineHeight: fontSize * lineHeight, color: color.readerText };

  return (
    <View style={{ flex: 1, backgroundColor: color.readerPaper }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8 }}>
        <IconButton icon="back" label="Fermer la lecture" tone="reader" onPress={close} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <T weight="bold" numberOfLines={1} style={{ fontSize: 14 }}>{book.title}</T>
          <T numberOfLines={1} style={{ fontSize: 12, color: color.readerMuted }}>{isPreview ? 'Extrait gratuit' : current.title}</T>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <IconButton icon="list" label="Sommaire" tone="reader" onPress={() => setSheet('toc')} />
          <IconButton icon="text" label="Réglages d’affichage" tone="reader" onPress={() => setSheet('display')} />
        </View>
      </View>

      {isPreview && checkoutMode !== 'web_only' && (
        <View style={{ marginHorizontal: 20, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: color.ink }}>
          <T weight="semibold" style={{ flex: 1, fontSize: 14, color: '#FFFFFF' }}>Extrait gratuit</T>
          <Button label="Acheter" variant="lime" small onPress={buy} style={{ minHeight: 40 }} />
        </View>
      )}

      <ScrollView
        ref={scroll}
        onScroll={onScroll}
        scrollEventThrottle={100}
        onLayout={(e) => (viewH.current = e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => {
          contentH.current = h;
          if (resumeAt.current !== null) {
            const y = resumeAt.current * Math.max(0, h - viewH.current);
            resumeAt.current = null;
            requestAnimationFrame(() => scroll.current?.scrollTo({ y, animated: false }));
          }
        }}
        contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 24, paddingBottom: 32, maxWidth: 680, width: '100%', alignSelf: 'center' }}
      >
        <T weight="bold" style={{ fontSize: 12, letterSpacing: 1.9, textTransform: 'uppercase', color: color.readerMuted }}>
          {isPreview ? 'Extrait' : `Chapitre ${chapter + 1} sur ${book.chapters.length}`}
        </T>
        {current.blocks.map((b, i) =>
          b.t === 'h' ? (
            <T key={i} serif accessibilityRole="header" style={{ fontSize: Math.round(fontSize * 1.9), lineHeight: Math.round(fontSize * 2), marginTop: i === 0 ? 10 : 28, marginBottom: 20, color: color.readerText }}>{b.text}</T>
          ) : b.t === 'q' ? (
            <T key={i} style={[textStyle, { fontStyle: 'italic', marginBottom: 18, paddingLeft: 16, borderLeftWidth: 3, borderLeftColor: color.readerBorder }]}>{b.text}</T>
          ) : (
            <T key={i} style={[textStyle, { marginBottom: 18 }]}>{b.text}</T>
          ),
        )}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
          {chapter > 0 && <Button label="Chapitre précédent" variant="ghost" small onPress={() => goChapter(chapter - 1)} style={{ flex: 1 }} />}
          {chapter < book.chapters.length - 1 && <Button label="Chapitre suivant" variant="primary" small onPress={() => goChapter(chapter + 1)} style={{ flex: 1 }} />}
        </View>
        {isPreview && (
          <View style={{ marginTop: 32, gap: 12, alignItems: 'center' }}>
            <T serif style={{ fontSize: 26, textAlign: 'center', color: color.readerText }}>Fin de l’extrait</T>
            {checkoutMode !== 'web_only' && <Button label="Acheter pour lire la suite" variant="accent" onPress={buy} />}
          </View>
        )}
      </ScrollView>

      {!isPreview && (
        <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16), gap: 10 }} accessibilityLabel={`Progression ${percent} %, environ ${minutesLeft} minutes restantes`}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: color.readerTrack }}>
            <View style={{ width: `${percent}%`, height: 4, borderRadius: 2, backgroundColor: color.ink }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T weight="semibold" style={{ fontSize: 12, color: color.readerMuted }}>{percent} %</T>
            <T weight="semibold" style={{ fontSize: 12, color: color.readerMuted }}>≈ {minutesLeft} min restantes</T>
          </View>
        </View>
      )}

      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,21,31,.4)' }} onPress={() => setSheet(null)} accessibilityLabel="Fermer" accessibilityRole="button" />
        <View style={{ backgroundColor: color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), maxHeight: '70%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <T serif accessibilityRole="header" style={{ fontSize: 28 }}>{sheet === 'toc' ? 'Sommaire' : 'Affichage'}</T>
            <IconButton icon="close" label="Fermer" onPress={() => setSheet(null)} />
          </View>
          {sheet === 'toc' && (
            <ScrollView>
              {book.chapters.map((c, i) => (
                <Pressable key={i} onPress={() => goChapter(i)} accessibilityRole="button" accessibilityState={{ selected: i === chapter }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: color.divider, minHeight: 52 }}>
                  <T muted weight="semibold" style={{ width: 28, fontSize: 14 }}>{i + 1}</T>
                  <T weight={i === chapter ? 'bold' : 'regular'} style={{ flex: 1, color: i === chapter ? color.indigo : color.ink }}>{c.title}</T>
                  {i === chapter && <Icon name="check" size={18} color={color.indigo} />}
                </Pressable>
              ))}
            </ScrollView>
          )}
          {sheet === 'display' && (
            <View style={{ gap: 20 }}>
              <View style={{ gap: 10 }}>
                <T weight="semibold" style={{ fontSize: 14 }}>Taille du texte : {fontSize} px</T>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button label="A−" variant="ghost" accessibilityLabel="Texte plus petit" disabled={fontSize <= SIZE_MIN} onPress={() => setPrefs(Math.max(SIZE_MIN, fontSize - 2), lineHeight)} style={{ flex: 1 }} />
                  <Button label="A+" variant="ghost" accessibilityLabel="Texte plus grand" disabled={fontSize >= SIZE_MAX} onPress={() => setPrefs(Math.min(SIZE_MAX, fontSize + 2), lineHeight)} style={{ flex: 1 }} />
                </View>
              </View>
              <View style={{ gap: 10 }}>
                <T weight="semibold" style={{ fontSize: 14 }}>Interligne</T>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {[[1.4, 'Serré'], [1.55, 'Normal'], [1.8, 'Aéré']].map(([v, l]) => (
                    <Pressable key={l} onPress={() => setPrefs(fontSize, v as number)} accessibilityRole="button" accessibilityState={{ selected: lineHeight === v }} style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: lineHeight === v ? color.ink : color.borderControl, backgroundColor: lineHeight === v ? color.ink : color.surface, alignItems: 'center', justifyContent: 'center' }}>
                      <T weight="semibold" style={{ fontSize: 14, color: lineHeight === v ? '#FFFFFF' : color.ink }}>{l}</T>
                    </Pressable>
                  ))}
                </View>
              </View>
              <T serif style={{ ...textStyle, backgroundColor: color.readerPaper, padding: 16, borderRadius: 14 }}>Aperçu : la lecture garde une colonne étroite et un interlignage généreux.</T>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}
