import React from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { usePermissions, RESULTS } from '@/hooks/usePermissions';
import { useNotificationPermission } from '@/notifications/permissions';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

export function OnboardingScreen({ navigation }: Props): JSX.Element {
  const permissions = usePermissions();
  const notif = useNotificationPermission();

  const locationGranted =
    permissions.location === RESULTS.GRANTED || permissions.location === RESULTS.LIMITED;
  const notifGranted = notif.status === 'authorized' || notif.status === 'provisional';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to ParkWalk</Text>
      <Text style={styles.body}>
        ParkWalk needs your location and motion to record walks, trace your route,
        count steps, and confirm collecting happens during an active walk. Gus
        also needs to send the occasional notification — a reminder to walk,
        a check-in in the morning, a debrief after a walk.
      </Text>
      <View style={styles.actions}>
        {!locationGranted ? (
          <Button title="Grant location & motion" onPress={permissions.request} disabled={permissions.loading} />
        ) : null}
        {!notifGranted ? (
          <Button
            title="Allow Gus to send notifications"
            onPress={notif.request}
            disabled={notif.loading || notif.status === 'unavailable'}
          />
        ) : null}
        {locationGranted ? (
          <Button title="Sign in" onPress={() => navigation.navigate('Login')} />
        ) : null}
        <View style={styles.spacer} />
        <Button title="Create account" onPress={() => navigation.navigate('Register')} />
      </View>
      <Text style={styles.status}>
        Location: {permissions.location} • Motion: {permissions.motion} • Notifications: {notif.status}
      </Text>
      <View style={styles.spacer} />
      <Button
        title="API / server URL (if login fails)"
        onPress={() => navigation.navigate('Settings')}
        color="#555"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600', marginBottom: 16 },
  body: { fontSize: 16, lineHeight: 22, marginBottom: 24 },
  actions: { gap: 8 },
  spacer: { height: 12 },
  status: { marginTop: 24, color: '#666' },
});
