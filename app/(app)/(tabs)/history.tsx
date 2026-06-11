import { View, Text, StyleSheet } from 'react-native';

export default function HistoryScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.emptyState}>
        <Text style={styles.icon}>📋</Text>
        <Text style={styles.title}>No rounds yet</Text>
        <Text style={styles.subtitle}>Your completed rounds will appear here.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f2419',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  icon: {
    fontSize: 64,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#8fb89a',
    textAlign: 'center',
  },
});
