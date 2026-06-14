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
  par?: number | null;
  relativeToPar: number | null;
  holes: (number | null)[];
  holePars?: (number | null)[];
  rating: number | null;
}

interface Tournament {
  tournId: string;
  name: string;
  date: string;
  tier?: string;
  division: string;
  place: string | null;
  rounds: RoundScore[];
  totalRelToPar?: number | null;
}

function fmtRel(n: number | null | undefined): string {
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

// Hole score cell — styled like PDGA live scoring
function HoleCell({
  score,
  par,
}: {
  score: number | null;
  par?: number | null;
}) {
  if (score == null) {
    return <View style={styles.holeBox}><Text style={styles.holeBoxText}>—</Text></View>;
  }
  const rel = par != null ? score - par : null;
  if (rel != null && rel <= -2) {
    // Eagle or better: gold circle
    return (
      <View style={[styles.holeBox, styles.holeEagle]}>
        <Text style={[styles.holeBoxText, styles.holeBoxTextDark]}>{score}</Text>
      </View>
    );
  }
  if (rel != null && rel === -1) {
    // Birdie: green circle
    return (
      <View style={[styles.holeBox, styles.holeBirdie]}>
        <Text style={[styles.holeBoxText, styles.holeBoxTextLight]}>{score}</Text>
      </View>
    );
  }
  if (rel != null && rel === 1) {
    // Bogey: grey rounded square
    return (
      <View style={[styles.holeBox, styles.holeBogey]}>
        <Text style={[styles.holeBoxText, styles.holeBoxTextLight]}>{score}</Text>
      </View>
    );
  }
  if (rel != null && rel >= 2) {
    // Double+: dark square
    return (
      <View style={[styles.holeBox, styles.holeDouble]}>
        <Text style={[styles.holeBoxText, styles.holeBoxTextLight]}>{score}</Text>
      </View>
    );
  }
  // Par or unknown: plain
  return <View style={styles.holeBox}><Text style={styles.holeBoxText}>{score}</Text></View>;
}

function Scorecard({ r }: { r: RoundScore }) {
  const hasHoles = r.holes.filter(h => h != null).length > 0;
  const hasPars = (r.holePars ?? []).filter(p => p != null).length > 0;

  const rel = r.relativeToPar ??
    (r.par != null ? r.total - r.par : null);

  return (
    <View style={styles.scorecard}>
      {/* Stats strip */}
      <View style={styles.statsStrip}>
        <View style={[
          styles.relChip,
          rel != null && rel < 0 && styles.relChipUnder,
          rel != null && rel > 0 && styles.relChipOver,
          rel === 0 && styles.relChipEven,
        ]}>
          <Text style={styles.relChipText}>{fmtRel(rel)}</Text>
        </View>
        <View style={styles.statsRight}>
          <Text style={styles.statItem}>
            <Text style={styles.statValue}>{r.total}</Text>
            <Text style={styles.statLabel}> strokes</Text>
          </Text>
          {r.par != null && (
            <Text style={styles.statItem}>
              <Text style={styles.statLabel}>Par </Text>
              <Text style={styles.statValue}>{r.par}</Text>
            </Text>
          )}
          {r.rating != null && (
            <Text style={styles.statItem}>
              <Text style={styles.statValue}>{r.rating}</Text>
              <Text style={styles.statLabel}> rated</Text>
            </Text>
          )}
        </View>
      </View>

      {/* Hole grid */}
      {hasHoles && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.gridScroll}
          contentContainerStyle={styles.gridContent}
        >
          {/* Label column */}
          <View style={styles.gridLabelCol}>
            <Text style={styles.gridLabel}>Hole</Text>
            {hasPars && <Text style={styles.gridLabel}>Par</Text>}
            <Text style={styles.gridLabel}>Score</Text>
          </View>

          {/* Hole columns */}
          {r.holes.map((score, i) => {
            const holePar = r.holePars?.[i] ?? null;
            return (
              <View key={i} style={styles.gridHoleCol}>
                <Text style={styles.gridHoleNum}>{i + 1}</Text>
                {hasPars && (
                  <Text style={styles.gridParCell}>{holePar ?? '—'}</Text>
                )}
                <HoleCell score={score} par={holePar} />
              </View>
            );
          })}

          {/* Total column */}
          <View style={[styles.gridHoleCol, styles.gridTotalCol]}>
            <Text style={styles.gridHoleNum}>Tot</Text>
            {hasPars && <Text style={styles.gridParCell}>{r.par ?? '—'}</Text>}
            <View style={styles.holeBox}>
              <Text style={[styles.holeBoxText, styles.totalText]}>{r.total}</Text>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function TournamentCard({ t }: { t: Tournament }) {
  const [expanded, setExpanded] = useState(false);
  const [activeRound, setActiveRound] = useState(0);

  const sorted = t.rounds.slice().sort((a, b) => a.round - b.round);
  const hasScores = sorted.length > 0;
  const scoreSummary = hasScores
    ? sorted.filter(r => r.total > 0).map(r => r.total).join(' · ')
    : null;

  return (
    <View style={styles.card}>
      {/* Card header — always tappable */}
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.8}
      >
        <View style={styles.cardLeft}>
          <Text style={styles.cardName} numberOfLines={2}>{t.name}</Text>
          <Text style={styles.cardMeta}>
            {[t.date, t.tier, t.division].filter(Boolean).join('  ·  ')}
          </Text>
          {!expanded && scoreSummary && (
            <Text style={styles.cardScoreSummary}>{scoreSummary}</Text>
          )}
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPlace}>{fmtPlace(t.place)}</Text>
          <Text style={styles.expandChevron}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedBody}>
          {!hasScores && (
            <Text style={styles.noScores}>No round scores available</Text>
          )}
          {hasScores && (
            <>
              {/* Round tabs */}
              {sorted.length > 1 && (
                <View style={styles.roundTabs}>
                  {sorted.map((r, i) => (
                    <TouchableOpacity
                      key={r.round}
                      style={[styles.roundTab, i === activeRound && styles.roundTabActive]}
                      onPress={() => setActiveRound(i)}
                    >
                      <Text style={[
                        styles.roundTabText,
                        i === activeRound && styles.roundTabTextActive,
                      ]}>
                        Round {r.round}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Scorecard r={sorted[activeRound] ?? sorted[0]} />
            </>
          )}
        </View>
      )}
    </View>
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
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#3db56b"
        />
      }
    >
      <Text style={styles.count}>{tournaments.length} tournaments</Text>
      {tournaments.map(t => <TournamentCard key={t.tournId} t={t} />)}
    </ScrollView>
  );
}

const HOLE_SIZE = 28;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f2419' },
  centered: { justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  count: { color: '#8fb89a', fontSize: 12, fontWeight: '600', marginBottom: 4 },

  emptyIcon: { fontSize: 56, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 8 },
  emptySub: {
    fontSize: 14, color: '#8fb89a',
    textAlign: 'center', paddingHorizontal: 32,
  },

  card: {
    backgroundColor: '#1e3a2a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  cardLeft: { flex: 1, gap: 4 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cardMeta: { fontSize: 12, color: '#8fb89a' },
  cardScoreSummary: { fontSize: 12, color: '#4a7a5a', marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  cardPlace: { fontSize: 22, fontWeight: '800', color: '#3db56b' },
  expandChevron: { color: '#4a7a5a', fontSize: 11 },

  expandedBody: {
    borderTopWidth: 1,
    borderTopColor: '#2d5a3d',
    paddingBottom: 16,
  },

  // Round tabs
  roundTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a3d',
  },
  roundTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  roundTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#3db56b',
  },
  roundTabText: { fontSize: 13, fontWeight: '600', color: '#4a7a5a' },
  roundTabTextActive: { color: '#3db56b' },

  // Scorecard
  scorecard: { paddingTop: 12, paddingHorizontal: 16, gap: 12 },

  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  relChip: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#2d5a3d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  relChipUnder: { backgroundColor: '#1a5c32' },
  relChipOver: { backgroundColor: '#4a1a1a' },
  relChipEven: { backgroundColor: '#1e3a2a' },
  relChipText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  statsRight: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statItem: { fontSize: 13 },
  statValue: { color: '#fff', fontWeight: '700' },
  statLabel: { color: '#8fb89a' },

  // Hole grid
  gridScroll: { marginTop: 4 },
  gridContent: { gap: 0 },
  gridLabelCol: {
    justifyContent: 'space-around',
    paddingRight: 8,
    gap: 4,
  },
  gridLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8fb89a',
    height: HOLE_SIZE,
    lineHeight: HOLE_SIZE,
  },
  gridHoleCol: {
    alignItems: 'center',
    gap: 4,
    width: HOLE_SIZE + 4,
  },
  gridTotalCol: {
    marginLeft: 6,
    borderLeftWidth: 1,
    borderLeftColor: '#2d5a3d',
    paddingLeft: 6,
  },
  gridHoleNum: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4a7a5a',
    height: HOLE_SIZE,
    lineHeight: HOLE_SIZE,
    textAlign: 'center',
  },
  gridParCell: {
    fontSize: 12,
    color: '#8fb89a',
    height: HOLE_SIZE,
    lineHeight: HOLE_SIZE,
    textAlign: 'center',
    width: HOLE_SIZE,
  },

  // Hole cells
  holeBox: {
    width: HOLE_SIZE,
    height: HOLE_SIZE,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holeBoxText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  holeBoxTextLight: { color: '#fff' },
  holeBoxTextDark: { color: '#0f2419' },
  holeBirdie: {
    backgroundColor: '#3db56b',
    borderRadius: HOLE_SIZE / 2, // circle
  },
  holeEagle: {
    backgroundColor: '#f5c518',
    borderRadius: HOLE_SIZE / 2,
  },
  holeBogey: {
    backgroundColor: '#2d5a3d',
  },
  holeDouble: {
    backgroundColor: '#7a1a1a',
  },
  totalText: { fontSize: 13, fontWeight: '800' },

  noScores: {
    color: '#4a7a5a', fontSize: 13,
    margin: 16, textAlign: 'center',
  },
});
