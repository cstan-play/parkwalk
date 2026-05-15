import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fetchMyStats } from '@/services/statsApi';
import { fonts } from '@/theme';

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
        <Text style={styles.emptyText}>Could not load stats.</Text>
      </View>
    );
  }

  const s = stats.data;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Stats</Text>
      <Text style={styles.subtitle}>A quick read on Gus-approved progress.</Text>
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>All-time score</Text>
        <Text style={styles.heroValue}>{s.allTimeScore}</Text>
      </View>
      <View style={styles.grid}>
        <Row label="Daily score" value={s.dailyScore} />
        <Row label="Weekly score" value={s.weeklyScore} />
        <Row label="Total collections" value={s.totalCollections} />
        <Row label="Daily collections" value={s.dailyCollections} />
        <Row label="Streak" value={`${s.currentStreakDays} days`} />
      </View>
    </ScrollView>
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
  screen: { flex: 1, backgroundColor: '#F4ECE1' },
  container: { padding: 18, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4ECE1' },
  emptyText: { color: '#5A5148', fontSize: 16, fontWeight: '700' },
  title: { color: '#000', fontSize: 34, lineHeight: 40, fontFamily: fonts.serif },
  subtitle: { marginTop: 6, marginBottom: 18, color: '#5A5148', fontSize: 16, lineHeight: 22 },
  heroCard: {
    minHeight: 132,
    borderRadius: 21,
    backgroundColor: '#BC8F65',
    padding: 20,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 6,
  },
  heroLabel: {
    color: '#F7EFE5',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  heroValue: { marginTop: 8, color: '#F7EFE5', fontSize: 44, lineHeight: 50, fontWeight: '800' },
  grid: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  row: {
    width: '48%',
    minHeight: 92,
    borderRadius: 19,
    backgroundColor: '#F7EFE5',
    padding: 14,
    justifyContent: 'space-between',
  },
  label: { color: '#7B6A58', fontSize: 12, lineHeight: 16, fontWeight: '800', textTransform: 'uppercase' },
  value: { color: '#000', fontWeight: '800', fontSize: 22, lineHeight: 28 },
});
