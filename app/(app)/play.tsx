import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function PlayScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.emptyState}>
        <Text style={styles.icon}>🥏</Text>
        <Text style={styles.title}>Ready to play?</Text>
        <Text style={styles.subtitle}>Select a course and start tracking your round hole by hole.</Text>

        <TouchableOpacity style={styles.button}>
          <Text style={styles.buttonText}>Start New Round</Text>
        </TouchableOpacity>
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
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#8fb89a',
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    backgroundColor: '#3db56b',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
