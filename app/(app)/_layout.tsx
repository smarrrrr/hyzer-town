import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import ImportModal from '@/components/ImportModal';

let getPendingCSV: (() => string | null) | null = null;
let clearPendingCSV: (() => void) | null = null;

if (Platform.OS === 'ios') {
  try {
    const mod = require('shared-storage');
    getPendingCSV = mod.getPendingCSV;
    clearPendingCSV = mod.clearPendingCSV;
  } catch {}
}

function checkAndConsumePendingCSV(): string | null {
  if (!getPendingCSV || !clearPendingCSV) return null;
  const csv = getPendingCSV();
  if (csv) clearPendingCSV();
  return csv ?? null;
}

export default function AppLayout() {
  const [pendingCSV, setPendingCSV] = useState<string | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const appState = useRef(AppState.currentState);

  // Check on mount (app was opened via share, then cold-started)
  useEffect(() => {
    const csv = checkAndConsumePendingCSV();
    if (csv) { setPendingCSV(csv); setImportVisible(true); }
  }, []);

  // Check when app returns to foreground (app was already open)
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        const csv = checkAndConsumePendingCSV();
        if (csv) { setPendingCSV(csv); setImportVisible(true); }
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  return (
    <>
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
      <ImportModal
        visible={importVisible}
        initialCSV={pendingCSV}
        onClose={() => { setImportVisible(false); setPendingCSV(null); }}
      />
    </>
  );
}
