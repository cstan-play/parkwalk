/**
 * Onboarding screen 5 — "Tell Gus who you are."
 *
 * Matches Figma node 20:573 ("5. Create acc"). The visual layout has been
 * brought in line with the design system; all original functionality is
 * preserved:
 *   - username / email / password form state
 *   - register() API call on Continue with loading state and error alert
 *   - "I already have an account" link → navigates to Login
 *   - "Change API / server URL" link → navigates to Settings
 * Sign-up-with-Google / Sign-up-with-Apple are visual-only as the
 * disclaimer states they are not implemented in this prototype.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FigmaArrow } from '@/components/ui/FigmaArrow';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { register } from '@/services/authApi';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { colors, radii, spacing, textStyles } from '@/theme';
import { describeApiError } from '@/util/describeApiError';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

const FIELD_BG = '#e6e0d5';
const FIELD_PLACEHOLDER = '#888275';
const FIELD_BORDER = '#5a1c01';
const BACK_SIZE = 56;
const BUTTON_HEIGHT = 74;
const SPEECH_BUBBLE_BG = '#f0e4d4';

export function RegisterScreen({ navigation }: Props): JSX.Element {
  const insets = useSafeAreaInsets();
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
      await setAuthenticated(res.user, res.tokens, { postRegisterOnboardingPending: true });
    } catch (err) {
      Alert.alert('Registration failed', describeApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.kav}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header row */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.backShadow, pressed && styles.backShadowPressed]}
          >
            {({ pressed }) => (
              <View style={[styles.back, pressed && styles.backPressed]}>
                <FigmaArrow direction="back" size={28} color={colors.button.text} />
              </View>
            )}
          </Pressable>
          <Text style={textStyles.appName} numberOfLines={1}>
            My PetDog
          </Text>
          <View style={{ width: BACK_SIZE }} />
        </View>

        {/* Headline */}
        <Text style={[textStyles.serifHeadline, styles.headline]}>Tell Gus who you are.</Text>

        {/* Speech bubble with Gus avatar */}
        <View style={styles.bubbleRow}>
          <Image
            source={require('../assets/onboarding/gus-avatar.png')}
            style={styles.avatar}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>Three things, then I’m back.</Text>
          </View>
        </View>

        {/* Form fields */}
        <View style={styles.fields}>
          <TextInput
            style={styles.input}
            placeholder="Name (or whatever you want Gus to call you)"
            placeholderTextColor={FIELD_PLACEHOLDER}
            autoCapitalize="none"
            value={username}
            onChangeText={setUsername}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={FIELD_PLACEHOLDER}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={FIELD_PLACEHOLDER}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </View>

        {/* Continue button */}
        <View style={styles.continueWrapper}>
          <Pressable
            onPress={onSubmit}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            style={({ pressed }) => [
              styles.continueShadow,
              pressed && styles.continueShadowPressed,
              busy && styles.continueShadowDisabled,
            ]}
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.continue,
                  pressed && styles.continuePressed,
                  busy && styles.continueDisabled,
                ]}
              >
                <Text style={[textStyles.buttonLabel, styles.continueText]}>
                  {busy ? 'Creating…' : 'Continue'}
                </Text>
                {!busy ? (
                  <FigmaArrow size={29} color={colors.button.text} style={styles.continueArrowIcon} />
                ) : null}
              </View>
            )}
          </Pressable>
        </View>

        {/* OR divider */}
        <Text style={styles.orText}>or</Text>

        {/* Disabled social sign-up buttons (visual only — see disclaimer) */}
        <View style={styles.socialButton}>
          <Text style={styles.socialButtonText}>Sign up with Google*</Text>
        </View>
        <View style={styles.socialButton}>
          <Text style={styles.socialButtonText}>Sign up with Apple*</Text>
        </View>

        <Text style={styles.disclaimer}>
          *For this prototype you cannot sign in with Google/Apple.
        </Text>

        {/* Functional links preserved from the previous design */}
        <View style={styles.footerLinks}>
          <Pressable
            onPress={() => navigation.replace('Login')}
            accessibilityRole="link"
            accessibilityLabel="I already have an account"
          >
            <Text style={styles.footerLink}>I already have an account →</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="link"
            accessibilityLabel="Change API / server URL"
          >
            <Text style={styles.footerLinkSubtle}>API · {apiBaseUrl}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  kav: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backShadow: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: BACK_SIZE / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  backShadowPressed: {
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
  },
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: BACK_SIZE / 2,
    backgroundColor: colors.button.solid,
    borderWidth: 2,
    borderColor: colors.button.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: {
    backgroundColor: colors.button.solidPressed,
    transform: [{ scale: 0.95 }],
  },
  backGlyph: {
    color: colors.button.text,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 28,
    marginTop: -2,
  },
  headline: {
    textAlign: 'left',
    marginTop: spacing.md,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  avatar: {
    width: 67,
    height: 67,
    borderRadius: 67 / 2,
    borderWidth: 2.5,
    borderColor: colors.button.solid,
    marginRight: spacing.md,
  },
  bubble: {
    flex: 1,
    backgroundColor: SPEECH_BUBBLE_BG,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    fontWeight: '500',
  },
  fields: {
    marginTop: spacing.xl,
  },
  input: {
    backgroundColor: FIELD_BG,
    borderRadius: 17,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    marginBottom: spacing.md,
  },
  continueWrapper: {
    marginTop: spacing.lg,
    alignItems: 'stretch',
  },
  continueShadow: {
    borderRadius: radii.button,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  continueShadowPressed: {
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  continueShadowDisabled: {
    shadowOpacity: 0.08,
  },
  continue: {
    height: BUTTON_HEIGHT,
    borderRadius: radii.button,
    borderWidth: 2,
    borderColor: colors.button.border,
    backgroundColor: colors.button.solid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  continuePressed: {
    backgroundColor: colors.button.solidPressed,
    transform: [{ scale: 0.98 }],
  },
  continueDisabled: {
    opacity: 0.65,
  },
  continueText: {
    color: colors.button.text,
  },
  continueArrow: {
    color: colors.button.text,
    marginLeft: spacing.md,
  },
  continueArrowIcon: {
    marginLeft: spacing.md,
  },
  orText: {
    textAlign: 'center',
    marginTop: spacing.base,
    marginBottom: spacing.sm,
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  socialButton: {
    borderColor: FIELD_BORDER,
    borderWidth: 1.2,
    borderRadius: 16,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
    opacity: 0.7, // disabled appearance per the disclaimer
  },
  socialButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#201f1f',
  },
  disclaimer: {
    fontSize: 12,
    color: '#201f1f',
    fontWeight: '500',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    textAlign: 'center',
  },
  footerLinks: {
    marginTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  footerLink: {
    fontSize: 14,
    color: FIELD_BORDER,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  footerLinkSubtle: {
    fontSize: 12,
    color: '#888275',
    fontWeight: '500',
  },
});
