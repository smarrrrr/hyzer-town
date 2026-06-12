import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
// Loaded lazily — these native modules are not available in Expo Go
let DocumentPicker: typeof import('expo-document-picker') | null = null;
let FileSystem: typeof import('expo-file-system') | null = null;
try { DocumentPicker = require('expo-document-picker'); } catch {}
try { FileSystem = require('expo-file-system'); } catch {}
import { useAuth } from '@/lib/auth';
import { parseUDiscCSV } from '@/lib/csv';
import { getRoundById, importRound } from '@/lib/rounds';
import type { Round } from '@/lib/types';

type RoundStatus = 'pending' | 'already-imported' | 'importing' | 'done' | 'error';

interface RoundItem {
  round: Round;
  status: RoundStatus;
  action: 'import' | 'skip';
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Pre-loaded CSV string from the iOS Share Extension — skips the file picker step */
  initialCSV?: string | null;
}

type Step = 'pick' | 'review' | 'importing' | 'done';

export default function ImportModal({ visible, onClose, initialCSV }: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('pick');
  const [items, setItems] = useState<RoundItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // When opened with a pre-loaded CSV (from the Share Extension), skip the file picker
  useEffect(() => {
    if (!visible || !initialCSV || !user) return;
    let cancelled = false;
    const load = async () => {
      const rounds = parseUDiscCSV(initialCSV);
      if (!rounds.length) { setError('No rounds found in the shared CSV.'); return; }
      const resolved = await Promise.all(
        rounds.map(async (round): Promise<RoundItem> => {
          const existing = await getRoundById(round.id);
          const alreadyImported = existing?.importedBy?.includes(user.uid) ?? false;
          return { round, status: alreadyImported ? 'already-imported' : 'pending', action: alreadyImported ? 'skip' : 'import' };
        })
      );
      if (cancelled) return;
      setItems(resolved);
      setStep('review');
    };
    load().catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to parse CSV'); });
    return () => { cancelled = true; };
  }, [visible, initialCSV, user]);

  const reset = () => {
    setStep('pick');
    setItems([]);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const readCSV = async (): Promise<string | null> => {
    if (!DocumentPicker) throw new Error('native-unavailable');

    const result = await DocumentPicker.getDocumentAsync({
      type: Platform.OS === 'web' ? 'text/csv' : '*/*',
      copyToCacheDirectory: true,
    });

    if (result.canceled) return null;
    const file = result.assets[0];

    if (Platform.OS === 'web') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file.file as File);
      });
    } else {
      if (!FileSystem) throw new Error('native-unavailable');
      return FileSystem.readAsStringAsync(file.uri);
    }
  };

  const handlePickFile = useCallback(async () => {
    setError(null);
    try {
      const csv = await readCSV();
      if (!csv) return;

      const rounds = parseUDiscCSV(csv);
      if (!rounds.length) {
        setError('No rounds found in this CSV.');
        return;
      }

      // Check which rounds are already imported by this user
      const resolved = await Promise.all(
        rounds.map(async (round): Promise<RoundItem> => {
          const existing = await getRoundById(round.id);
          const alreadyImported = existing?.importedBy?.includes(user!.uid) ?? false;
          return {
            round,
            status: alreadyImported ? 'already-imported' : 'pending',
            action: alreadyImported ? 'skip' : 'import',
          };
        })
      );

      setItems(resolved);
      setStep('review');
    } catch (e: any) {
      if (e?.message === 'native-unavailable') {
        setError('File import is not available in Expo Go. Use the web app at hyzer-town.web.app to import your rounds.');
      } else {
        setError(e?.message ?? 'Failed to parse CSV');
      }
    }
  }, [user]);

  const toggleAction = (index: number) => {
    setItems(prev =>
      prev.map((item, i) =>
        i === index
          ? { ...item, action: item.action === 'import' ? 'skip' : 'import' }
          : item
      )
    );
  };

  const handleImport = async () => {
    setStep('importing');
    const toImport = items.filter(i => i.action === 'import');

    const updated = [...items];

    for (let i = 0; i < updated.length; i++) {
      if (updated[i].action !== 'import') continue;
      updated[i] = { ...updated[i], status: 'importing' };
      setItems([...updated]);

      try {
        await importRound(updated[i].round, user!.uid);
        updated[i] = { ...updated[i], status: 'done' };
      } catch {
        updated[i] = { ...updated[i], status: 'error' };
      }
      setItems([...updated]);
    }

    setStep('done');
  };

  const importCount = items.filter(i => i.action === 'import').length;
  const finishedCount = items.filter(i => i.status === 'done' || i.status === 'error').length;
  const doneCount = items.filter(i => i.status === 'done').length;
  const errorCount = items.filter(i => i.status === 'error').length;
  const progressFraction = importCount > 0 ? finishedCount / importCount : 0;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      <View style={styles.backdrop}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Import from UDisc</Text>
          <TouchableOpacity onPress={handleClose} hitSlop={12}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        {step === 'pick' && (
          <View style={styles.centered}>
            <Text style={styles.icon}>📂</Text>
            <Text style={styles.stepTitle}>Select your UDisc CSV export</Text>
            <Text style={styles.stepSubtitle}>
              In UDisc, go to Scorecards → Export → CSV to download your file.
            </Text>
            {error && <Text style={styles.errorText}>{error}</Text>}
            <TouchableOpacity style={[styles.primaryButton, styles.centeredButton]} onPress={handlePickFile}>
              <Text style={styles.primaryButtonText}>Choose File</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'review' && (
          <>
            <Text style={styles.reviewSubtitle}>
              Found <Text style={styles.bold}>{items.length} rounds</Text>.
              Tap a round to toggle skip/import.
            </Text>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {items.map((item, index) => (
                <TouchableOpacity
                  key={item.round.id}
                  style={[styles.roundRow, item.action === 'skip' && styles.roundRowSkipped]}
                  onPress={() => toggleAction(index)}
                  activeOpacity={0.7}
                >
                  <View style={styles.roundInfo}>
                    <Text style={styles.courseName} numberOfLines={1}>{item.round.courseName}</Text>
                    <Text style={styles.roundMeta}>
                      {item.round.layoutName} · {item.round.holeCount} holes · {formatDate(item.round.startDate)}
                    </Text>
                    <Text style={styles.playerCount}>
                      {item.round.players.length} player{item.round.players.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={[styles.badge, item.action === 'skip' ? styles.badgeSkip : styles.badgeImport]}>
                    <Text style={styles.badgeText}>
                      {item.status === 'already-imported' && item.action === 'skip' ? 'Skip' :
                       item.status === 'already-imported' && item.action === 'import' ? 'Re-import' :
                       item.action === 'skip' ? 'Skip' : 'Import'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity style={styles.secondaryButton} onPress={reset}>
                <Text style={styles.secondaryButtonText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, !importCount && styles.primaryButtonDisabled]}
                onPress={handleImport}
                disabled={!importCount}
              >
                <Text style={styles.primaryButtonText}>
                  Import {importCount} Round{importCount !== 1 ? 's' : ''}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {step === 'importing' && (
          <>
            <View style={styles.progressHeader}>
              <View style={styles.progressLabelRow}>
                <ActivityIndicator size="small" color="#3db56b" />
                <Text style={styles.progressLabel}>
                  Importing {finishedCount} of {importCount}…
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressFraction * 100}%` as any }]} />
              </View>
            </View>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {items.filter(i => i.action === 'import').map(item => (
                <View
                  key={item.round.id}
                  style={[styles.progressRow, item.status === 'importing' && styles.progressRowActive]}
                >
                  <View style={styles.progressRowInfo}>
                    <Text style={styles.progressCourse} numberOfLines={1}>{item.round.courseName}</Text>
                    <Text style={styles.progressMeta}>
                      {formatDate(item.round.startDate)} · {item.round.holeCount} holes
                    </Text>
                  </View>
                  <Text style={styles.progressStatus}>
                    {item.status === 'importing' ? '⏳' :
                     item.status === 'done' ? '✅' :
                     item.status === 'error' ? '❌' : '—'}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {step === 'done' && (
          <View style={styles.centered}>
            <Text style={styles.icon}>{errorCount ? '⚠️' : '✅'}</Text>
            <Text style={styles.stepTitle}>
              {doneCount} round{doneCount !== 1 ? 's' : ''} imported
              {errorCount ? `, ${errorCount} failed` : ''}
            </Text>
            <TouchableOpacity style={[styles.primaryButton, styles.centeredButton]} onPress={handleClose}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      </View>
    </Modal>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.replace(/(\d{4})-(\d{2})-(\d{2}) (\d{4}).*/, '$1-$2-$3T$4'));
  if (isNaN(d.getTime())) return dateStr.split(' ')[0];
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '85%' as any,
    backgroundColor: '#0f2419',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a3d',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  closeBtn: {
    color: '#8fb89a',
    fontSize: 18,
  },
  centered: {
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 32,
    gap: 12,
  },
  icon: {
    fontSize: 56,
    marginBottom: 8,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  stepSubtitle: {
    fontSize: 14,
    color: '#8fb89a',
    textAlign: 'center',
    lineHeight: 22,
  },
  errorText: {
    color: '#e05555',
    fontSize: 14,
    textAlign: 'center',
  },
  reviewSubtitle: {
    color: '#8fb89a',
    fontSize: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  bold: {
    color: '#fff',
    fontWeight: '700',
  },
  list: {
    maxHeight: 360,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  roundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e3a2a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    gap: 12,
  },
  roundRowSkipped: {
    opacity: 0.5,
  },
  roundInfo: {
    flex: 1,
    gap: 3,
  },
  courseName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  roundMeta: {
    fontSize: 12,
    color: '#8fb89a',
  },
  playerCount: {
    fontSize: 12,
    color: '#3db56b',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  badgeImport: {
    backgroundColor: '#1a5c34',
  },
  badgeSkip: {
    backgroundColor: '#2d2d2d',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#2d5a3d',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#3db56b',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  centeredButton: {
    flex: 0,
    width: 200,
  },
  primaryButtonDisabled: {
    backgroundColor: '#1e3a2a',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#1e3a2a',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d5a3d',
  },
  secondaryButtonText: {
    color: '#8fb89a',
    fontWeight: '600',
    fontSize: 15,
  },
  progressHeader: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a3d',
    gap: 10,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#1e3a2a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3db56b',
    borderRadius: 3,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a3d',
    gap: 12,
  },
  progressRowActive: {
    backgroundColor: '#1a2e20',
    marginHorizontal: -4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderBottomWidth: 0,
  },
  progressRowInfo: {
    flex: 1,
    gap: 2,
  },
  progressCourse: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  progressMeta: {
    color: '#8fb89a',
    fontSize: 12,
  },
  progressStatus: {
    fontSize: 18,
  },
});
