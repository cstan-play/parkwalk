import React, { useState } from 'react';
import { Alert, Button, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';

export function SettingsScreen(): JSX.Element {
  const settings = useSettingsStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);
  const [lan, setLan] = useState(settings.savedLanUrl);
  const [ngrok, setNgrok] = useState(settings.savedNgrokUrl);
  const [prod, setProd] = useState(settings.savedProdUrl);

  async function save(): Promise<void> {
    await settings.setSavedUrl('savedLanUrl', lan);
    await settings.setSavedUrl('savedNgrokUrl', ngrok);
    await settings.setSavedUrl('savedProdUrl', prod);
    Alert.alert('Saved', 'URLs stored locally.');
  }

  async function useUrl(url: string): Promise<void> {
    if (!url) return;
    await settings.setApiBaseUrl(url);
    Alert.alert('API base set', url);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>API base URL</Text>
      <Text style={styles.current}>Current: {settings.apiBaseUrl}</Text>

      <Text style={styles.label}>LAN (your Mac)</Text>
      <TextInput style={styles.input} value={lan} onChangeText={setLan} autoCapitalize="none" />
      <Button title="Use LAN" onPress={() => useUrl(lan)} />

      <View style={{ height: 16 }} />
      <Text style={styles.label}>ngrok (tunneled)</Text>
      <TextInput style={styles.input} value={ngrok} onChangeText={setNgrok} autoCapitalize="none" />
      <Button title="Use ngrok" onPress={() => useUrl(ngrok)} />

      <View style={{ height: 16 }} />
      <Text style={styles.label}>Production (Phase 2 Fly.io)</Text>
      <TextInput style={styles.input} value={prod} onChangeText={setProd} autoCapitalize="none" />
      <Button title="Use production" onPress={() => useUrl(prod)} />

      <View style={{ height: 24 }} />
      <Button title="Save URLs" onPress={save} />

      <View style={{ height: 32 }} />
      {isAuthenticated ? (
        <Button title="Sign out" color="#c00" onPress={() => logout()} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 6 },
  header: { fontSize: 18, fontWeight: '600' },
  current: { color: '#666', marginBottom: 12 },
  label: { fontSize: 13, color: '#666' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
