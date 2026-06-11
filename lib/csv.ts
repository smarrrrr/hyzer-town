import type { PlayerScore, Round } from './types';

function slugify(courseName: string, startDate: string): string {
  return `${courseName}-${startDate}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseNum(val: string): number | null {
  const n = Number(val);
  return val.trim() === '' || isNaN(n) ? null : n;
}

interface RawRow {
  playerName: string;
  courseName: string;
  layoutName: string;
  startDate: string;
  endDate: string;
  total: number;
  relativeToPar: number | null;
  roundRating: number | null;
  holes: (number | null)[];
}

function parseRows(csv: string): RawRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  const holeStart = headers.indexOf('Hole1');
  if (holeStart === -1) throw new Error('Invalid UDisc CSV: missing Hole1 column');

  const rows: RawRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < holeStart) continue;

    const holes: (number | null)[] = [];
    for (let h = holeStart; h < headers.length; h++) {
      holes.push(parseNum(cols[h] ?? ''));
    }

    rows.push({
      playerName: cols[0]?.trim() ?? '',
      courseName: cols[1]?.trim() ?? '',
      layoutName: cols[2]?.trim() ?? '',
      startDate: cols[3]?.trim() ?? '',
      endDate: cols[4]?.trim() ?? '',
      total: Number(cols[5]) || 0,
      relativeToPar: parseNum(cols[6] ?? ''),
      roundRating: parseNum(cols[7] ?? ''),
      holes,
    });
  }

  return rows;
}

export function parseUDiscCSV(csv: string): Round[] {
  const rows = parseRows(csv);

  // Group by courseName + startDate
  const groups = new Map<string, RawRow[]>();
  for (const row of rows) {
    const key = `${row.courseName}|||${row.startDate}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const rounds: Round[] = [];

  for (const group of groups.values()) {
    const parRow = group.find(r => r.playerName === 'Par');
    const playerRows = group.filter(r => r.playerName !== 'Par');
    if (!playerRows.length) continue;

    const first = playerRows[0];
    const holeCount = (parRow?.holes ?? playerRows[0].holes).filter(h => h !== null).length;

    const pars = parRow ? parRow.holes.slice(0, holeCount) : Array(holeCount).fill(null);

    const players: PlayerScore[] = playerRows.map(r => ({
      name: r.playerName,
      total: r.total,
      relativeToPar: r.relativeToPar,
      roundRating: r.roundRating,
      holes: r.holes.slice(0, holeCount),
    }));

    rounds.push({
      id: slugify(first.courseName, first.startDate),
      courseName: first.courseName,
      layoutName: first.layoutName,
      startDate: first.startDate,
      endDate: first.endDate,
      pars,
      holeCount,
      players,
      importedBy: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  // Sort newest first
  return rounds.sort((a, b) => b.startDate.localeCompare(a.startDate));
}
