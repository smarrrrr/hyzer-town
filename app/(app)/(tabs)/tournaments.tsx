import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firestore';
import { getUserProfile } from '@/lib/rounds';
import { useAuth } from '@/lib/auth';

interface RoundScore {
  round: number;
  total: number;
  relativeToPar: number | null;
  holes: (number | null)[];
  rating: number | null;
}

interface Tournament {
  tournId: string;
  name: string;
  date: string;
  division: string;
  place: string | null;
  rounds: RoundScore[];
}

function fmtRel(n: number | null): string {
  if (n == null) return '—';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : String(n);
}

function fmtPlace(place: string | null): string {
  if (!place) return '—';
  const n = parseInt(place, 10);
  if (isNaN(n)) return place;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function RoundCard({ r }: { r: RoundScore }) {
  const filledHoles = r.holes.filter(h => h != null);
  return (
    <View style={styles.roundCard}>
      <View style={styles.roundHeader}>
        <Text style={styles.roundLabel}>Round {r.round}</Text>
        <View style={styles.roundScores}>
          <Text style={styles.roundTotal}>{r.total || '—'}</Text>
          <Text style={[
            styles.roundRel,
            (r.relativeToPar ?? 0) < 0 && styles.under,
            (r.relativeToPar ?? 0) > 0 && styles.over,
          ]}>
            {fmtRel(r.relativeToPar)}
          </Text>
          {r.rating != null && (
            <Text style={styles.roundRating}>{r.rating} rated</Text>
          )}
        </View>
      </View>
      {filledHoles.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.holeScroll}>
          {r.holes.map((h, i) => (
            <View key={i} style={styles.holeCell}>
              <Text style={styles.holeNum}>{i + 1}</Text>
              <Text style={styles.holeScore}>{h ?? '—'}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function TournamentCard({ t }: { t: Tournament }) {
  const [expanded, setExpanded] = useState(false);
  const totalRel = t.rounds.reduce((sum, r) => sum + (r.relativeToPar ?? 0), 0);
  const hasScores = t.rounds.length > 0;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setExpanded(e => !e)}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardName} numberOfLines={2}>{t.name}</Text>
          <Text style={styles.cardMeta}>{t.date}  ·  {t.division || '—'}</Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPlace}>{fmtPlace(t.place)}</Text>
          {hasScores && (
            <Text style={[
              styles.cardRel,
              totalRel < 0 && styles.under,
              totalRel > 0 && styles.over,
            ]}>
              {fmtRel(totalRel)}
            </Text>
          )}
        </View>
      </View>

      {expanded && hasScores && (
        <View style={styles.roundList}>
          {t.rounds
            .slice()
            .sort((a, b) => a.round - b.round)
            .map(r => <RoundCard key={r.round} r={r} />)
          }
        </View>
      )}

      {expanded && !hasScores && (
        <Text style={styles.noScores}>No round scores available</Text>
      )}

      <Text style={styles.expandChevron}>{expanded ? '▲' : '▼'}</Text>
    </TouchableOpacity>
  );
}

export default function TournamentsScreen() {
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasPDGA, setHasPDGA] = useState<boolean | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    const profile = await getUserProfile(user.uid);
    setHasPDGA(!!profile?.pdgaNumber);

    const snap = await getDocs(
      query(
        collection(db, 'pdga_tournaments', user.uid, 'events'),
        orderBy('date', 'desc'),
      )
    );
    setTournaments(snap.docs.map(d => d.data() as Tournament));
  }, [user]);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData().catch(() => {});
    setRefreshing(false);
  }, [loadData]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#3db56b" size="large" />
      </View>
    );
  }

  if (hasPDGA === false) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyIcon}>🏆</Text>
        <Text style={styles.emptyTitle}>No PDGA number set</Text>
        <Text style={styles.emptySub}>
          Open the menu (☰), enter your PDGA number, and tap Sync.
        </Text>
      </View>
    );
  }

  if (tournaments.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyIcon}>🏆</Text>
        <Text style={styles.emptyTitle}>No tournaments yet</Text>
        <Text style={styles.emptySub}>
          Open the menu (☰) and tap Sync to pull your PDGA tournament history.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3db56b" />}
    >
      <Text style={styles.count}>{tournaments.length} tournaments</Text>
      {tournaments.map(t => <TournamentCard key={t.tournId} t={t} />)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f2419' },
  centered: { justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, gap: 12, paddingBottom: 40 },

  count: { color: '#8fb89a', fontSize: 12, fontWeight: '600', marginBottom: 4 },

  emptyIcon: { fontSize: 56, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#8fb89a', textAlign: 'center', paddingHorizontal: 32 },

  card: {
    backgroundColor: '#1e3a2a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    padding: 16,
    gap: 0,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardLeft: { flex: 1, gap: 4 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cardMeta: { fontSize: 12, color: '#8fb89a' },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  cardPlace: { fontSize: 22, fontWeight: '800', color: '#3db56b' },
  cardRel: { fontSize: 14, fontWeight: '600', color: '#fff' },

  expandChevron: { color: '#4a7a5a', fontSize: 11, textAlign: 'center', marginTop: 10 },

  roundList: { marginTop: 14, gap: 10 },
  roundCard: {
    backgroundColor: '#0f2419',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    padding: 12,
    gap: 8,
  },
  roundHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roundLabel: { fontSize: 13, fontWeight: '700', color: '#8fb89a' },
  roundScores: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundTotal: { fontSize: 15, fontWeight: '700', color: '#fff' },
  roundRel: { fontSize: 14, fontWeight: '600', color: '#fff' },
  roundRating: { fontSize: 11, color: '#8fb89a' },

  holeScroll: { marginTop: 2 },
  holeCell: { alignItems: 'center', marginRight: 10, minWidth: 22 },
  holeNum: { fontSize: 9, color: '#4a7a5a', fontWeight: '600' },
  holeScore: { fontSize: 13, fontWeight: '700', color: '#fff' },

  noScores: { color: '#4a7a5a', fontSize: 13, marginTop: 12, textAlign: 'center' },

  under: { color: '#3db56b' },
  over: { color: '#e05555' },
});
