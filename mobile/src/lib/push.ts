import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { rpc } from './api';

// Notifications reçues app ouverte : affichées en bannière, avec son.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Enregistre le téléphone pour les notifications (Expo Push) une fois l'utilisateur connecté.
 * Nécessite l'identifiant du projet EAS (extra.eas.projectId) : sans lui, rien n'est fait.
 */
async function register() {
  if (!Device.isDevice) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Kalam', importance: Notifications.AndroidImportance.HIGH, lightColor: '#3B36E0' });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await rpc('register_push_token', { p_token: token, p_platform: Platform.OS === 'ios' ? 'ios' : 'android' });
}

/** À monter une fois : enregistrement à la connexion, et ouverture de l'écran visé quand on touche une notification. */
export function usePushNotifications(userId: string | null) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || done.current === userId) return;
    done.current = userId;
    register().catch(() => undefined);
  }, [userId]);

  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = last?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
  }, [last]);
}

/** À la déconnexion : ce téléphone ne reçoit plus les notifications du compte. */
export async function unregisterPush() {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId || !Device.isDevice) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await rpc('unregister_push_token', { p_token: token });
}
