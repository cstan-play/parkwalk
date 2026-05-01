import type { WalkSession } from '@parkwalk/shared';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { fetchWalks } from '@/services/walksApi';
import {
  getMovingDurationSeconds,
  useWalkSessionStore,
  type LocalWalkSession,
} from '@/stores/walkSessionStore';

type Nav = NativeStackNavigationProp<RootStackParamList, 'WalkHistory'>;

interface WalkRow {
  id: string;
  clientId: string;
  startedAt: string;
  distanceMeters: number;
  stepCount: number;
  movingDurationSeconds: number;
  syncState?: string;
  syncError?: string;
}

export function WalkHistoryScreen(): JSX.Element {
  const navigation = useNavigation<Nav>();
  const local = useWalkSessionStore((s) => s.completedSessions);
  const walks = useQuery({ queryKey: ['walks'], queryFn: fetchWalks, refetchInterval: 30_000 });

  const rows = useMemo(() => mergeWalks(local, walks.data ?? []), [local, walks.data]);

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={rows.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Recorded walks will appear here after your first walk.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => navigation.navigate('WalkDetail', { walkId: item.id, clientId: item.clientId })}
          >
            <View>
              <Text style={styles.rowTitle}>{formatDate(item.startedAt)}</Text>
              <Text style={styles.rowMeta}>
                {formatDistance(item.distanceMeters)} · {formatDuration(item.movingDurationSeconds)} ·{' '}
                {item.stepCount} steps
              </Text>
            </View>
            <View style={styles.syncColumn}>
              <Text style={styles.syncState}>{item.syncState ?? 'synced'}</Text>
              {item.syncError ? <Text style={styles.syncError}>{item.syncError}</Text> : null}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

function mergeWalks(
  local: LocalWalkSession[],
  remote: Omit<WalkSession, 'pathSegments'>[],
): WalkRow[] {
  const byClientId = new Map<string, WalkRow>();
  for (const item of remote) {
    byClientId.set(item.clientId, { ...item, syncState: 'synced' });
  }
  for (const item of local) {
    if (byClientId.has(item.clientId)) continue;
    const endedAt = item.endedAt ?? item.startedAt;
    byClientId.set(item.clientId, {
      id: item.serverId ?? item.clientId,
      clientId: item.clientId,
      startedAt: item.startedAt,
      distanceMeters: item.distanceMeters,
      stepCount: item.stepCount,
      movingDurationSeconds: getMovingDurationSeconds(item, endedAt),
      syncState: item.syncState,
      syncError: item.syncError,
    });
  }
  return [...byClientId.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  list: { padding: 12 },
  emptyList: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  emptyText: { color: '#6B7280', textAlign: 'center', fontSize: 16 },
  row: {
    minHeight: 74,
    borderRadius: 8,
    backgroundColor: 'white',
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  rowPressed: { opacity: 0.72 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  rowMeta: { marginTop: 4, color: '#4B5563' },
  syncColumn: {
    alignItems: 'flex-end',
    flexShrink: 1,
    marginLeft: 12,
  },
  syncState: { color: '#6B7280', fontSize: 12 },
  syncError: {
    marginTop: 4,
    color: '#B91C1C',
    fontSize: 11,
    maxWidth: 150,
    textAlign: 'right',
  },
});
