import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import ImportModal from '@/components/ImportModal';

let FileSystem: typeof import('expo-file-system') | null = null;
if (Platform.OS === 'ios') {
  try { FileSystem = require('expo-file-system'); } catch {}
}

const PENDING_FILENAME = 'pending_import.csv';

async function checkAndConsumePendingCSV(): Promise<string | null> {
  if (!FileSystem?.documentDirectory) return null;
  const uri = FileSystem.documentDirectory + PENDING_FILENAME;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const csv = await FileSystem.readAsStringAsync(uri);
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return csv || null;
  } catch {
    return null;
  }
}

export default function AppLayout() {
  const [pendingCSV, setPendingCSV] = useState<string | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const appState = useRef(AppState.currentState);

  const runCheck = async () => {
    const csv = await checkAndConsumePendingCSV();
    if (csv) { setPendingCSV(csv); setImportVisible(true); }
  };

  // Check on mount
  useEffect(() => { runCheck(); }, []);

  // Check when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        runCheck();
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
