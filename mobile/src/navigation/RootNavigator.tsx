import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { LoginScreen } from '@/screens/LoginScreen';
import { MapScreen } from '@/screens/MapScreen';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { RegisterScreen } from '@/screens/RegisterScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { StatsScreen } from '@/screens/StatsScreen';
import { useAuthStore } from '@/stores/authStore';

export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  Register: undefined;
  Map: undefined;
  Stats: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <Stack.Navigator screenOptions={{ headerShown: true }}>
      {!isAuthenticated ? (
        <>
          <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
          <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Create account' }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Map" component={MapScreen} options={{ title: 'ParkWalk' }} />
          <Stack.Screen name="Stats" component={StatsScreen} options={{ title: 'Stats' }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        </>
      )}
    </Stack.Navigator>
  );
}
