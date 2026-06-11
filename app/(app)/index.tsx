import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '@/lib/auth';

export default function HomeScreen() {
  const { user } = useAuth();
  const displayName = user?.displayName ?? user?.email?.split('@')[0] ?? 'Disc Golfer';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>Hey, {displayName} 👋</Text>

      <View style={styles.statsRow}>
        <StatCard label="Rounds" value="0" />
        <StatCard label="Avg Score" value="—" />
        <StatCard label="Best Round" value="—" />
      </View>

      <Text style={styles.sectionTitle}>Recent Rounds</Text>
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>⛳</Text>
        <Text style={styles.emptyText}>No rounds yet</Text>
        <Text style={styles.emptySubtext}>Hit Play to start tracking your game</Text>
      </View>
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f2419',
  },
  content: {
    padding: 20,
    gap: 20,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1e3a2a',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d5a3d',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#3db56b',
  },
  statLabel: {
    fontSize: 11,
    color: '#8fb89a',
    marginTop: 2,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8fb89a',
  },
});
