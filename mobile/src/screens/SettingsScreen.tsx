import type { GusModelOption, GusNotificationCategory, UpsertGusPrefsRequest } from '@parkwalk/shared';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import {
  rescheduleAllGusNotifications,
  scheduleTestGusNotification,
} from '@/notifications/scheduler';
import { logout as revokeSession } from '@/services/authApi';
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
          ? 'Test notification will fire in about 15 seconds.'
          : scheduleReasonText(result.reason),
      );
    } catch (err) {
      Alert.alert('Could not schedule test', describeApiError(err));
    } finally {
      setTestCategory(null);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {isAuthenticated ? (
        <>
          <Text style={styles.header}>Gus</Text>
          <AppButton
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
          <AppButton
            title={savingReminders ? 'Saving reminders...' : 'Save Gus reminders'}
            onPress={() => void saveReminders()}
            disabled={savingReminders}
          />
          <View style={styles.testButtons}>
            <AppButton
              title={testCategory === 'morning_check_in' ? 'Scheduling...' : 'Test morning'}
              onPress={() => void testNotification('morning_check_in')}
              disabled={testCategory !== null}
              variant="soft"
            />
            <AppButton
              title={testCategory === 'walk_reminder' ? 'Scheduling...' : 'Test walk'}
              onPress={() => void testNotification('walk_reminder')}
              disabled={testCategory !== null}
              variant="soft"
            />
            <AppButton
              title={testCategory === 'post_walk_debrief' ? 'Scheduling...' : 'Test debrief'}
              onPress={() => void testNotification('post_walk_debrief')}
              disabled={testCategory !== null}
              variant="soft"
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
      <AppButton title="Use hosted API" onPress={() => void useUrl(apiUrl)} />

      <View style={{ height: 24 }} />
      <AppButton title="Save URL" onPress={() => void save()} variant="soft" />

      <View style={{ height: 32 }} />
      {isAuthenticated ? (
        <AppButton
          title={signingOut ? 'Signing out...' : 'Sign out'}
          onPress={() => void signOut()}
          disabled={signingOut}
          variant="danger"
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
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#E4D7C8', true: '#D9B48E' }}
        thumbColor={value ? '#BC8F65' : '#F7EFE5'}
      />
    </View>
  );
}

function AppButton({
  title,
  onPress,
  disabled,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'soft' | 'danger';
}): JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.appButton,
        variant === 'soft' && styles.appButtonSoft,
        variant === 'danger' && styles.appButtonDanger,
        (pressed || disabled) && styles.appButtonPressed,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.appButtonText,
          variant === 'soft' && styles.appButtonSoftText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
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
        placeholderTextColor="#9C9185"
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
  screen: { flex: 1, backgroundColor: '#F4ECE1' },
  container: { padding: 18, paddingBottom: 36, gap: 8 },
  header: {
    color: '#000',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    marginBottom: 4,
  },
  current: {
    color: '#5A5148',
    marginBottom: 12,
    lineHeight: 20,
  },
  sectionHeader: { marginTop: 22 },
  label: { fontSize: 12, lineHeight: 16, color: '#7B6A58', fontWeight: '800', textTransform: 'uppercase' },
  input: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#F7EFE5',
    color: '#000',
    fontSize: 15,
  },
  appButton: {
    minHeight: 50,
    borderRadius: 999,
    backgroundColor: '#BC8F65',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginTop: 6,
  },
  appButtonSoft: {
    backgroundColor: '#F0E4D4',
  },
  appButtonDanger: {
    backgroundColor: '#D9412E',
  },
  appButtonPressed: {
    opacity: 0.68,
  },
  appButtonText: {
    color: '#F7EFE5',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  appButtonSoftText: {
    color: '#6B3F24',
  },
  modelMeta: { marginTop: 8, color: '#5A5148', fontSize: 13, lineHeight: 18 },
  loadingRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 },
  loadingText: { color: '#5A5148', fontSize: 13 },
  modelField: { gap: 5, marginTop: 10 },
  dropdown: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F7EFE5',
  },
  dropdownDisabled: { opacity: 0.55 },
  dropdownValue: { flex: 1, color: '#000', fontSize: 14, fontWeight: '700' },
  dropdownChevron: { color: '#6B3F24', fontSize: 14, marginLeft: 8, fontWeight: '800' },
  modelHint: { color: '#7B6A58', fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 24,
  },
  modalPanel: {
    maxHeight: '70%',
    borderRadius: 21,
    backgroundColor: '#F7EFE5',
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 10, color: '#000' },
  modalList: { maxHeight: 420 },
  modelOption: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4D7C8',
  },
  modelOptionSelected: { backgroundColor: '#F0E4D4', borderRadius: 12 },
  modelOptionText: { color: '#000', fontSize: 14 },
  modelOptionTextSelected: { color: '#6B3F24', fontWeight: '800' },
  toggleRow: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#F7EFE5',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: { color: '#000', fontSize: 15, fontWeight: '800' },
  timeField: { flex: 1, gap: 4 },
  timeRow: { flexDirection: 'row', gap: 10 },
  testButtons: { gap: 8, marginTop: 8 },
});
