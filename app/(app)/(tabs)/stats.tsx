import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useAuth } from '@/lib/auth';
import { getRoundsImportedBy, getUserProfile } from '@/lib/rounds';
import type { Round, PlayerScore } from '@/lib/types';

// --- types ---

type Section = 'courses' | 'h2h' | 'scoring';

interface CourseRound {
  date: string;
  relToPar: number;
}

interface CourseStats {
  courseName: string;
  rounds: number;
  avgRelToPar: number;
  bestRelToPar: number;
  layouts: string[];
  history: CourseRound[];
}

interface H2HEntry {
  opponentName: string;
  rounds: number;
  wins: number;
  losses: number;
  ties: number;
  myAvgRel: number;
  theirAvgRel: number;
}

interface ScoringBreakdown {
  totalHoles: number;
  eagles: number;
  birdies: number;
  pars: number;
  bogeys: number;
  doubles: number;
}

// --- helpers ---

function fmtRel(n: number, decimals = 0): string {
  const v = decimals > 0 ? parseFloat(n.toFixed(decimals)) : Math.round(n);
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : `${v}`;
}

function relColor(n: number): string {
  if (n < 0) return '#3b82f6';
  if (n > 0) return '#f97316';
  return '#fff';
}

function computeCourseStats(rounds: Round[], udiscNames: string[]): CourseStats[] {
  const map = new Map<string, { rels: number[]; layouts: Set<string>; history: CourseRound[] }>();
  for (const round of rounds) {
    const me = round.players.find(p => udiscNames.includes(p.name));
    if (!me || me.relativeToPar == null) continue;
    const existing = map.get(round.courseName) ?? { rels: [], layouts: new Set<string>(), history: [] };
    existing.rels.push(me.relativeToPar);
    existing.layouts.add(round.layoutName);
    existing.history.push({ date: round.startDate, relToPar: me.relativeToPar });
    map.set(round.courseName, existing);
  }
  return Array.from(map.entries())
    .map(([courseName, { rels, layouts, history }]) => ({
      courseName,
      rounds: rels.length,
      avgRelToPar: rels.reduce((a, b) => a + b, 0) / rels.length,
      bestRelToPar: Math.min(...rels),
      layouts: Array.from(layouts),
      history: [...history].sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.rounds - a.rounds);
}

function computeH2H(rounds: Round[], udiscNames: string[]): H2HEntry[] {
  const map = new Map<string, {
    myRels: number[];
    theirRels: number[];
    wins: number;
    losses: number;
    ties: number;
  }>();
  for (const round of rounds) {
    const me = round.players.find(p => udiscNames.includes(p.name));
    if (!me || me.relativeToPar == null) continue;
    for (const opp of round.players) {
      if (udiscNames.includes(opp.name) || opp.relativeToPar == null) continue;
      const e = map.get(opp.name) ?? { myRels: [], theirRels: [], wins: 0, losses: 0, ties: 0 };
      e.myRels.push(me.relativeToPar);
      e.theirRels.push(opp.relativeToPar);
      if (me.relativeToPar < opp.relativeToPar) e.wins++;
      else if (me.relativeToPar > opp.relativeToPar) e.losses++;
      else e.ties++;
      map.set(opp.name, e);
    }
  }
  return Array.from(map.entries())
    .map(([opponentName, { myRels, theirRels, wins, losses, ties }]) => ({
      opponentName,
      rounds: myRels.length,
      wins, losses, ties,
      myAvgRel: myRels.reduce((a, b) => a + b, 0) / myRels.length,
      theirAvgRel: theirRels.reduce((a, b) => a + b, 0) / theirRels.length,
    }))
    .filter(e => e.rounds > 0)
    .sort((a, b) => b.rounds - a.rounds);
}

function computeScoring(rounds: Round[], udiscNames: string[]): ScoringBreakdown {
  let totalHoles = 0, eagles = 0, birdies = 0, pars = 0, bogeys = 0, doubles = 0;
  for (const round of rounds) {
    const me = round.players.find(p => udiscNames.includes(p.name));
    if (!me) continue;
    me.holes.forEach((score, i) => {
      if (score == null || round.pars[i] == null) return;
      totalHoles++;
      const diff = score - round.pars[i]!;
      if (diff <= -2) eagles++;
      else if (diff === -1) birdies++;
      else if (diff === 0) pars++;
      else if (diff === 1) bogeys++;
      else doubles++;
    });
  }
  return { totalHoles, eagles, birdies, pars, bogeys, doubles };
}

// --- screen ---

export default function StatsScreen() {
  const { user } = useAuth();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [udiscNames, setUdiscNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('courses');

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getRoundsImportedBy(user.uid),
      getUserProfile(user.uid),
    ]).then(([r, profile]) => {
      setRounds(r);
      const names = profile?.udiscNames
        ?? ((profile as any)?.udiscName ? [(profile as any).udiscName] : []);
      setUdiscNames(names);
    }).finally(() => setLoading(false));
  }, [user]);

  const myRounds = useMemo(
    () => rounds.filter(r => r.players.some(p => udiscNames.includes(p.name))),
    [rounds, udiscNames],
  );

  const myScores = useMemo(() =>
    myRounds.flatMap(r => {
      const me = r.players.find(p => udiscNames.includes(p.name));
      return me?.relativeToPar != null ? [me.relativeToPar] : [];
    }),
    [myRounds, udiscNames],
  );

  const avgScore = myScores.length
    ? myScores.reduce((a, b) => a + b, 0) / myScores.length
    : null;
  const bestScore = myScores.length ? Math.min(...myScores) : null;

  const courseStats = useMemo(() => computeCourseStats(rounds, udiscNames), [rounds, udiscNames]);
  const h2hStats = useMemo(() => computeH2H(rounds, udiscNames), [rounds, udiscNames]);
  const scoringStats = useMemo(() => computeScoring(rounds, udiscNames), [rounds, udiscNames]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#3db56b" size="large" />
      </View>
    );
  }

  const noIdentity = udiscNames.length === 0;
  const noData = myRounds.length === 0;

  const SECTIONS: { key: Section; label: string }[] = [
    { key: 'courses', label: 'Courses' },
    { key: 'h2h', label: 'Head to Head' },
    { key: 'scoring', label: 'Scoring' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Summary strip */}
      <View style={styles.summaryRow}>
        {[
          { label: 'ROUNDS', value: String(myRounds.length) },
          { label: 'AVG', value: avgScore != null ? fmtRel(avgScore, 1) : '—', color: avgScore != null ? relColor(avgScore) : '#3db56b' },
          { label: 'BEST', value: bestScore != null ? fmtRel(bestScore) : '—', color: bestScore != null ? relColor(bestScore) : '#3db56b' },
          { label: 'COURSES', value: String(courseStats.length) },
        ].map((item, i, arr) => (
          <View key={item.label} style={[styles.summaryCell, i < arr.length - 1 && styles.summaryCellBorder]}>
            <Text style={[styles.summaryCellValue, item.color ? { color: item.color } : null]}>
              {item.value}
            </Text>
            <Text style={styles.summaryCellLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Segment control */}
      <View style={styles.segRow}>
        {SECTIONS.map(s => (
          <TouchableOpacity
            key={s.key}
            style={[styles.segBtn, section === s.key && styles.segBtnActive]}
            onPress={() => setSection(s.key)}
          >
            <Text style={[styles.segBtnText, section === s.key && styles.segBtnTextActive]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {noIdentity ? (
        <EmptyState
          icon="👤"
          title="Set your UDisc name"
          subtitle="Open ☰ and add your UDisc display name to see your stats."
        />
      ) : noData ? (
        <EmptyState
          icon="⛳"
          title="No rounds yet"
          subtitle="Import rounds from UDisc via ☰ to see your stats."
        />
      ) : section === 'courses' ? (
        <CoursesSection stats={courseStats} />
      ) : section === 'h2h' ? (
        <H2HSection entries={h2hStats} />
      ) : (
        <ScoringSection stats={scoringStats} roundCount={myRounds.length} />
      )}
    </ScrollView>
  );
}

// --- sub-sections ---

function CoursesSection({ stats }: { stats: CourseStats[] }) {
  if (stats.length === 0) {
    return <EmptyState icon="🗺️" title="No course data" subtitle="No rounds with your scores found." />;
  }
  return (
    <View style={styles.list}>
      {stats.map(c => (
        <View key={c.courseName} style={styles.card}>
          <Text style={styles.cardTitle} numberOfLines={1}>{c.courseName}</Text>
          {c.layouts.length > 0 && (
            <Text style={styles.cardSub} numberOfLines={1}>{c.layouts.join(' · ')}</Text>
          )}
          <CourseScoreChart history={c.history} />
          <View style={styles.threeStats}>
            <ThreeStat label="Rounds" value={String(c.rounds)} />
            <ThreeStat
              label="Avg"
              value={fmtRel(c.avgRelToPar, 1)}
              color={relColor(c.avgRelToPar)}
            />
            <ThreeStat
              label="Best"
              value={fmtRel(c.bestRelToPar)}
              color={relColor(c.bestRelToPar)}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const CHART_HALF_H = 36;

function CourseScoreChart({ history }: { history: CourseRound[] }) {
  if (history.length === 0) return null;

  const values = history.map(h => h.relToPar);
  const absMax = Math.max(...values.map(v => Math.abs(v)), 1);
  const pixPerUnit = CHART_HALF_H / absMax;

  return (
    <View style={styles.chartWrap}>
      {/* Y-axis label */}
      <View style={styles.chartYAxis}>
        <Text style={styles.chartYLabel}>+</Text>
        <Text style={styles.chartELabel}>E</Text>
        <Text style={styles.chartYLabel}>−</Text>
      </View>

      {/* Bars */}
      <View style={styles.chartBarsArea}>
        <View style={styles.chartBars}>
          {history.map((h, i) => {
            const v = h.relToPar;
            const barH = v !== 0 ? Math.max(4, Math.abs(v) * pixPerUnit) : 0;

            return (
              <View key={i} style={styles.chartBarSlot}>
                {/* Top half: under-par bars grow up from baseline */}
                <View style={styles.chartTopHalf}>
                  {v < 0 && (
                    <View style={[styles.chartBarUnder, { height: barH }]} />
                  )}
                </View>

                {/* Baseline */}
                <View style={[styles.chartBaseline, v === 0 && styles.chartBaselineEven]} />

                {/* Bottom half: over-par bars grow down from baseline */}
                <View style={styles.chartBottomHalf}>
                  {v > 0 && (
                    <View style={[styles.chartBarOver, { height: barH }]} />
                  )}
                  {v === 0 && (
                    <View style={styles.chartBarEven} />
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Score labels below bars */}
        <View style={styles.chartLabels}>
          {history.map((h, i) => (
            <Text
              key={i}
              style={[styles.chartLabel, { color: relColor(h.relToPar) }]}
              numberOfLines={1}
            >
              {h.relToPar === 0 ? 'E' : h.relToPar > 0 ? `+${h.relToPar}` : `${h.relToPar}`}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

function H2HSection({ entries }: { entries: H2HEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon="🤝"
        title="No opponents yet"
        subtitle="Play with other players in the same round and they'll appear here."
      />
    );
  }
  return (
    <View style={styles.list}>
      {entries.map(e => {
        const winning = e.myAvgRel < e.theirAvgRel;
        const losing = e.myAvgRel > e.theirAvgRel;
        const winRate = e.rounds > 0 ? Math.round((e.wins / e.rounds) * 100) : 0;
        return (
          <View key={e.opponentName} style={styles.card}>
            <View style={styles.h2hHeader}>
              <Text style={styles.cardTitle} numberOfLines={1}>{e.opponentName}</Text>
              <Text style={styles.h2hRoundCount}>{e.rounds} {e.rounds === 1 ? 'round' : 'rounds'}</Text>
            </View>

            {/* W-L-T + win rate */}
            <View style={styles.h2hRecordRow}>
              <View style={[styles.h2hChip, styles.h2hChipWin]}>
                <Text style={styles.h2hChipText}>{e.wins}W</Text>
              </View>
              <View style={[styles.h2hChip, styles.h2hChipLoss]}>
                <Text style={styles.h2hChipText}>{e.losses}L</Text>
              </View>
              {e.ties > 0 && (
                <View style={[styles.h2hChip, styles.h2hChipTie]}>
                  <Text style={styles.h2hChipText}>{e.ties}T</Text>
                </View>
              )}
              <Text style={styles.h2hWinRate}>{winRate}% win rate</Text>
            </View>

            {/* Avg scores */}
            <View style={styles.h2hAvgRow}>
              <View style={styles.h2hAvgCol}>
                <Text style={[styles.h2hAvgVal, { color: winning ? '#3b82f6' : losing ? '#f97316' : '#fff' }]}>
                  {fmtRel(e.myAvgRel, 1)}
                </Text>
                <Text style={styles.h2hAvgLabel}>You (avg)</Text>
              </View>
              <View style={styles.h2hDivider} />
              <View style={styles.h2hAvgCol}>
                <Text style={[styles.h2hAvgVal, { color: losing ? '#3b82f6' : winning ? '#f97316' : '#fff' }]}>
                  {fmtRel(e.theirAvgRel, 1)}
                </Text>
                <Text style={styles.h2hAvgLabel}>{e.opponentName.split(' ')[0]} (avg)</Text>
              </View>
              <View style={styles.h2hDivider} />
              <View style={styles.h2hAvgCol}>
                <Text style={[styles.h2hAvgVal, { color: relColor(e.myAvgRel - e.theirAvgRel) }]}>
                  {fmtRel(e.myAvgRel - e.theirAvgRel, 1)}
                </Text>
                <Text style={styles.h2hAvgLabel}>Edge</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ScoringSection({ stats, roundCount }: { stats: ScoringBreakdown; roundCount: number }) {
  const { totalHoles, eagles, birdies, pars, bogeys, doubles } = stats;
  const underPar = eagles + birdies;
  const overPar = bogeys + doubles;

  const rows = [
    { label: 'Eagle or better', count: eagles, color: '#1d4ed8' },
    { label: 'Birdie', count: birdies, color: '#3b82f6' },
    { label: 'Par', count: pars, color: '#8fb89a' },
    { label: 'Bogey', count: bogeys, color: '#f97316' },
    { label: 'Double+', count: doubles, color: '#ef4444' },
  ];

  return (
    <View style={styles.list}>
      {/* Meta */}
      <View style={[styles.card, styles.scoringMetaCard]}>
        <View style={styles.scoringMetaItem}>
          <Text style={styles.scoringMetaVal}>{roundCount}</Text>
          <Text style={styles.scoringMetaLabel}>ROUNDS</Text>
        </View>
        <View style={styles.scoringMetaDivider} />
        <View style={styles.scoringMetaItem}>
          <Text style={styles.scoringMetaVal}>{totalHoles}</Text>
          <Text style={styles.scoringMetaLabel}>HOLES</Text>
        </View>
        <View style={styles.scoringMetaDivider} />
        <View style={styles.scoringMetaItem}>
          <Text style={[styles.scoringMetaVal, { color: '#3b82f6' }]}>
            {totalHoles > 0 ? ((underPar / totalHoles) * 100).toFixed(1) : '0'}%
          </Text>
          <Text style={styles.scoringMetaLabel}>BIRDIE+</Text>
        </View>
        <View style={styles.scoringMetaDivider} />
        <View style={styles.scoringMetaItem}>
          <Text style={[styles.scoringMetaVal, { color: '#f97316' }]}>
            {totalHoles > 0 ? ((overPar / totalHoles) * 100).toFixed(1) : '0'}%
          </Text>
          <Text style={styles.scoringMetaLabel}>OVER PAR</Text>
        </View>
      </View>

      {/* Breakdown */}
      <View style={styles.card}>
        <Text style={styles.cardSectionLabel}>Score breakdown</Text>
        {rows.map(row => (
          <View key={row.label} style={styles.scoringRow}>
            <Text style={styles.scoringRowLabel}>{row.label}</Text>
            <View style={styles.scoringBarTrack}>
              {row.count > 0 && (
                <View style={[styles.scoringBarFill, { flex: row.count, backgroundColor: row.color }]} />
              )}
              {totalHoles - row.count > 0 && (
                <View style={{ flex: totalHoles - row.count }} />
              )}
            </View>
            <Text style={[styles.scoringRowCount, { color: row.color }]}>{row.count}</Text>
            <Text style={styles.scoringRowPct}>
              {totalHoles > 0 ? ((row.count / totalHoles) * 100).toFixed(1) : '0'}%
            </Text>
          </View>
        ))}

        {/* Aggregate bar */}
        {totalHoles > 0 && (
          <View style={styles.aggBar}>
            {underPar > 0 && (
              <View style={[styles.aggBarSeg, { flex: underPar, backgroundColor: '#3b82f6' }]}>
                <Text style={styles.aggBarText}>{underPar}</Text>
              </View>
            )}
            {pars > 0 && (
              <View style={[styles.aggBarSeg, { flex: pars, backgroundColor: '#2d5a3d' }]}>
                <Text style={styles.aggBarText}>{pars}</Text>
              </View>
            )}
            {bogeys > 0 && (
              <View style={[styles.aggBarSeg, { flex: bogeys, backgroundColor: 'rgba(249,115,22,0.7)' }]}>
                <Text style={styles.aggBarText}>{bogeys}</Text>
              </View>
            )}
            {doubles > 0 && (
              <View style={[styles.aggBarSeg, { flex: doubles, backgroundColor: 'rgba(239,68,68,0.7)' }]}>
                <Text style={styles.aggBarText}>{doubles}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

// --- shared small components ---

function ThreeStat({ label, value, color = '#fff' }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.threeStatItem}>
      <Text style={[styles.threeStatValue, { color }]}>{value}</Text>
      <Text style={styles.threeStatLabel}>{label}</Text>
    </View>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

// --- styles ---

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f2419' },
  content: { padding: 16, gap: 14 },
  centered: { flex: 1, backgroundColor: '#0f2419', alignItems: 'center', justifyContent: 'center' },

  // Summary strip
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: '#1e3a2a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    overflow: 'hidden',
  },
  summaryCell: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  summaryCellBorder: { borderRightWidth: 1, borderRightColor: '#2d5a3d' },
  summaryCellValue: { fontSize: 18, fontWeight: '800', color: '#3db56b' },
  summaryCellLabel: { fontSize: 9, color: '#8fb89a', marginTop: 2, fontWeight: '600' },

  // Segment control
  segRow: {
    flexDirection: 'row',
    backgroundColor: '#1e3a2a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    padding: 3,
    gap: 3,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  segBtnActive: { backgroundColor: '#3db56b' },
  segBtnText: { fontSize: 12, fontWeight: '600', color: '#8fb89a' },
  segBtnTextActive: { color: '#fff' },

  // Cards
  list: { gap: 10 },
  card: {
    backgroundColor: '#1e3a2a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    padding: 14,
    gap: 6,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cardSub: { fontSize: 12, color: '#8fb89a' },
  cardSectionLabel: { fontSize: 12, fontWeight: '700', color: '#8fb89a', marginBottom: 6 },

  // Three-stat row (courses)
  threeStats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#2d5a3d',
    paddingTop: 10,
    marginTop: 4,
  },
  threeStatItem: { flex: 1, alignItems: 'center' },
  threeStatValue: { fontSize: 17, fontWeight: '800' },
  threeStatLabel: { fontSize: 10, color: '#8fb89a', marginTop: 2, fontWeight: '600' },

  // H2H
  h2hHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h2hRoundCount: { fontSize: 12, color: '#8fb89a' },
  h2hRecordRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  h2hChip: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  h2hChipWin: { backgroundColor: '#1a5c34' },
  h2hChipLoss: { backgroundColor: '#5c1a1a' },
  h2hChipTie: { backgroundColor: '#2d5a3d' },
  h2hChipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  h2hWinRate: { marginLeft: 'auto' as any, fontSize: 12, color: '#8fb89a' },
  h2hAvgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#2d5a3d',
    paddingTop: 10,
    marginTop: 2,
  },
  h2hAvgCol: { flex: 1, alignItems: 'center' },
  h2hAvgVal: { fontSize: 20, fontWeight: '800' },
  h2hAvgLabel: { fontSize: 11, color: '#8fb89a', marginTop: 2, fontWeight: '600' },
  h2hDivider: { width: 1, height: 36, backgroundColor: '#2d5a3d' },

  // Scoring meta card
  scoringMetaCard: { flexDirection: 'row', gap: 0 },
  scoringMetaItem: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  scoringMetaDivider: { width: 1, backgroundColor: '#2d5a3d' },
  scoringMetaVal: { fontSize: 18, fontWeight: '800', color: '#3db56b' },
  scoringMetaLabel: { fontSize: 9, color: '#8fb89a', marginTop: 2, fontWeight: '600' },

  // Scoring breakdown rows
  scoringRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  scoringRowLabel: { width: 108, color: '#8fb89a', fontSize: 13 },
  scoringBarTrack: {
    flex: 1,
    height: 8,
    flexDirection: 'row',
    backgroundColor: '#0f2419',
    borderRadius: 4,
    overflow: 'hidden',
  },
  scoringBarFill: { borderRadius: 4 },
  scoringRowCount: { width: 32, textAlign: 'right', fontSize: 13, fontWeight: '700' },
  scoringRowPct: { width: 46, textAlign: 'right', color: '#8fb89a', fontSize: 12 },

  // Aggregate bar
  aggBar: {
    height: 30,
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    gap: 2,
    marginTop: 8,
  },
  aggBarSeg: { alignItems: 'center', justifyContent: 'center', minWidth: 18 },
  aggBarText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Empty state
  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  emptySub: { fontSize: 13, color: '#8fb89a', textAlign: 'center', paddingHorizontal: 24 },

  // Course score chart
  chartWrap: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 4,
  },
  chartYAxis: {
    width: 14,
    height: CHART_HALF_H * 2 + 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  chartYLabel: { fontSize: 9, color: '#4a7a5a', fontWeight: '700' },
  chartELabel: { fontSize: 9, color: '#4a7a5a', fontWeight: '700' },
  chartBarsArea: { flex: 1, gap: 3 },
  chartBars: {
    flexDirection: 'row',
    height: CHART_HALF_H * 2 + 1,
  },
  chartBarSlot: { flex: 1, paddingHorizontal: 1 },
  chartTopHalf: {
    height: CHART_HALF_H,
    justifyContent: 'flex-end',
  },
  chartBaseline: { height: 1, backgroundColor: '#2d5a3d' },
  chartBaselineEven: { backgroundColor: '#8fb89a' },
  chartBottomHalf: { height: CHART_HALF_H },
  chartBarUnder: {
    width: '100%',
    backgroundColor: '#3b82f6',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  chartBarOver: {
    width: '100%',
    backgroundColor: '#f97316',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  chartBarEven: {
    width: '100%',
    height: 3,
    backgroundColor: '#8fb89a',
    borderRadius: 2,
  },
  chartLabels: { flexDirection: 'row' },
  chartLabel: {
    flex: 1,
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
});
