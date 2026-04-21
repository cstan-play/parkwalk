import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import Config from 'react-native-config';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/services/queryClient';
import { RootNavigator } from '@/navigation/RootNavigator';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';

export default function App(): JSX.Element {
  const hydrate = useAuthStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = Config.MAPBOX_ACCESS_TOKEN ?? '';
    if (token) {
      MapboxGL.setAccessToken(token);
    }
    Promise.all([hydrate(), hydrateSettings()]).finally(() => setReady(true));
  }, [hydrate, hydrateSettings]);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
