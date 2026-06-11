import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { getRoundById } from '@/lib/rounds';
import type { Round, PlayerScore } from '@/lib/types';

const COL_W = 36;
const LABEL_W = 90;

export default function RoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [round, setRound] = useState<Round | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) getRoundById(id).then(r => { setRound(r); setLoading(false); });
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3db56b" size="large" />
      </View>
    );
  }
  if (!round) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Round not found</Text>
      </View>
    );
  }

  const chunkSize = 9;
  const chunks: number[][] = [];
  for (let i = 0; i < round.holeCount; i += chunkSize) {
    chunks.push(Array.from({ length: Math.min(chunkSize, round.holeCount - i) }, (_, j) => i + j));
  }

  return (
    <>
      <Stack.Screen options={{ title: round.courseName, headerBackTitle: 'Back' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

        {/* Player summary */}
        <View style={styles.section}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryHeaderLeft}>Player</Text>
            <Text style={styles.summaryHeaderRight}>Round  Rating</Text>
          </View>
          {round.players.map(p => (
            <PlayerSummaryRow key={p.name} player={p} />
          ))}
        </View>

        {/* Scorecard */}
        <Text style={styles.sectionTitle}>Scorecard</Text>
        {chunks.map((holeIndices, ci) => (
          <View key={ci} style={styles.scorecardChunk}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                {/* Hole row */}
                <View style={styles.row}>
                  <Text style={[styles.labelCell, styles.metaCell]}>Hole</Text>
                  {holeIndices.map(hi => (
                    <Text key={hi} style={[styles.cell, styles.metaCell]}>{hi + 1}</Text>
                  ))}
                </View>
                {/* Par row */}
                <View style={styles.row}>
                  <Text style={[styles.labelCell, styles.metaCell]}>Par</Text>
                  {holeIndices.map(hi => (
                    <Text key={hi} style={[styles.cell, styles.metaCell]}>
                      {round.pars[hi] ?? '—'}
                    </Text>
                  ))}
                </View>
                {/* Player rows */}
                {round.players.map(player => (
                  <View key={player.name} style={styles.row}>
                    <Text style={styles.labelCell} numberOfLines={1}>{player.name}</Text>
                    {holeIndices.map(hi => {
                      const score = player.holes[hi] ?? null;
                      const par = round.pars[hi] ?? null;
                      return <ScoreCell key={hi} score={score} par={par} />;
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        ))}

        {/* Player overview */}
        <Text style={styles.sectionTitle}>Player overview</Text>
        {round.players.map(p => (
          <PlayerOverview key={p.name} player={p} pars={round.pars} holeCount={round.holeCount} />
        ))}

      </ScrollView>
    </>
  );
}

function PlayerSummaryRow({ player }: { player: PlayerScore }) {
  const initial = player.name[0].toUpperCase();
  const rel = player.relativeToPar;
  const relStr = rel == null ? '—' : rel === 0 ? 'E' : rel > 0 ? `+${rel}` : `${rel}`;
  const relColor = rel == null || rel === 0 ? '#fff' : rel < 0 ? '#3b82f6' : '#f97316';

  return (
    <View style={styles.summaryRow}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <Text style={styles.playerName}>{player.name}</Text>
      <View style={styles.summaryScores}>
        <Text style={[styles.relScore, { color: relColor }]}>{relStr}</Text>
        <Text style={styles.totalScore}> ({player.total})</Text>
        {player.roundRating != null && (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingText}>+{player.roundRating}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ScoreCell({ score, par }: { score: number | null; par: number | null }) {
  if (score == null) {
    return <View style={styles.cell}><Text style={styles.cellText}>—</Text></View>;
  }

  const diff = par != null ? score - par : null;
  let bg: string | null = null;
  let circle = false;

  if (diff != null) {
    if (diff <= -2) { bg = '#1d4ed8'; circle = true; }      // eagle+
    else if (diff === -1) { bg = '#3b82f6'; circle = true; } // birdie
    else if (diff === 1) { bg = 'rgba(249,115,22,0.35)'; }  // bogey
    else if (diff >= 2) { bg = 'rgba(220,38,38,0.45)'; }    // double+
  }

  return (
    <View style={styles.cell}>
      <View style={[
        styles.scoreInner,
        bg ? { backgroundColor: bg } : null,
        circle ? styles.scoreCircle : (bg ? styles.scoreSquare : null),
      ]}>
        <Text style={[styles.cellText, bg ? styles.cellTextBg : null]}>{score}</Text>
      </View>
    </View>
  );
}

function PlayerOverview({ player, pars, holeCount }: { player: PlayerScore; pars: (number | null)[]; holeCount: number }) {
  const initial = player.name[0].toUpperCase();
  const rel = player.relativeToPar;
  const relStr = rel == null ? '—' : rel === 0 ? 'E' : rel > 0 ? `+${rel}` : `${rel}`;
  const relColor = rel == null || rel === 0 ? '#fff' : rel < 0 ? '#3b82f6' : '#f97316';

  let eagles = 0, birdies = 0, parsCount = 0, bogeys = 0, doubles = 0;
  for (let i = 0; i < holeCount; i++) {
    const score = player.holes[i];
    const par = pars[i];
    if (score == null || par == null) continue;
    const diff = score - par;
    if (diff <= -2) eagles++;
    else if (diff === -1) birdies++;
    else if (diff === 0) parsCount++;
    else if (diff === 1) bogeys++;
    else doubles++;
  }

  return (
    <View style={styles.overviewCard}>
      <View style={styles.overviewHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.playerName}>{player.name}</Text>
        <View style={styles.summaryScores}>
          <Text style={[styles.relScore, { color: relColor }]}>{relStr}</Text>
          <Text style={styles.totalScore}> ({player.total})</Text>
          {player.roundRating != null && (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>+{player.roundRating}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.statBar}>
        {eagles > 0 && <StatBarSegment count={eagles} label="EAGLES" color="#1d4ed8" />}
        {birdies > 0 && <StatBarSegment count={birdies} label="BIRDIES" color="#3b82f6" />}
        {parsCount > 0 && <StatBarSegment count={parsCount} label="PARS" color="#2d5a3d" />}
        {bogeys > 0 && <StatBarSegment count={bogeys} label="BOGEYS" color="#f97316" />}
        {doubles > 0 && <StatBarSegment count={doubles} label="DOUBLES+" color="#dc2626" />}
      </View>

      <View style={styles.statRow}>
        {eagles > 0 && <StatItem label="Eagles" value={eagles} color="#1d4ed8" />}
        {birdies > 0 && <StatItem label="Birdies" value={birdies} color="#3b82f6" />}
        <StatItem label="Pars" value={parsCount} color="#8fb89a" />
        {bogeys > 0 && <StatItem label="Bogeys" value={bogeys} color="#f97316" />}
        {doubles > 0 && <StatItem label="Doubles+" value={doubles} color="#dc2626" />}
      </View>
    </View>
  );
}

function StatBarSegment({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <View style={[styles.barSegment, { backgroundColor: color, flex: count }]} />
  );
}

function StatItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f2419' },
  content: { paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0f2419', alignItems: 'center', justifyContent: 'center' },
  notFound: { color: '#8fb89a', fontSize: 16 },

  section: {
    backgroundColor: '#1e3a2a',
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a3d',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a3d',
  },
  summaryHeaderLeft: { color: '#8fb89a', fontSize: 13, fontWeight: '700' },
  summaryHeaderRight: { color: '#8fb89a', fontSize: 13, fontWeight: '700' },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a3d',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3db56b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  playerName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  summaryScores: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  relScore: { fontSize: 16, fontWeight: '800' },
  totalScore: { color: '#8fb89a', fontSize: 14 },
  ratingBadge: {
    marginLeft: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#2d5a3d',
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  ratingText: { color: '#8fb89a', fontSize: 13, fontWeight: '700' },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 10,
  },

  scorecardChunk: {
    backgroundColor: '#1e3a2a',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    overflow: 'hidden',
    paddingVertical: 8,
  },

  row: { flexDirection: 'row', alignItems: 'center' },

  labelCell: {
    width: LABEL_W,
    paddingLeft: 10,
    paddingVertical: 6,
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  metaCell: {
    color: '#8fb89a',
    fontSize: 12,
    fontWeight: '600',
  },
  cell: {
    width: COL_W,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
  },
  cellText: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center',
  },
  cellTextBg: {
    fontWeight: '700',
  },
  scoreInner: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreCircle: { borderRadius: 13 },
  scoreSquare: { borderRadius: 5 },

  overviewCard: {
    backgroundColor: '#1e3a2a',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    padding: 14,
    gap: 12,
  },
  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  statBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    gap: 2,
  },
  barSegment: { borderRadius: 4 },

  statRow: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 10, color: '#8fb89a', fontWeight: '600' },
});
