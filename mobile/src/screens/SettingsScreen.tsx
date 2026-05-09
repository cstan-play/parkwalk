import type { GusModelOption, GusNotificationCategory, UpsertGusPrefsRequest } from '@parkwalk/shared';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { logout as revokeSession } from '@/services/authApi';
import {
  rescheduleAllGusNotifications,
  scheduleTestGusNotification,
} from '@/notifications/scheduler';
import { useAuthStore } from '@/stores/authStore';
import { useGusStore } from '@/stores/gusStore';
import { normalizeApiBaseUrl, useSettingsStore } from '@/stores/settingsStore';
import { describeApiError } from '@/util/describeApiError';

export function SettingsScreen(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const settings = useSettingsStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const tokens = useAuthStore((s) => s.tokens);
  const clearSession = useAuthStore((s) => s.logout);
  const gusPrefs = useGusStore((s) => s.prefs);
  const gusModels = useGusStore((s) => s.models);
  const modelProvider = useGusStore((s) => s.modelProvider);
  const configuredChatModel = useGusStore((s) => s.configuredChatModel);
  const configuredNotificationModel = useGusStore((s) => s.configuredNotificationModel);
  const hydratingGus = useGusStore((s) => s.hydrating);
  const loadingModels = useGusStore((s) => s.loadingModels);
  const hydrateGus = useGusStore((s) => s.hydrate);
  const loadGusModels = useGusStore((s) => s.loadModels);
  const saveGusPrefs = useGusStore((s) => s.savePrefs);
  const [apiUrl, setApiUrl] = useState(settings.savedApiUrl);
  const [signingOut, setSigningOut] = useState(false);
  const [savingModel, setSavingModel] = useState<'chat' | 'notification' | null>(null);
  const [savingReminders, setSavingReminders] = useState(false);
  const [testCategory, setTestCategory] = useState<GusNotificationCategory | null>(null);
  const [reminderDraft, setReminderDraft] = useState({
    morningEnabled: true,
    morningCheckInTime: '07:30',
    walkEnabled: true,
    walkReminderTime: '09:00',
    postWalkEnabled: true,
    quietHoursStart: '21:00',
    quietHoursEnd: '07:00',
  });

  useEffect(() => {
    if (isAuthenticated) {
      void hydrateGus();
      void loadGusModels();
    }
  }, [hydrateGus, isAuthenticated, loadGusModels]);

  useEffect(() => {
    if (!gusPrefs) return;
    setReminderDraft({
      morningEnabled: gusPrefs.morningEnabled,
      morningCheckInTime: gusPrefs.morningCheckInTime,
      walkEnabled: gusPrefs.walkEnabled,
      walkReminderTime: gusPrefs.walkReminderTime,
      postWalkEnabled: gusPrefs.postWalkEnabled,
      quietHoursStart: gusPrefs.quietHoursStart,
      quietHoursEnd: gusPrefs.quietHoursEnd,
    });
  }, [gusPrefs]);

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

  async function chooseModel(kind: 'chat' | 'notification', modelId: string): Promise<void> {
    setSavingModel(kind);
    try {
      await saveGusPrefs(
        kind === 'chat' ? { chatModel: modelId } : { notificationModel: modelId },
      );
    } catch (err) {
      Alert.alert('Could not save model', describeApiError(err));
    } finally {
      setSavingModel(null);
    }
  }

  async function saveReminders(): Promise<void> {
    const patch: UpsertGusPrefsRequest = {
      morningEnabled: reminderDraft.morningEnabled,
      morningCheckInTime: reminderDraft.morningCheckInTime,
      walkEnabled: reminderDraft.walkEnabled,
      walkReminderTime: reminderDraft.walkReminderTime,
      postWalkEnabled: reminderDraft.postWalkEnabled,
      quietHoursStart: reminderDraft.quietHoursStart,
      quietHoursEnd: reminderDraft.quietHoursEnd,
    };
    const timeFields = [
      patch.morningCheckInTime,
      patch.walkReminderTime,
      patch.quietHoursStart,
      patch.quietHoursEnd,
    ];
    if (timeFields.some((t) => !isValidTime(t ?? ''))) {
      Alert.alert('Invalid time', 'Use HH:MM, for example 07:30.');
      return;
    }

    setSavingReminders(true);
    try {
      await saveGusPrefs(patch);
      const result = await rescheduleAllGusNotifications();
      Alert.alert(
        'Saved',
        result.scheduled
          ? 'Gus reminders rescheduled.'
          : `Reminder settings saved, but nothing was scheduled: ${scheduleReasonText(result.reason)}`,
      );
    } catch (err) {
      Alert.alert('Could not save reminders', describeApiError(err));
    } finally {
      setSavingReminders(false);
    }
  }

  async function testNotification(category: GusNotificationCategory): Promise<void> {
    setTestCategory(category);
    try {
      const result = await scheduleTestGusNotification(category);
      Alert.alert(
        result.scheduled ? 'Scheduled' : 'Not scheduled',
        result.scheduled
          ? 'Test notification will fire in about 30 seconds.'
          : scheduleReasonText(result.reason),
      );
    } catch (err) {
      Alert.alert('Could not schedule test', describeApiError(err));
    } finally {
      setTestCategory(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {isAuthenticated ? (
        <>
          <Text style={styles.header}>Gus</Text>
          <Button
            title="Set up your dog"
            onPress={() => navigation.navigate('DogProfileSetup')}
          />
          <Text style={styles.modelMeta}>
            Model provider: {modelProvider ?? 'not loaded'}
          </Text>
          {hydratingGus || loadingModels ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" />
              <Text style={styles.loadingText}>Loading Gus models...</Text>
            </View>
          ) : null}
          <ModelDropdown
            label="Chat model"
            value={gusPrefs?.chatModel ?? configuredChatModel ?? 'fallback'}
            options={gusModels}
            disabled={loadingModels || savingModel !== null}
            saving={savingModel === 'chat'}
            onSelect={(modelId) => void chooseModel('chat', modelId)}
          />
          <ModelDropdown
            label="Reminder model"
            value={gusPrefs?.notificationModel ?? configuredNotificationModel ?? 'fallback'}
            options={gusModels}
            disabled={loadingModels || savingModel !== null}
            saving={savingModel === 'notification'}
            onSelect={(modelId) => void chooseModel('notification', modelId)}
          />
          <Text style={[styles.header, styles.sectionHeader]}>Gus reminders</Text>
          <ReminderToggle
            label="Morning check-in"
            value={reminderDraft.morningEnabled}
            onValueChange={(morningEnabled) =>
              setReminderDraft((prev) => ({ ...prev, morningEnabled }))
            }
          />
          <TimeField
            label="Morning time"
            value={reminderDraft.morningCheckInTime}
            onChangeText={(morningCheckInTime) =>
              setReminderDraft((prev) => ({ ...prev, morningCheckInTime }))
            }
          />
          <ReminderToggle
            label="Walk reminder"
            value={reminderDraft.walkEnabled}
            onValueChange={(walkEnabled) => setReminderDraft((prev) => ({ ...prev, walkEnabled }))}
          />
          <TimeField
            label="Walk time"
            value={reminderDraft.walkReminderTime}
            onChangeText={(walkReminderTime) =>
              setReminderDraft((prev) => ({ ...prev, walkReminderTime }))
            }
          />
          <ReminderToggle
            label="Post-walk debrief"
            value={reminderDraft.postWalkEnabled}
            onValueChange={(postWalkEnabled) =>
              setReminderDraft((prev) => ({ ...prev, postWalkEnabled }))
            }
          />
          <View style={styles.timeRow}>
            <TimeField
              label="Quiet start"
              value={reminderDraft.quietHoursStart}
              onChangeText={(quietHoursStart) =>
                setReminderDraft((prev) => ({ ...prev, quietHoursStart }))
              }
            />
            <TimeField
              label="Quiet end"
              value={reminderDraft.quietHoursEnd}
              onChangeText={(quietHoursEnd) =>
                setReminderDraft((prev) => ({ ...prev, quietHoursEnd }))
              }
            />
          </View>
          <Button
            title={savingReminders ? 'Saving reminders...' : 'Save Gus reminders'}
            onPress={() => void saveReminders()}
            disabled={savingReminders}
          />
          <View style={styles.testButtons}>
            <Button
              title={testCategory === 'morning_check_in' ? 'Scheduling...' : 'Test morning'}
              onPress={() => void testNotification('morning_check_in')}
              disabled={testCategory !== null}
            />
            <Button
              title={testCategory === 'walk_reminder' ? 'Scheduling...' : 'Test walk'}
              onPress={() => void testNotification('walk_reminder')}
              disabled={testCategory !== null}
            />
            <Button
              title={testCategory === 'post_walk_debrief' ? 'Scheduling...' : 'Test debrief'}
              onPress={() => void testNotification('post_walk_debrief')}
              disabled={testCategory !== null}
            />
          </View>
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
    </ScrollView>
  );
}

function ReminderToggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function TimeField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}): JSX.Element {
  return (
    <View style={styles.timeField}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        placeholder="HH:MM"
      />
    </View>
  );
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function scheduleReasonText(reason: string): string {
  switch (reason) {
    case 'unavailable':
      return 'the native notification module is unavailable in this build.';
    case 'permission_denied':
      return 'notification permission is not granted.';
    case 'prefs_missing':
      return 'Gus preferences could not be loaded.';
    case 'disabled':
      return 'this reminder is disabled.';
    case 'quiet_hours':
      return 'the selected time is inside quiet hours.';
    default:
      return reason;
  }
}

function ModelDropdown({
  label,
  value,
  options,
  disabled,
  saving,
  onSelect,
}: {
  label: string;
  value: string;
  options: GusModelOption[];
  disabled: boolean;
  saving: boolean;
  onSelect: (modelId: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasOptions = options.length > 0;

  return (
    <View style={styles.modelField}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={disabled || !hasOptions}
        style={[styles.dropdown, (disabled || !hasOptions) && styles.dropdownDisabled]}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.dropdownValue}>{saving ? 'Saving...' : value}</Text>
        <Text style={styles.dropdownChevron}>v</Text>
      </Pressable>
      {!hasOptions ? <Text style={styles.modelHint}>No models returned by the backend.</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalPanel}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView style={styles.modalList}>
              {options.map((option) => {
                const selected = option.id === value;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    style={[styles.modelOption, selected && styles.modelOptionSelected]}
                    onPress={() => {
                      setOpen(false);
                      onSelect(option.id);
                    }}
                  >
                    <Text style={[styles.modelOptionText, selected && styles.modelOptionTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 6 },
  header: { fontSize: 18, fontWeight: '600' },
  current: { color: '#666', marginBottom: 12 },
  sectionHeader: { marginTop: 18 },
  label: { fontSize: 13, color: '#666' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modelMeta: { marginTop: 12, color: '#666', fontSize: 13 },
  loadingRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 },
  loadingText: { color: '#666', fontSize: 13 },
  modelField: { gap: 4, marginTop: 10 },
  dropdown: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'white',
  },
  dropdownDisabled: { opacity: 0.55 },
  dropdownValue: { flex: 1, color: '#111', fontSize: 14 },
  dropdownChevron: { color: '#666', fontSize: 14, marginLeft: 8 },
  modelHint: { color: '#999', fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 24,
  },
  modalPanel: {
    maxHeight: '70%',
    borderRadius: 8,
    backgroundColor: 'white',
    padding: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  modalList: { maxHeight: 420 },
  modelOption: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modelOptionSelected: { backgroundColor: '#ECFDF5' },
  modelOptionText: { color: '#111', fontSize: 14 },
  modelOptionTextSelected: { color: '#047857', fontWeight: '700' },
  toggleRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: { color: '#111', fontSize: 15, fontWeight: '600' },
  timeField: { flex: 1, gap: 4 },
  timeRow: { flexDirection: 'row', gap: 10 },
  testButtons: { gap: 8, marginTop: 8 },
});
