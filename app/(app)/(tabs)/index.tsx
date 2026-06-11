import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useAuth } from '@/lib/auth';
import { getRoundsImportedBy, getUserProfile } from '@/lib/rounds';
import type { Round, PlayerScore } from '@/lib/types';

export default function HomeScreen() {
  const { user } = useAuth();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [udiscNames, setUdiscNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getRoundsImportedBy(user.uid),
      getUserProfile(user.uid),
    ]).then(([r, profile]) => {
      const sorted = [...r].sort((a, b) => b.startDate.localeCompare(a.startDate));
      setRounds(sorted);
      const names = profile?.udiscNames
        ?? ((profile as any)?.udiscName ? [(profile as any).udiscName] : []);
      setUdiscNames(names);
    }).finally(() => setLoading(false));
  }, [user]);

  const findMe = (r: Round) =>
    udiscNames.length ? r.players.find(p => udiscNames.includes(p.name)) : null;

  const myScores = rounds.flatMap(r => {
    const p = findMe(r);
    return p?.relativeToPar != null ? [p.relativeToPar] : [];
  });

  const avgScore = myScores.length
    ? myScores.reduce((a, b) => a + b, 0) / myScores.length
    : null;
  const bestRound = myScores.length ? Math.min(...myScores) : null;

  const fmtScore = (n: number | null) =>
    n == null ? '—' : n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;

  const recent = rounds.slice(0, 10);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.statsRow}>
        <StatCard label="Rounds" value={loading ? '…' : String(rounds.length)} />
        <StatCard label="Avg Score" value={loading ? '…' : fmtScore(avgScore != null ? Math.round(avgScore) : null)} />
        <StatCard label="Best Round" value={loading ? '…' : fmtScore(bestRound)} />
      </View>

      <Text style={styles.sectionTitle}>Recent Rounds</Text>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color="#3db56b" />
        </View>
      ) : rounds.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>⛳</Text>
          <Text style={styles.emptyText}>No rounds yet</Text>
          <Text style={styles.emptySubtext}>Import your rounds from the menu ☰</Text>
        </View>
      ) : (
        <View style={styles.roundsList}>
          {recent.map(round => {
            const myPlayer = findMe(round);
            const expanded = expandedId === round.id;
            return (
              <View key={round.id} style={styles.roundCard}>
                <TouchableOpacity
                  style={styles.roundCardHeader}
                  onPress={() => setExpandedId(expanded ? null : round.id)}
                  activeOpacity={0.75}
                >
                  <View style={styles.roundCardLeft}>
                    <Text style={styles.roundCourse} numberOfLines={1}>{round.courseName}</Text>
                    <Text style={styles.roundMeta}>
                      {round.layoutName} · {round.holeCount} holes · {formatDate(round.startDate)}
                    </Text>
                    <Text style={styles.roundPlayers}>
                      {round.players.map(p => p.name).join(', ')}
                    </Text>
                  </View>
                  <View style={styles.roundCardRight}>
                    {myPlayer && (
                      <View style={[
                        styles.scoreChip,
                        myPlayer.relativeToPar != null && myPlayer.relativeToPar < 0 && styles.scoreChipUnder,
                        myPlayer.relativeToPar != null && myPlayer.relativeToPar > 0 && styles.scoreChipOver,
                      ]}>
                        <Text style={styles.scoreChipText}>{fmtScore(myPlayer.relativeToPar)}</Text>
                        <Text style={styles.scoreChipTotal}>{myPlayer.total}</Text>
                      </View>
                    )}
                    <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
                  </View>
                </TouchableOpacity>

                {expanded && <InlineScorecard round={round} />}
              </View>
            );
          })}
          {rounds.length > 10 && (
            <Text style={styles.moreRounds}>+{rounds.length - 10} more rounds — see History</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const LABEL_W = 72;
const TOTAL_W = 46;
const MIN_COL_W = 28;

function InlineScorecard({ round }: { round: Round }) {
  const [containerW, setContainerW] = useState(0);

  const fitsOneLine = containerW > 0 &&
    containerW >= LABEL_W + TOTAL_W + round.holeCount * MIN_COL_W;

  const CHUNK = fitsOneLine ? round.holeCount : 9;
  const chunks: number[][] = [];
  for (let i = 0; i < round.holeCount; i += CHUNK) {
    chunks.push(Array.from({ length: Math.min(CHUNK, round.holeCount - i) }, (_, j) => i + j));
  }

  const fmtRel = (p: PlayerScore) =>
    p.relativeToPar == null ? null
    : p.relativeToPar === 0 ? 'E'
    : p.relativeToPar > 0 ? `+${p.relativeToPar}`
    : `${p.relativeToPar}`;

  const chunkLabel = (ci: number) =>
    chunks.length === 1 ? 'Tot' : ci === 0 ? 'Out' : ci === chunks.length - 1 ? 'In' : 'Sub';

  return (
    <View style={styles.scorecard} onLayout={e => setContainerW(e.nativeEvent.layout.width)}>
      {containerW === 0 ? null : chunks.map((holeIndices, ci) => {
        const isLast = ci === chunks.length - 1;
        const label = chunkLabel(ci);

        return (
          <View key={ci} style={ci > 0 ? styles.scorecardSection : undefined}>
            {/* Hole numbers */}
            <View style={styles.scRow}>
              <View style={styles.scLabelCell}><Text style={styles.scMeta}>Hole</Text></View>
              {holeIndices.map(i => (
                <View key={i} style={styles.scHoleCell}>
                  <Text style={styles.scMeta}>{i + 1}</Text>
                </View>
              ))}
              <View style={styles.scTotalCell}><Text style={styles.scMeta}>{label}</Text></View>
            </View>

            {/* Par */}
            <View style={styles.scRow}>
              <View style={styles.scLabelCell}><Text style={styles.scMeta}>Par</Text></View>
              {holeIndices.map(i => (
                <View key={i} style={styles.scHoleCell}>
                  <Text style={styles.scMeta}>{round.pars[i] ?? '—'}</Text>
                </View>
              ))}
              <View style={styles.scTotalCell}>
                <Text style={styles.scMeta}>
                  {holeIndices.reduce((s, i) => s + (round.pars[i] ?? 0), 0)}
                </Text>
              </View>
            </View>

            {/* Players */}
            {round.players.map(player => {
              const chunkStrokes = holeIndices.reduce((s, i) => s + (player.holes[i] ?? 0), 0);
              const rel = isLast ? fmtRel(player) : null;
              const relColor = player.relativeToPar == null || player.relativeToPar === 0
                ? '#fff' : player.relativeToPar < 0 ? '#3b82f6' : '#f97316';

              return (
                <View key={player.name} style={styles.scRow}>
                  <View style={styles.scLabelCell}>
                    <Text style={styles.scPlayerName} numberOfLines={1}>{player.name}</Text>
                  </View>
                  {holeIndices.map(i => (
                    <ScoreCell key={i} score={player.holes[i] ?? null} par={round.pars[i] ?? null} />
                  ))}
                  <View style={styles.scTotalCell}>
                    {rel != null
                      ? <Text style={[styles.scTotalRel, { color: relColor }]}>{rel}</Text>
                      : null}
                    <Text style={styles.scTotalStrokes}>
                      {isLast ? player.total : chunkStrokes}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function ScoreCell({ score, par }: { score: number | null; par: number | null }) {
  if (score == null) {
    return <View style={styles.scHoleCell}><Text style={styles.scCellText}>—</Text></View>;
  }

  const diff = par != null ? score - par : null;
  let bg: string | null = null;
  let circle = false;

  if (diff != null) {
    if (diff <= -2) { bg = '#1d4ed8'; circle = true; }
    else if (diff === -1) { bg = '#3b82f6'; circle = true; }
    else if (diff === 1) { bg = 'rgba(249,115,22,0.4)'; }
    else if (diff >= 2) { bg = 'rgba(220,38,38,0.5)'; }
  }

  return (
    <View style={styles.scHoleCell}>
      <View style={[
        styles.scInner,
        bg ? { backgroundColor: bg } : null,
        circle ? styles.scCircle : (bg ? styles.scSquare : null),
      ]}>
        <Text style={[styles.scCellText, bg ? styles.scCellTextBold : null]}>{score}</Text>
      </View>
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.split(' ')[0]);
  if (isNaN(d.getTime())) return dateStr.split(' ')[0];
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f2419' },
  content: { padding: 20, gap: 20 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1,
    backgroundColor: '#1e3a2a',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d5a3d',
  },
  statValue: { fontSize: 22, fontWeight: '800', color: '#3db56b' },
  statLabel: { fontSize: 11, color: '#8fb89a', marginTop: 2, fontWeight: '600' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  loadingState: { paddingVertical: 48, alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 17, fontWeight: '600', color: '#fff' },
  emptySubtext: { fontSize: 14, color: '#8fb89a' },
  roundsList: { gap: 10 },
  roundCard: {
    backgroundColor: '#1e3a2a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    overflow: 'hidden',
  },
  roundCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  roundCardLeft: { flex: 1, gap: 3 },
  roundCardRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  roundCourse: { fontSize: 15, fontWeight: '700', color: '#fff' },
  roundMeta: { fontSize: 12, color: '#8fb89a' },
  roundPlayers: { fontSize: 12, color: '#4a8a5a', marginTop: 1 },
  scoreChip: {
    backgroundColor: '#2d5a3d',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    minWidth: 48,
  },
  scoreChipUnder: { backgroundColor: '#1a5c34' },
  scoreChipOver: { backgroundColor: '#5c2a1a' },
  scoreChipText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  scoreChipTotal: { color: '#8fb89a', fontSize: 10, marginTop: 1 },
  chevron: { color: '#8fb89a', fontSize: 11 },
  moreRounds: { textAlign: 'center', color: '#8fb89a', fontSize: 13, paddingVertical: 8 },

  // Scorecard
  scorecard: {
    borderTopWidth: 1,
    borderTopColor: '#2d5a3d',
    paddingTop: 8,
    paddingBottom: 10,
  },
  scorecardSection: {
    borderTopWidth: 1,
    borderTopColor: '#2d5a3d',
    marginTop: 6,
    paddingTop: 6,
  },
  scRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  scLabelCell: {
    width: 72,
    paddingLeft: 12,
    justifyContent: 'center',
  },
  scHoleCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  scTotalCell: {
    width: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 8,
  },
  scMeta: { color: '#8fb89a', fontSize: 11, textAlign: 'center' },
  scPlayerName: { color: '#fff', fontSize: 11, fontWeight: '600' },
  scTotalRel: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  scTotalStrokes: { color: '#8fb89a', fontSize: 10, textAlign: 'center' },
  scCellText: { color: '#fff', fontSize: 12, textAlign: 'center' },
  scCellTextBold: { fontWeight: '700' },
  scInner: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scCircle: { borderRadius: 11 },
  scSquare: { borderRadius: 4 },
});
