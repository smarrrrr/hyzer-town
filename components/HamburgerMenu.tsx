import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '@/lib/auth';
import { getUserProfile, saveUserProfile } from '@/lib/rounds';
import ImportModal from './ImportModal';
import app from '@/lib/firebase';

export default function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [udiscNames, setUdiscNames] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pdgaNumber, setPdgaNumber] = useState('');
  const [pdgaSyncing, setPdgaSyncing] = useState(false);
  const { user, signOut } = useAuth();

  const displayName = user?.displayName ?? user?.email?.split('@')[0] ?? 'Disc Golfer';
  const initial = displayName[0].toUpperCase();
  const memberSince = user?.metadata.creationTime
    ? new Date(user.metadata.creationTime).getFullYear().toString()
    : '—';

  useEffect(() => {
    if (open && user) {
      getUserProfile(user.uid)
        .then(profile => {
          const names = profile?.udiscNames
            ?? ((profile as any)?.udiscName ? [(profile as any).udiscName] : []);
          setUdiscNames(names);
          if (profile?.pdgaNumber) setPdgaNumber(profile.pdgaNumber);
        })
        .catch(() => {});
    }
  }, [open, user]);

  const persistNames = async (names: string[]) => {
    if (!user) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveUserProfile(user.uid, { udiscNames: names });
      setUdiscNames(names);
    } catch (e: any) {
      setSaveError(e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleAddName = () => {
    const trimmed = newName.trim();
    if (!trimmed || udiscNames.includes(trimmed)) {
      setNewName('');
      return;
    }
    const updated = [...udiscNames, trimmed];
    setNewName('');
    persistNames(updated);
  };

  const handleRemoveName = (name: string) => {
    persistNames(udiscNames.filter(n => n !== name));
  };

  const handleSignOut = () => {
    setOpen(false);
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleImport = () => {
    setOpen(false);
    setImportOpen(true);
  };

  const handleSyncPDGA = async () => {
    const num = pdgaNumber.trim();
    if (!num || !/^\d+$/.test(num)) {
      Alert.alert('Invalid PDGA number', 'Enter your numeric PDGA player number.');
      return;
    }
    if (!user) return;
    setPdgaSyncing(true);
    try {
      await saveUserProfile(user.uid, { pdgaNumber: num });
      const fn = httpsCallable(getFunctions(app), 'syncPDGATournaments');
      const result = await fn({ pdgaNumber: num }) as { data: { synced: number; total: number } };
      const { synced, total } = result.data;
      Alert.alert('PDGA Sync Complete', `Synced ${synced} of ${total} tournaments.`);
    } catch (e: any) {
      Alert.alert('Sync failed', e?.message ?? 'Unknown error');
    } finally {
      setPdgaSyncing(false);
    }
  };

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.trigger} hitSlop={12}>
        <Text style={styles.triggerIcon}>☰</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.drawerWrapper}
          pointerEvents="box-none"
        >
          <View style={styles.drawer}>
          <ScrollView contentContainerStyle={styles.drawerContent} keyboardShouldPersistTaps="handled">
            <View style={styles.avatarLarge}>
              <Text style={styles.avatarLargeText}>{initial}</Text>
            </View>
            <Text style={styles.userName}>{displayName}</Text>
            <Text style={styles.userEmail}>{user?.email}</Text>

            <View style={styles.statsSection}>
              <StatRow label="Member since" value={memberSince} />
              <StatRow label="Rounds played" value="0" />
            </View>

            {/* UDisc names */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>UDisc display names</Text>

              {udiscNames.length > 0 && (
                <View style={styles.tagList}>
                  {udiscNames.map(name => (
                    <View key={name} style={styles.tag}>
                      <Text style={styles.tagText}>{name}</Text>
                      <TouchableOpacity onPress={() => handleRemoveName(name)} hitSlop={8}>
                        <Text style={styles.tagRemove}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.addRow}>
                <TextInput
                  style={styles.addInput}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Add a name from CSV…"
                  placeholderTextColor="#4a7a5a"
                  onSubmitEditing={handleAddName}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[styles.addBtn, (!newName.trim() || saving) && styles.addBtnDisabled]}
                  onPress={handleAddName}
                  disabled={!newName.trim() || saving}
                >
                  <Text style={styles.addBtnText}>{saving ? '…' : '+'}</Text>
                </TouchableOpacity>
              </View>

              {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
            </View>

            {/* PDGA */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>PDGA number</Text>
              <View style={styles.pdgaRow}>
                <TextInput
                  style={styles.pdgaInput}
                  value={pdgaNumber}
                  onChangeText={setPdgaNumber}
                  placeholder="e.g. 230924"
                  placeholderTextColor="#4a7a5a"
                  keyboardType="number-pad"
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[styles.syncBtn, pdgaSyncing && styles.syncBtnDisabled]}
                  onPress={handleSyncPDGA}
                  disabled={pdgaSyncing}
                >
                  {pdgaSyncing
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.syncBtnText}>Sync</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.menuItem} onPress={handleImport}>
              <Text style={styles.menuItemText}>Import from UDisc</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.menuItem} onPress={handleSignOut}>
              <Text style={styles.menuItemTextDanger}>Sign Out</Text>
            </TouchableOpacity>
          </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ImportModal visible={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { marginRight: 16 },
  triggerIcon: { color: '#fff', fontSize: 20, lineHeight: 22 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  drawerWrapper: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
  } as any,
  drawer: {
    top: 0,
    bottom: 0,
    width: 300,
    backgroundColor: '#1e3a2a',
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 16,
  },
  drawerContent: {
    paddingTop: 64,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  avatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#3db56b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarLargeText: { fontSize: 28, fontWeight: '800', color: '#fff' },
  userName: { fontSize: 18, fontWeight: '700', color: '#fff' },
  userEmail: { fontSize: 12, color: '#8fb89a', marginTop: 2, marginBottom: 20 },
  statsSection: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    overflow: 'hidden',
    marginBottom: 20,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a3d',
  },
  statLabel: { color: '#8fb89a', fontSize: 14 },
  statValue: { color: '#fff', fontSize: 14, fontWeight: '600' },

  fieldSection: { marginBottom: 20 },
  fieldLabel: { color: '#8fb89a', fontSize: 12, marginBottom: 8 },

  tagList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f2419',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#3db56b',
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 5,
    gap: 4,
  },
  tagText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  tagRemove: { color: '#8fb89a', fontSize: 16, lineHeight: 18 },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f2419',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 6,
  },
  addInput: { flex: 1, color: '#fff', fontSize: 14 },
  addBtn: {
    backgroundColor: '#3db56b',
    borderRadius: 7,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: '#2d5a3d' },
  addBtnText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 20 },

  saveError: { color: '#e05555', fontSize: 12, marginTop: 4 },

  pdgaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f2419',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 6,
  },
  pdgaInput: { flex: 1, color: '#fff', fontSize: 14 },
  syncBtn: {
    backgroundColor: '#3db56b',
    borderRadius: 7,
    paddingHorizontal: 12,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBtnDisabled: { backgroundColor: '#2d5a3d' },
  syncBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  divider: { height: 1, backgroundColor: '#2d5a3d', marginBottom: 4 },
  menuItem: { paddingVertical: 14 },
  menuItemText: { fontSize: 15, color: '#3db56b', fontWeight: '600' },
  menuItemTextDanger: { fontSize: 15, color: '#e05555', fontWeight: '600' },
});
