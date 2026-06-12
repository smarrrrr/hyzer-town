import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import ImportModal from '@/components/ImportModal';
import { RoundsRefreshProvider, useRoundsRefresh } from '@/lib/rounds-refresh';

import * as FileSystem from 'expo-file-system/legacy';

const PENDING_FILENAME = 'pending_import.csv';

async function checkAndConsumePendingCSV(): Promise<string | null> {
  if (!FileSystem.documentDirectory) return null;
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

function AppLayoutInner() {
  const { triggerRefresh } = useRoundsRefresh();
  const [pendingCSV, setPendingCSV] = useState<string | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const appState = useRef(AppState.currentState);
  const importVisibleRef = useRef(false);

  const runCheck = async () => {
    if (importVisibleRef.current) return;
    const csv = await checkAndConsumePendingCSV();
    if (csv) {
      setPendingCSV(csv);
      setImportVisible(true);
      importVisibleRef.current = true;
    }
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
        onClose={() => {
          setImportVisible(false);
          setPendingCSV(null);
          importVisibleRef.current = false;
        }}
        onImportComplete={triggerRefresh}
      />
    </>
  );
}

export default function AppLayout() {
  return (
    <RoundsRefreshProvider>
      <AppLayoutInner />
    </RoundsRefreshProvider>
  );
}
