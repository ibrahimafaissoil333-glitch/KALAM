import { HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold, HankenGrotesk_700Bold } from '@expo-google-fonts/hanken-grotesk';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from '@/lib/store';
import { ToastProvider } from '@/ui/components';
import { color } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Root() {
  const { ready } = useStore();
  const [fonts] = useFonts({ InstrumentSerif_400Regular, HankenGrotesk_400Regular, HankenGrotesk_500Medium, HankenGrotesk_600SemiBold, HankenGrotesk_700Bold });
  const show = ready && fonts;
  useEffect(() => {
    if (show) SplashScreen.hideAsync().catch(() => undefined);
  }, [show]);
  if (!show) return null;
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper }, animation: 'slide_from_right' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="reader/[id]" options={{ animation: 'fade', contentStyle: { backgroundColor: color.readerPaper } }} />
        <Stack.Screen name="checkout/result" options={{ gestureEnabled: false, animation: 'fade' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <ToastProvider>
          <Root />
        </ToastProvider>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
