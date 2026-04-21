import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fetchMyStats } from '@/services/statsApi';

export function StatsScreen(): JSX.Element {
  const stats = useQuery({ queryKey: ['myStats'], queryFn: fetchMyStats, refetchInterval: 30_000 });

  if (stats.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (stats.isError || !stats.data) {
    return (
      <View style={styles.center}>
        <Text>Could not load stats.</Text>
      </View>
    );
  }

  const s = stats.data;
  return (
    <View style={styles.container}>
      <Row label="All-time score" value={s.allTimeScore} />
      <Row label="Daily score" value={s.dailyScore} />
      <Row label="Weekly score" value={s.weeklyScore} />
      <Row label="Total collections" value={s.totalCollections} />
      <Row label="Daily collections" value={s.dailyCollections} />
      <Row label="Streak (days)" value={s.currentStreakDays} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
  label: { color: '#666', fontSize: 15 },
  value: { fontWeight: '600', fontSize: 15 },
});
