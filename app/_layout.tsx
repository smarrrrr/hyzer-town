import { Stack, SplashScreen } from 'expo-router';
import { useEffect, Component, type ReactNode } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <View style={eb.container}>
          <Text style={eb.title}>Something went wrong</Text>
          <ScrollView style={eb.scroll}>
            <Text style={eb.message}>{(error as Error).message}</Text>
            <Text style={eb.stack}>{(error as Error).stack}</Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

function RootNavigator() {
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ErrorBoundary>
  );
}

const eb = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f2419', padding: 24, paddingTop: 64 },
  title: { color: '#e05555', fontSize: 20, fontWeight: '700', marginBottom: 16 },
  scroll: { flex: 1 },
  message: { color: '#fff', fontSize: 15, marginBottom: 12 },
  stack: { color: '#8fb89a', fontSize: 11, fontFamily: 'monospace' },
});
