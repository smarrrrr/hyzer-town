import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Modal, ActivityIndicator, TouchableOpacity, Pressable, Dimensions,
} from 'react-native';
import { useAuth } from '@/lib/auth';
import { getRoundsImportedBy, getUserProfile } from '@/lib/rounds';
import type { Round, PlayerScore } from '@/lib/types';

// --- types ---

type Section = 'courses' | 'h2h' | 'scoring';
type DateFilter = 'all' | '1m' | '3m' | '6m' | '1y' | 'ytd' | 'custom';
interface MonthYear { month: number; year: number; }

interface CourseRound {
  date: string;
  relToPar: number;
  total: number;
  roundRating: number | null;
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

interface Bucket {
  key: string;
  label: string;
  avgRelToPar: number;
  rounds: number;
}

type Granularity = 'week' | 'month' | 'quarter' | 'year';

// --- helpers ---

function fmtRel(n: number, decimals = 0): string {
  const v = decimals > 0 ? parseFloat(n.toFixed(decimals)) : Math.round(n);
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : `${v}`;
}

function getBucketKey(dateStr: string, gran: Granularity): string {
  const d = new Date(dateStr.split(' ')[0]);
  switch (gran) {
    case 'week': {
      const day = d.getDay() || 7;
      d.setDate(d.getDate() + 4 - day);
      const ys = new Date(d.getFullYear(), 0, 1);
      const wk = Math.ceil(((d.getTime() - ys.getTime()) / 86400000 + 1) / 7);
      return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
    }
    case 'month': return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    case 'quarter': return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    case 'year': return `${d.getFullYear()}`;
  }
}

function bucketLabel(key: string, gran: Granularity): string {
  switch (gran) {
    case 'week': case 'month': {
      const d = new Date(key.replace(/-W\d+/, '-01-01').replace(/-Q\d/, '-01-01'));
      if (gran === 'month') {
        const [y, m] = key.split('-');
        return new Date(+y, +m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      }
      return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }
    case 'quarter': {
      const [y, q] = key.split('-Q');
      return `Q${q} '${y.slice(2)}`;
    }
    case 'year': return `'${key.slice(2)}`;
  }
}

function buildBuckets(rounds: Round[], udiscNames: string[], gran: Granularity): Bucket[] {
  const map = new Map<string, { sum: number; count: number }>();
  for (const r of [...rounds].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const me = r.players.find(p => udiscNames.includes(p.name));
    if (!me || me.relativeToPar == null) continue;
    const key = getBucketKey(r.startDate, gran);
    const existing = map.get(key);
    if (existing) { existing.sum += me.relativeToPar; existing.count++; }
    else { map.set(key, { sum: me.relativeToPar, count: 1 }); }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { sum, count }]) => ({
      key,
      label: bucketLabel(key, gran),
      avgRelToPar: sum / count,
      rounds: count,
    }));
}

const GRANS: Granularity[] = ['week', 'month', 'quarter', 'year'];
const MIN_SLOT_W = 3;

function pickBuckets(rounds: Round[], udiscNames: string[], availableW: number): Bucket[] {
  for (const gran of GRANS) {
    const b = buildBuckets(rounds, udiscNames, gran);
    if (b.length * MIN_SLOT_W <= availableW) return b;
  }
  return buildBuckets(rounds, udiscNames, 'year');
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr.split(' ')[0]);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
    existing.history.push({ date: round.startDate, relToPar: me.relativeToPar, total: me.total, roundRating: me.roundRating });
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

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getFilteredRounds(rounds: Round[], filter: DateFilter, from: MonthYear, to: MonthYear): Round[] {
  if (filter === 'all') return rounds;
  const now = new Date();
  let fromDate: Date;
  let toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  switch (filter) {
    case '1m':  fromDate = new Date(now); fromDate.setMonth(fromDate.getMonth() - 1); break;
    case '3m':  fromDate = new Date(now); fromDate.setMonth(fromDate.getMonth() - 3); break;
    case '6m':  fromDate = new Date(now); fromDate.setMonth(fromDate.getMonth() - 6); break;
    case '1y':  fromDate = new Date(now); fromDate.setFullYear(fromDate.getFullYear() - 1); break;
    case 'ytd': fromDate = new Date(now.getFullYear(), 0, 1); break;
    case 'custom':
      fromDate = new Date(from.year, from.month, 1);
      toDate   = new Date(to.year, to.month + 1, 0, 23, 59, 59);
      break;
    default: return rounds;
  }

  return rounds.filter(r => {
    const d = new Date(r.startDate.split(' ')[0]);
    return d >= fromDate && d <= toDate;
  });
}

function MonthPicker({ value, onChange, label }: { value: MonthYear; onChange: (v: MonthYear) => void; label: string }) {
  return (
    <View style={styles.mpWrap}>
      <Text style={styles.mpLabel}>{label}</Text>
      <View style={styles.mpMonths}>
        {MONTHS_SHORT.map((m, i) => (
          <TouchableOpacity
            key={m}
            style={[styles.mpMonth, value.month === i && styles.mpMonthActive]}
            onPress={() => onChange({ ...value, month: i })}
          >
            <Text style={[styles.mpMonthText, value.month === i && styles.mpMonthTextActive]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.mpYearRow}>
        <TouchableOpacity style={styles.mpYearBtn} onPress={() => onChange({ ...value, year: value.year - 1 })}>
          <Text style={styles.mpYearArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.mpYearText}>{value.year}</Text>
        <TouchableOpacity style={styles.mpYearBtn} onPress={() => onChange({ ...value, year: value.year + 1 })}>
          <Text style={styles.mpYearArrow}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// --- screen ---

export default function StatsScreen() {
  const { user } = useAuth();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [udiscNames, setUdiscNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('courses');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const nowForInit = new Date();
  const [customFrom, setCustomFrom] = useState<MonthYear>({ month: nowForInit.getMonth(), year: nowForInit.getFullYear() - 1 });
  const [customTo, setCustomTo]     = useState<MonthYear>({ month: nowForInit.getMonth(), year: nowForInit.getFullYear() });
  const [customOpen, setCustomOpen] = useState(false);
  const [tempFrom, setTempFrom] = useState<MonthYear>(customFrom);
  const [tempTo, setTempTo]     = useState<MonthYear>(customTo);

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

  const filteredRounds = useMemo(
    () => getFilteredRounds(rounds, dateFilter, customFrom, customTo),
    [rounds, dateFilter, customFrom, customTo],
  );

  const myRounds = useMemo(
    () => filteredRounds.filter(r => r.players.some(p => udiscNames.includes(p.name))),
    [filteredRounds, udiscNames],
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

  const allMyRounds = useMemo(
    () => rounds.filter(r => r.players.some(p => udiscNames.includes(p.name))),
    [rounds, udiscNames],
  );

  const courseStats = useMemo(() => computeCourseStats(filteredRounds, udiscNames), [filteredRounds, udiscNames]);
  const h2hStats    = useMemo(() => computeH2H(filteredRounds, udiscNames),         [filteredRounds, udiscNames]);
  const scoringStats = useMemo(() => computeScoring(filteredRounds, udiscNames),    [filteredRounds, udiscNames]);

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

  const DATE_FILTERS: { key: DateFilter; label: string }[] = [
    { key: 'all',    label: 'All time' },
    { key: '1m',     label: 'Last month' },
    { key: '3m',     label: '3 months' },
    { key: '6m',     label: '6 months' },
    { key: '1y',     label: '1 year' },
    { key: 'ytd',    label: 'Year to date' },
    {
      key: 'custom',
      label: dateFilter === 'custom'
        ? `${MONTHS_SHORT[customFrom.month]} ${customFrom.year} – ${MONTHS_SHORT[customTo.month]} ${customTo.year}`
        : 'Custom…',
    },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Custom date range modal */}
      <Modal visible={customOpen} transparent animationType="fade" onRequestClose={() => setCustomOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Custom Date Range</Text>
            <MonthPicker label="From" value={tempFrom} onChange={setTempFrom} />
            <MonthPicker label="To"   value={tempTo}   onChange={setTempTo} />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setCustomOpen(false)}>
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnApply}
                onPress={() => {
                  setCustomFrom(tempFrom);
                  setCustomTo(tempTo);
                  setDateFilter('custom');
                  setCustomOpen(false);
                }}
              >
                <Text style={styles.modalBtnApplyText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* All-time score history chart */}
      {allMyRounds.length > 0 && <AllRoundsChart rounds={allMyRounds} udiscNames={udiscNames} />}

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

      {/* Date filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {DATE_FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, dateFilter === f.key && styles.filterChipActive]}
            onPress={() => {
              if (f.key === 'custom') {
                setTempFrom(customFrom);
                setTempTo(customTo);
                setCustomOpen(true);
              } else {
                setDateFilter(f.key);
              }
            }}
          >
            <Text style={[styles.filterChipText, dateFilter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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

// card padding (16*2) + y-axis (14) + gap (6)
const CHART_H_INSET = 52;

function AllRoundsChart({ rounds, udiscNames }: { rounds: Round[]; udiscNames: string[] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [containerW, setContainerW] = useState(
    () => Math.max(1, Dimensions.get('window').width - CHART_H_INSET),
  );

  const buckets = useMemo(
    () => pickBuckets(rounds, udiscNames, containerW),
    [rounds, udiscNames, containerW],
  );

  if (buckets.length === 0) return null;

  const slotW = containerW / buckets.length;
  const absMax = buckets.length > 0 ? Math.max(...buckets.map(b => Math.abs(b.avgRelToPar)), 1) : 1;
  const pixPerUnit = CHART_HALF_H / absMax;

  const active = activeIdx != null ? buckets[activeIdx] : null;

  const trendHistory = buckets.map(b => ({ date: b.key, relToPar: b.avgRelToPar, total: b.rounds, roundRating: null }));
  const trendPts = slotW > 0 ? buildTrendPoints(trendHistory, slotW, pixPerUnit) : [];

  const barCenterX = activeIdx != null ? (activeIdx + 0.5) * slotW : 0;
  const tooltipLeft = containerW > 0
    ? Math.max(0, Math.min(barCenterX - TOOLTIP_W / 2, containerW - TOOLTIP_W))
    : 0;
  const caretLeft = Math.max(8, Math.min(barCenterX - tooltipLeft - 5, TOOLTIP_W - 18));

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Score History</Text>
      <View>
        <View style={styles.chartTooltipZone}>
          {active && containerW > 0 ? (
            <View pointerEvents="none" style={[styles.chartTooltip, { left: Y_OFFSET + tooltipLeft }]}>
              <Text style={styles.chartTooltipDate}>{active.label}</Text>
              <View style={styles.chartTooltipScoreRow}>
                <Text style={[styles.chartTooltipScore, { color: relColor(active.avgRelToPar) }]}>
                  {fmtRel(active.avgRelToPar, 1)} avg · {active.rounds} round{active.rounds !== 1 ? 's' : ''}
                </Text>
              </View>
              <View style={[styles.chartTooltipCaret, { left: caretLeft }]} />
            </View>
          ) : (
            <Text style={styles.chartHint}>tap a bar</Text>
          )}
        </View>

        <View style={styles.chartWrap}>
          <View style={styles.chartYAxis}>
            <Text style={styles.chartYLabel}>−</Text>
            <Text style={styles.chartELabel}>E</Text>
            <Text style={styles.chartYLabel}>+</Text>
          </View>
          <View
            style={[styles.chartBarsArea, { overflow: 'hidden' }]}
            onLayout={e => setContainerW(e.nativeEvent.layout.width)}
          >
            <View style={[styles.chartBars, { width: containerW }]}>
                {buckets.map((b, i) => {
                  const v = b.avgRelToPar;
                  const barH = v !== 0 ? Math.max(2, Math.abs(v) * pixPerUnit) : 0;
                  const isActive = i === activeIdx;
                  return (
                    <Pressable
                      key={b.key}
                      style={[styles.chartBarSlot, { width: slotW }, isActive && styles.chartBarSlotActive]}
                      onPressIn={() => setActiveIdx(i)}
                      onPressOut={() => setActiveIdx(null)}
                      onHoverIn={() => setActiveIdx(i)}
                      onHoverOut={() => setActiveIdx(null)}
                    >
                      <View style={styles.chartTopHalf}>
                        {v < 0 && <View style={[styles.chartBarUnder, { height: barH }]} />}
                      </View>
                      <View style={[styles.chartBaseline, v === 0 && styles.chartBaselineEven]} />
                      <View style={styles.chartBottomHalf}>
                        {v > 0 && <View style={[styles.chartBarOver, { height: barH }]} />}
                        {v === 0 && <View style={styles.chartBarEven} />}
                      </View>
                    </Pressable>
                  );
                })}
                {trendPts.length >= 2 && trendPts.slice(0, -1).map((p1, i) => {
                  const p2 = trendPts[i + 1];
                  const dx = p2.x - p1.x; const dy = p2.y - p1.y;
                  const len = Math.sqrt(dx * dx + dy * dy);
                  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                  return (
                    <View key={`t${i}`} pointerEvents="none" style={{
                      position: 'absolute', width: len, height: 2,
                      backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 1,
                      left: (p1.x + p2.x) / 2 - len / 2,
                      top: (p1.y + p2.y) / 2 - 1,
                      transform: [{ rotate: `${angle}deg` }],
                    }} />
                  );
                })}
              </View>
          </View>
        </View>
      </View>
    </View>
  );
}

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
              value={parseFloat(c.avgRelToPar.toFixed(1)).toString()}
              color={relColor(c.avgRelToPar)}
            />
            <ThreeStat
              label="Best"
              value={String(c.bestRelToPar)}
              color={relColor(c.bestRelToPar)}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const CHART_HALF_H = 36;
const TOOLTIP_W = 152;
const MIN_BAR_SLOT_W = 11;
const Y_OFFSET = 20; // y-axis width (14) + gap (6)

/** Moving-average trend points, sampled to at most maxPts for render performance. */
function buildTrendPoints(
  history: CourseRound[],
  slotW: number,
  pixPerUnit: number,
  maxPts = 80,
): Array<{ x: number; y: number }> {
  if (history.length < 2) return [];
  const raw = history.map(h => h.relToPar);
  const win = Math.max(3, Math.min(9, Math.floor(history.length / 8)));
  const smoothed = raw.map((_, i) => {
    const s = Math.max(0, i - Math.floor(win / 2));
    const e = Math.min(raw.length, s + win);
    const slice = raw.slice(s, e);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const step = Math.max(1, Math.ceil(history.length / maxPts));
  return smoothed
    .map((v, i) => ({ x: (i + 0.5) * slotW, y: CHART_HALF_H + v * pixPerUnit, keep: i % step === 0 || i === smoothed.length - 1 }))
    .filter(p => p.keep)
    .map(({ x, y }) => ({ x, y }));
}

function CourseScoreChart({ history }: { history: CourseRound[] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [containerW, setContainerW] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  if (history.length === 0) return null;

  const absMax = Math.max(...history.map(h => Math.abs(h.relToPar)), 1);
  const pixPerUnit = CHART_HALF_H / absMax;

  // Total scrollable content width — at least fills the visible area
  const contentW = containerW > 0
    ? Math.max(history.length * MIN_BAR_SLOT_W, containerW)
    : history.length * MIN_BAR_SLOT_W;
  const slotW = contentW / history.length;

  const active = activeIdx != null ? history[activeIdx] : null;

  // Trend line — recompute when slotW or pixPerUnit change (containerW drives slotW)
  const trendPts = buildTrendPoints(history, slotW, pixPerUnit);

  // Bar center in visible coordinates (accounts for scroll offset)
  const barVisibleX = activeIdx != null ? (activeIdx + 0.5) * slotW - scrollX : 0;
  const tooltipLeft = containerW > 0
    ? Math.max(0, Math.min(barVisibleX - TOOLTIP_W / 2, containerW - TOOLTIP_W))
    : 0;
  const caretLeft = Math.max(8, Math.min(barVisibleX - tooltipLeft - 5, TOOLTIP_W - 18));

  // Scroll to the most recent round (right edge) on first layout
  useEffect(() => {
    if (containerW > 0 && contentW > containerW) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerW > 0]);

  return (
    <View>
      {/* Reserved zone above the bars — tooltip floats here, caret points down */}
      <View style={styles.chartTooltipZone}>
        {active && containerW > 0 ? (
          <View
            pointerEvents="none"
            style={[styles.chartTooltip, { left: Y_OFFSET + tooltipLeft }]}
          >
            <Text style={styles.chartTooltipDate}>{fmtDate(active.date)}</Text>
            <View style={styles.chartTooltipScoreRow}>
              <Text style={[styles.chartTooltipScore, { color: relColor(active.relToPar) }]}>
                {fmtRel(active.relToPar)} ({active.total})
              </Text>
              {active.roundRating != null && (
                <View style={styles.chartTooltipRatingPill}>
                  <Text style={styles.chartTooltipRatingText}>✦{active.roundRating}</Text>
                </View>
              )}
            </View>
            <View style={[styles.chartTooltipCaret, { left: caretLeft }]} />
          </View>
        ) : (
          <Text style={styles.chartHint}>
            {`${history.length} round${history.length !== 1 ? 's' : ''}`}
          </Text>
        )}
      </View>

      {/* Y-axis + scrollable bars */}
      <View style={styles.chartWrap}>
        <View style={styles.chartYAxis}>
          <Text style={styles.chartYLabel}>−</Text>
          <Text style={styles.chartELabel}>E</Text>
          <Text style={styles.chartYLabel}>+</Text>
        </View>

        {/* Outer view measures the visible width for tooltip positioning */}
        <View
          style={styles.chartBarsArea}
          onLayout={e => setContainerW(e.nativeEvent.layout.width)}
        >
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={e => setScrollX(e.nativeEvent.contentOffset.x)}
            style={{ flex: 1 }}
          >
            {/* Single child so bars + labels stack vertically inside the horizontal scroll */}
            <View style={{ width: contentW, gap: 3 }}>
              <View style={[styles.chartBars, { width: contentW }]}>
                {history.map((h, i) => {
                  const v = h.relToPar;
                  const barH = v !== 0 ? Math.max(4, Math.abs(v) * pixPerUnit) : 0;
                  const isActive = i === activeIdx;
                  return (
                    <Pressable
                      key={i}
                      style={[styles.chartBarSlot, { width: slotW }, isActive && styles.chartBarSlotActive]}
                      onHoverIn={() => setActiveIdx(i)}
                      onHoverOut={() => setActiveIdx(null)}
                      onPressIn={() => setActiveIdx(i)}
                      onPressOut={() => setActiveIdx(null)}
                    >
                      <View style={styles.chartTopHalf}>
                        {v < 0 && <View style={[styles.chartBarUnder, { height: barH }]} />}
                      </View>
                      <View style={[styles.chartBaseline, v === 0 && styles.chartBaselineEven]} />
                      <View style={styles.chartBottomHalf}>
                        {v > 0 && <View style={[styles.chartBarOver, { height: barH }]} />}
                        {v === 0 && <View style={styles.chartBarEven} />}
                      </View>
                    </Pressable>
                  );
                })}

                {/* Trend line — moving-average path rendered as rotated segments */}
                {trendPts.length >= 2 && trendPts.slice(0, -1).map((p1, i) => {
                  const p2 = trendPts[i + 1];
                  const dx = p2.x - p1.x;
                  const dy = p2.y - p1.y;
                  const len = Math.sqrt(dx * dx + dy * dy);
                  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                  return (
                    <View
                      key={`t${i}`}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        width: len,
                        height: 2,
                        backgroundColor: 'rgba(255,255,255,0.55)',
                        borderRadius: 1,
                        left: (p1.x + p2.x) / 2 - len / 2,
                        top: (p1.y + p2.y) / 2 - 1,
                        transform: [{ rotate: `${angle}deg` }],
                      }}
                    />
                  );
                })}
              </View>

            </View>
          </ScrollView>
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
  // Fixed-height zone above the bars — tooltip floats inside, caret hangs below into the chart
  chartTooltipZone: {
    height: 56,
    overflow: 'visible' as any,
    justifyContent: 'flex-end',
    paddingBottom: 6,
  },
  chartHint: { color: '#4a7a5a', fontSize: 11, paddingLeft: 20 },
  chartWrap: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
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
  chartBarSlot: { paddingHorizontal: 1 },
  chartBarSlotActive: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3 },
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
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  chartLabelActive: { fontSize: 10 },

  // Floating bar tooltip
  chartTooltip: {
    position: 'absolute',
    bottom: 0,
    width: TOOLTIP_W,
    backgroundColor: '#142b1e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 3,
  },
  chartTooltipDate: { color: '#8fb89a', fontSize: 11 },
  chartTooltipScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chartTooltipScore: { fontSize: 14, fontWeight: '700' },
  chartTooltipRatingPill: {
    backgroundColor: '#0a1f3a',
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 'auto' as any,
  },
  chartTooltipRatingText: { color: '#93c5fd', fontSize: 11, fontWeight: '700' },
  // downward-pointing triangle via border trick
  // Date filter chips
  filterRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1e3a2a',
    borderWidth: 1,
    borderColor: '#2d5a3d',
  },
  filterChipActive: { backgroundColor: '#3db56b', borderColor: '#3db56b' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#8fb89a' },
  filterChipTextActive: { color: '#fff' },

  // Custom date range modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#142b1e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2d5a3d',
    padding: 20,
    gap: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#fff', textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtnCancel: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#1e3a2a', borderWidth: 1, borderColor: '#2d5a3d',
    alignItems: 'center',
  },
  modalBtnCancelText: { color: '#8fb89a', fontWeight: '600', fontSize: 15 },
  modalBtnApply: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#3db56b', alignItems: 'center',
  },
  modalBtnApplyText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // MonthPicker
  mpWrap: { gap: 8 },
  mpLabel: { fontSize: 12, fontWeight: '700', color: '#8fb89a' },
  mpMonths: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  mpMonth: {
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8,
    backgroundColor: '#1e3a2a', borderWidth: 1, borderColor: '#2d5a3d',
  },
  mpMonthActive: { backgroundColor: '#3db56b', borderColor: '#3db56b' },
  mpMonthText: { fontSize: 12, fontWeight: '600', color: '#8fb89a' },
  mpMonthTextActive: { color: '#fff' },
  mpYearRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  mpYearBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  mpYearArrow: { fontSize: 20, color: '#3db56b', fontWeight: '700' },
  mpYearText: { fontSize: 16, fontWeight: '700', color: '#fff', minWidth: 48, textAlign: 'center' },

  chartTooltipCaret: {
    position: 'absolute',
    bottom: -7,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent' as any,
    borderRightColor: 'transparent' as any,
    borderTopColor: '#2d5a3d',
  },
});
