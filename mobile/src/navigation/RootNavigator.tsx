import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FigmaArrow } from '@/components/ui/FigmaArrow';
import { AccountCreatedScreen } from '@/screens/AccountCreatedScreen';
import { AllowMapScreen } from '@/screens/AllowMapScreen';
import { AllSetScreen } from '@/screens/AllSetScreen';
import { ChatScreen } from '@/screens/ChatScreen';
import { DogProfileSetupScreen } from '@/screens/DogProfileSetupScreen';
import { HiImGusScreen } from '@/screens/HiImGusScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { INeedWalksScreen } from '@/screens/INeedWalksScreen';
import { InExchangeScreen } from '@/screens/InExchangeScreen';
import { LoginScreen } from '@/screens/LoginScreen';
import { MapPreviewScreen } from '@/screens/MapPreviewScreen';
import { MapScreen } from '@/screens/MapScreen';
import { NudgeChatScreen } from '@/screens/NudgeChatScreen';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { RegisterScreen } from '@/screens/RegisterScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SetupScreen } from '@/screens/SetupScreen';
import { StatsScreen } from '@/screens/StatsScreen';
import { WalkDetailScreen } from '@/screens/WalkDetailScreen';
import { WalkHistoryScreen } from '@/screens/WalkHistoryScreen';
import { WallScreen } from '@/screens/WallScreen';
import { useAuthStore } from '@/stores/authStore';

export type RootStackParamList = {
  HiImGus: undefined;
  INeedWalks: undefined;
  InExchange: undefined;
  Setup: undefined;
  Onboarding: undefined;
  Login: undefined;
  Register: undefined;
  AccountCreated: undefined;
  AllowMap: undefined;
  MapPreview: undefined;
  NudgeChat: undefined;
  AllSet: undefined;
  Home: undefined;
  Map: undefined;
  Wall: undefined;
  Stats: undefined;
  WalkHistory: undefined;
  WalkDetail: { walkId: string; clientId: string };
  Chat: undefined;
  Settings: undefined;
  DogProfileSetup: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const designedHeaderBase = {
  title: '',
  headerStyle: { backgroundColor: '#F7EFE5' },
  headerShadowVisible: false,
  headerTintColor: '#6B3F24',
  headerBackVisible: false,
};

function designedHeaderOptions(title = '') {
  return ({
    navigation,
  }: {
    navigation: NativeStackNavigationProp<RootStackParamList>;
  }) => ({
    ...designedHeaderBase,
    title,
    headerLeft: () =>
      navigation.canGoBack() ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={({ pressed }) => [styles.headerBackButton, pressed && styles.headerBackButtonPressed]}
          onPress={() => navigation.goBack()}
        >
          <View style={styles.headerBackCircle}>
            <FigmaArrow direction="back" size={24} />
          </View>
        </Pressable>
      ) : null,
  });
}

export function RootNavigator(): JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const postRegisterOnboardingPending = useAuthStore((s) => s.postRegisterOnboardingPending);

  return (
    <Stack.Navigator screenOptions={{ headerShown: true }}>
      {!isAuthenticated ? (
        <>
          <Stack.Screen
            name="HiImGus"
            component={HiImGusScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="INeedWalks"
            component={INeedWalksScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="InExchange"
            component={InExchangeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Setup"
            component={SetupScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={{ headerShown: false }}
          />
          {/* Must be reachable before login — otherwise a bad persisted API URL cannot be fixed. */}
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'API / Server' }}
          />
        </>
      ) : (
        <>
          {postRegisterOnboardingPending ? (
            <>
              <Stack.Screen
                name="AccountCreated"
                component={AccountCreatedScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AllowMap"
                component={AllowMapScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="MapPreview"
                component={MapPreviewScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="NudgeChat"
                component={NudgeChatScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AllSet"
                component={AllSetScreen}
                options={{ headerShown: false }}
              />
            </>
          ) : null}
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Map"
            component={MapScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Wall"
            component={WallScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="Stats" component={StatsScreen} options={designedHeaderOptions()} />
          <Stack.Screen
            name="WalkHistory"
            component={WalkHistoryScreen}
            options={designedHeaderOptions()}
          />
          <Stack.Screen
            name="WalkDetail"
            component={WalkDetailScreen}
            options={designedHeaderOptions('Walk Detail')}
          />
          <Stack.Screen name="Chat" component={ChatScreen} options={{ headerShown: false }} />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={designedHeaderOptions()}
          />
          <Stack.Screen
            name="DogProfileSetup"
            component={DogProfileSetupScreen}
            options={designedHeaderOptions('Your dog')}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  headerBackButton: {
    marginLeft: 4,
  },
  headerBackButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  headerBackCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#C89566',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
