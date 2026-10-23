import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, FlatList, NativeScrollEvent, NativeSyntheticEvent, Pressable, useWindowDimensions, View } from 'react-native';
import type { Ebook } from '@/lib/api';
import { money } from '@/lib/format';
import { promoVideoUrl } from '@/lib/supabase';
import { Button, Cover, T } from './components';
import { color, gutter } from './theme';

export interface PromoSlide {
  id: string;
  headline: string | null;
  subtitle: string | null;
  videoPath: string | null;
  ebook: Ebook;
}

const IMAGE_MS = 6000;
const VIDEO_MS = 12000;
const HEIGHT = 260;

const open = (e: Ebook) => router.push({ pathname: '/ebook/[slug]', params: { slug: e.slug } });

/** Vidéo de fond, lue (sans le son, en boucle) uniquement quand la diapositive est affichée. */
function SlideVideo({ uri, playing }: { uri: string; playing: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  return <VideoView player={player} contentFit="cover" nativeControls={false} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />;
}

/**
 * Bannière d'accueil en carrousel : livres mis en avant par l'admin (avec vidéo facultative),
 * ou à défaut la sélection du moment. Défilement automatique, désactivé si « Réduire les animations ».
 */
export function HeroCarousel({ slides, greeting }: { slides: PromoSlide[]; greeting: string }) {
  const { width } = useWindowDimensions();
  const cardWidth = width - gutter * 2;
  const list = useRef<FlatList<PromoSlide>>(null);
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const touching = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (slides.length < 2 || reduceMotion) return;
    const t = setTimeout(() => {
      if (touching.current) return;
      const next = (index + 1) % slides.length;
      list.current?.scrollToOffset({ offset: next * cardWidth, animated: true });
      setIndex(next);
    }, slides[index]?.videoPath ? VIDEO_MS : IMAGE_MS);
    return () => clearTimeout(t);
  }, [index, slides, cardWidth, reduceMotion]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    touching.current = false;
    setIndex(Math.round(e.nativeEvent.contentOffset.x / cardWidth));
  };

  return (
    <View style={{ gap: 10 }}>
      <FlatList
        ref={list}
        data={slides}
        keyExtractor={(s) => s.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ width: cardWidth, alignSelf: 'center', borderRadius: 24 }}
        getItemLayout={(_, i) => ({ length: cardWidth, offset: cardWidth * i, index: i })}
        onScrollBeginDrag={() => (touching.current = true)}
        onMomentumScrollEnd={onScrollEnd}
        renderItem={({ item: s, index: i }) => {
          const e = s.ebook;
          const video = promoVideoUrl(s.videoPath);
          return (
            <Pressable
              onPress={() => open(e)}
              accessibilityRole="button"
              accessibilityLabel={`${s.headline ?? e.title}. ${s.subtitle ?? e.author}. Diapositive ${i + 1} sur ${slides.length}`}
              style={{ width: cardWidth, height: HEIGHT, backgroundColor: color.ink, borderRadius: 24, overflow: 'hidden' }}
            >
              {video && <SlideVideo uri={video} playing={i === index} />}
              {video && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,21,31,.55)' }} />}
              <View style={{ flex: 1, padding: 22, paddingTop: 24, width: video ? '100%' : 210, gap: 12, zIndex: 1 }}>
                <T weight="bold" numberOfLines={1} style={{ fontSize: 12, letterSpacing: 1.7, textTransform: 'uppercase', color: color.gold }}>
                  {i === 0 && greeting ? greeting : 'À la une'}
                </T>
                <T serif numberOfLines={3} style={{ color: '#FFFFFF', fontSize: 30, lineHeight: 32 }}>{s.headline ?? e.title}</T>
                <T numberOfLines={2} style={{ color: '#D9DAE3', fontSize: 14 }}>
                  {s.subtitle ?? `${e.author} · ${e.owned ? 'Acheté' : money(e.priceCents, e.currency)}`}
                </T>
                <Button label="Découvrir" variant="gold" small iconRight="arrow" onPress={() => open(e)} style={{ alignSelf: 'flex-start', marginTop: 'auto' }} />
              </View>
              {!video && (
                <View style={{ position: 'absolute', right: -14, top: 34, transform: [{ rotate: '7deg' }] }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                  <Cover title={e.title} author={e.author} cover={e.cover} width={128} />
                </View>
              )}
            </Pressable>
          );
        }}
      />
      {slides.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {slides.map((s, i) => (
            <View key={s.id} style={{ width: i === index ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === index ? color.accent : color.borderStrong }} />
          ))}
        </View>
      )}
    </View>
  );
}
