import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0f2419' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700', color: '#fff' },
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="round/[id]" options={{ headerShown: true }} />
    </Stack>
  );
}
