import React, { useState } from 'react';
import { Alert, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { register } from '@/services/authApi';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { describeApiError } from '@/util/describeApiError';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

export function RegisterScreen({ navigation }: Props): JSX.Element {
  const apiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(): Promise<void> {
    setBusy(true);
    try {
      const res = await register({ username, email, password });
      await setAuthenticated(res.user, res.tokens);
    } catch (err) {
      Alert.alert('Registration failed', describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.apiLine}>API: {apiBaseUrl}</Text>
      <Button title="Change API / server URL…" onPress={() => navigation.navigate('Settings')} />
      <View style={{ height: 16 }} />
      <Text style={styles.label}>Username</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />
      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Text style={styles.label}>Password (min 8 chars)</Text>
      <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
      <Button title={busy ? 'Creating…' : 'Create account'} onPress={onSubmit} disabled={busy} />
      <View style={{ height: 16 }} />
      <Button title="I already have an account" onPress={() => navigation.replace('Login')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  apiLine: { fontSize: 12, color: '#444' },
  label: { fontSize: 13, color: '#666' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
});
