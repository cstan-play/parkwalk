import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Button, StyleSheet, View } from 'react-native';

import { ChatScreen } from '@/screens/ChatScreen';
import { DogProfileSetupScreen } from '@/screens/DogProfileSetupScreen';
import { LoginScreen } from '@/screens/LoginScreen';
import { MapScreen } from '@/screens/MapScreen';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { RegisterScreen } from '@/screens/RegisterScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { StatsScreen } from '@/screens/StatsScreen';
import { WalkDetailScreen } from '@/screens/WalkDetailScreen';
import { WalkHistoryScreen } from '@/screens/WalkHistoryScreen';
import { useAuthStore } from '@/stores/authStore';

export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  Register: undefined;
  Map: undefined;
  Stats: undefined;
  WalkHistory: undefined;
  WalkDetail: { walkId: string; clientId: string };
  Chat: undefined;
  Settings: undefined;
  DogProfileSetup: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <Stack.Navigator screenOptions={{ headerShown: true }}>
      {!isAuthenticated ? (
        <>
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={{ title: 'Create account' }}
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
          <Stack.Screen
            name="Map"
            component={MapScreen}
            options={({ navigation }) => ({
              title: 'ParkWalk',
              headerRight: () => (
                <View style={styles.headerActions}>
                  <Button title="Stats" onPress={() => navigation.navigate('Stats')} />
                  <Button title="Walks" onPress={() => navigation.navigate('WalkHistory')} />
                  <Button title="Settings" onPress={() => navigation.navigate('Settings')} />
                </View>
              ),
            })}
          />
          <Stack.Screen name="Stats" component={StatsScreen} options={{ title: 'Stats' }} />
          <Stack.Screen
            name="WalkHistory"
            component={WalkHistoryScreen}
            options={{ title: 'Walks' }}
          />
          <Stack.Screen
            name="WalkDetail"
            component={WalkDetailScreen}
            options={{ title: 'Walk Detail' }}
          />
          <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Gus' }} />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Settings' }}
          />
          <Stack.Screen
            name="DogProfileSetup"
            component={DogProfileSetupScreen}
            options={{ title: 'Your dog' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    gap: 4,
  },
});
