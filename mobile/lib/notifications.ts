import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Runs once at import time: controls how a notification is presented while
// the app is in the foreground (it wouldn't show anything by default).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Requests permission and returns an Expo push token, or null if
 * unavailable — a simulator/emulator (push doesn't work there),
 * permission denied, or no EAS project configured (this repo doesn't have
 * one set up yet — app.json has no extra.eas.projectId, so
 * getExpoPushTokenAsync has nothing to call `eas init` would provide).
 * Never throws: a customer or courier should still be able to use the
 * rest of the app if push registration doesn't work.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device, not a simulator/emulator.');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('Push notification permission was not granted.');
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('No EAS projectId configured (app.json extra.eas.projectId) — cannot fetch an Expo push token.');
    return null;
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return token;
  } catch (err) {
    console.warn('Failed to get Expo push token:', err);
    return null;
  }
}
