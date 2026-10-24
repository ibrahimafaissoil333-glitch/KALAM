import { router, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { api, errorMessage } from '@/lib/api';
import { useStore } from '@/lib/store';
import { EmptyState, IconButton, T } from '@/ui/components';
import { color } from '@/ui/theme';

/**
 * Lecteur PDF intégré : les pages sont dessinées dans l'app (pdf.js) à partir d'un lien de 60 secondes,
 * jamais montré ni enregistré. Pas de téléchargement, pas de partage, captures d'écran bloquées.
 */
export default function PdfReader() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const insets = useSafeAreaInsets();
  const { online } = useStore();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<{ done: number; total: number } | null>(null);
  usePreventScreenCapture('pdf-reader');

  useEffect(() => {
    api<{ url: string }>(`library/${id}/pdf`).then((r) => setUrl(r.url)).catch((e) => setError(errorMessage(e)));
  }, [id]);

  const html = useMemo(() => (url ? viewerHtml(url, color.readerPaper) : null), [url]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/library'));

  return (
    <View style={{ flex: 1, backgroundColor: color.readerPaper, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 }}>
        <IconButton icon="back" label="Retour" tone="reader" onPress={back} />
        <T weight="semibold" numberOfLines={1} style={{ flex: 1, color: color.readerText }}>{title ?? 'Lecture'}</T>
        {pages && <T style={{ fontSize: 13, color: color.readerMuted }}>{pages.done < pages.total ? `${pages.done}/${pages.total}` : `${pages.total} p.`}</T>}
      </View>
      {error ? (
        <EmptyState icon={online ? 'alert' : 'offline'} title={online ? 'Lecture impossible' : 'Connexion requise'} text={online ? error : 'Les livres PDF se lisent avec une connexion internet.'} />
      ) : !html ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={color.accent} /></View>
      ) : (
        <WebView
          source={{ html, baseUrl: 'https://kalam.local/' }}
          originWhitelist={['*']}
          style={{ flex: 1, backgroundColor: color.readerPaper }}
          allowsLinkPreview={false}
          textInteractionEnabled={false}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          cacheEnabled={false}
          incognito
          onMessage={(e) => {
            const m = JSON.parse(e.nativeEvent.data);
            if (m.type === 'progress') setPages({ done: m.done, total: m.total });
            if (m.type === 'error') setError('Impossible d’afficher ce livre. Réessayez.');
          }}
          onShouldStartLoadWithRequest={(r) => r.url.startsWith('https://kalam.local') || r.url === 'about:blank'}
        />
      )}
    </View>
  );
}

/** Page HTML du lecteur : pdf.js charge le document en mémoire et dessine chaque page sur un canvas. */
function viewerHtml(url: string, bg: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4">
<style>html,body{margin:0;background:${bg};-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
canvas{display:block;width:100%;height:auto;margin:0 auto 10px;box-shadow:0 2px 10px rgba(0,0,0,.15);background:#fff}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script></head>
<body oncontextmenu="return false"><div id="pages"></div><script>
const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
(async () => {
  try {
    const data = await (await fetch(${JSON.stringify(url)})).arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const ratio = window.devicePixelRatio || 2, width = document.body.clientWidth;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / base.width) * ratio });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      document.getElementById('pages').appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      post({ type: 'progress', done: i, total: pdf.numPages });
    }
  } catch (e) { post({ type: 'error', message: String(e) }); }
})();
</script></body></html>`;
}
