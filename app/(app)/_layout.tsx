import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform } from 'react-native';
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

  const runCheck = async () => {
    let debugMsg = 'docDir: ' + (FileSystem.documentDirectory ?? 'null') + '\n';
    try {
      const debugUri = (FileSystem.documentDirectory ?? '') + 'share_debug.json';
      const info = await FileSystem.getInfoAsync(debugUri);
      if (info.exists) {
        debugMsg += await FileSystem.readAsStringAsync(debugUri);
      } else {
        debugMsg += 'share_debug.json not found — AppDelegate never ran';
      }
    } catch (e: any) {
      debugMsg += 'error: ' + (e?.message ?? String(e));
    }
    Alert.alert('Native debug', debugMsg);

    const csv = await checkAndConsumePendingCSV();
    Alert.alert('JS check', csv ? `CSV: ${csv.length} chars` : 'No CSV in documents');
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
