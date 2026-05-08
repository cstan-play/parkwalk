import React, { useState } from 'react';
import { Alert, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { logout as revokeSession } from '@/services/authApi';
import { useAuthStore } from '@/stores/authStore';
import { normalizeApiBaseUrl, useSettingsStore } from '@/stores/settingsStore';
import { describeApiError } from '@/util/describeApiError';

export function SettingsScreen(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const settings = useSettingsStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const tokens = useAuthStore((s) => s.tokens);
  const clearSession = useAuthStore((s) => s.logout);
  const [apiUrl, setApiUrl] = useState(settings.savedApiUrl);
  const [signingOut, setSigningOut] = useState(false);

  async function save(): Promise<void> {
    try {
      await settings.setSavedApiUrl(apiUrl);
      Alert.alert('Saved', 'Hosted API URL stored locally.');
    } catch (err) {
      Alert.alert('Invalid URL', err instanceof Error ? err.message : 'Use a valid HTTPS URL.');
    }
  }

  async function useUrl(url: string): Promise<void> {
    try {
      const normalized = normalizeApiBaseUrl(url);
      await settings.setApiBaseUrl(normalized);
      await settings.setSavedApiUrl(normalized);
      setApiUrl(normalized);
      Alert.alert('API base set', normalized);
    } catch (err) {
      Alert.alert('Invalid URL', err instanceof Error ? err.message : 'Use a valid HTTPS URL.');
    }
  }

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      if (tokens?.refreshToken) {
        await revokeSession(tokens.refreshToken);
      }
    } catch (err) {
      Alert.alert('Signed out locally', `Could not revoke the server session: ${describeApiError(err)}`);
    } finally {
      await clearSession();
      setSigningOut(false);
    }
  }

  return (
    <View style={styles.container}>
      {isAuthenticated ? (
        <>
          <Text style={styles.header}>Gus</Text>
          <Button
            title="Set up your dog"
            onPress={() => navigation.navigate('DogProfileSetup')}
          />
          <View style={{ height: 24 }} />
        </>
      ) : null}

      <Text style={styles.header}>API base URL</Text>
      <Text style={styles.current}>Current: {settings.apiBaseUrl}</Text>

      <Text style={styles.label}>Hosted API URL</Text>
      <TextInput
        style={styles.input}
        value={apiUrl}
        onChangeText={setApiUrl}
        autoCapitalize="none"
        keyboardType="url"
      />
      <Button title="Use hosted API" onPress={() => useUrl(apiUrl)} />

      <View style={{ height: 24 }} />
      <Button title="Save URL" onPress={save} />

      <View style={{ height: 32 }} />
      {isAuthenticated ? (
        <Button
          title={signingOut ? 'Signing out...' : 'Sign out'}
          color="#c00"
          onPress={signOut}
          disabled={signingOut}
        />
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
