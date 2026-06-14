import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import axios from "axios";
import * as cheerio from "cheerio";
import type {AnyNode} from "domhandler";

// admin is initialized in index.ts
const getDb = () => admin.firestore();

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Referer": "https://www.pdga.com/",
};

interface RoundScore {
  round: number;
  total: number;
  par: number | null;
  relativeToPar: number | null;
  holes: (number | null)[];
  holePars: (number | null)[];
  rating: number | null;
}

interface PDGAEvent {
  tournId: string;
  name: string;
  date: string;
  tier: string;
  division: string;
  place: string | null;
  rounds: RoundScore[];
  totalRelToPar: number | null;
}

interface PDGATournamentResult extends PDGAEvent {
  syncedAt?: admin.firestore.FieldValue;
}

interface ColMap {
  roundIdxs: number[];
  diffIdx: number | null;
}

// Date patterns PDGA uses: "01-Apr-2025", "04/01/2025", "2025-04-01"
const DATE_RE =
  /^\d{1,2}-\w{3,}-\d{4}$|^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/;

// Tier codes used by PDGA
const TIER_RE = /^(XS|ES|M|A|B|C|L|NT|BM|J|EX)$/i;

// Division codes used by PDGA
const DIV_RE = /^(MPO|FPO|MA\d|FA\d|MJ|FJ|MC|FC)/i;

/**
 * Builds a column map from a table's thead row.
 * @param {cheerio.CheerioAPI} $ - The Cheerio instance.
 * @param {cheerio.Cheerio<cheerio.AnyNode>} table - The table element.
 * @return {ColMap} Column index map for rounds and +/-.
 */
function buildColMap(
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<AnyNode>
): ColMap {
  const roundIdxs: number[] = [];
  let diffIdx: number | null = null;

  table.find("thead tr").first().find("th, td").each((i, th) => {
    const text = $(th).text().trim().toLowerCase();
    // Match "Rd 1", "R1", "Round 1", etc.
    if (/^(rd\.?\s*\d+|r\d+|round\s*\d+)$/.test(text)) {
      roundIdxs.push(i);
    }
    if (/^\+\/-$|^diff$/.test(text)) {
      diffIdx = i;
    }
  });

  return {roundIdxs, diffIdx};
}

/**
 * Parses a +/- string from PDGA ("E", "+5", "-3") to a number.
 * @param {string} text - The text to parse.
 * @return {number | null} The numeric value, or null if unparseable.
 */
function parseDiff(text: string): number | null {
  const t = text.trim();
  if (t === "E" || t === "0") return 0;
  const n = parseInt(t.replace("+", ""));
  return isNaN(n) ? null : n;
}

/**
 * Fetches tournament history for a PDGA player.
 * @param {string} pdgaNumber - The player's PDGA number.
 * @return {Promise<PDGAEvent[]>} List of tournament events.
 */
async function fetchPlayerEvents(
  pdgaNumber: string
): Promise<PDGAEvent[]> {
  const url = `https://www.pdga.com/player/${pdgaNumber}/details`;
  const {data} = await axios.get(url, {
    headers: HEADERS, timeout: 15000,
  });
  const $ = cheerio.load(data);

  // Find the first table containing tournament event links
  let targetTable = $("table").filter((_, t) =>
    $(t).find("a[href*='/tour/event/']").length > 0
  ).first();

  if (!targetTable.length) {
    targetTable = $("table.views-table").first();
  }

  const colMap = buildColMap($, targetTable);

  const events: PDGAEvent[] = [];

  targetTable.find("tbody tr").each((_, row) => {
    const link = $(row).find("a[href*='/tour/event/']").first();
    const href = link.attr("href") ?? "";
    const match = href.match(/\/tour\/event\/(\d+)/);
    if (!match) return;

    const tds = $(row).find("td").toArray();
    const texts = tds.map((td) => $(td).text().trim());

    const date = texts.find((t) => DATE_RE.test(t)) ?? "";
    const tier = texts.find((t) => TIER_RE.test(t)) ?? "";
    const division = texts.find((t) => DIV_RE.test(t)) ?? "";

    // Place: first small integer (place is rarely > 500)
    const place =
      texts.find((t) => /^\d+$/.test(t) && parseInt(t) <= 500) ?? null;

    let rounds: RoundScore[] = [];
    let totalRelToPar: number | null = null;

    const emptyRound = (n: number, total: number): RoundScore => ({
      round: n, total,
      par: null, relativeToPar: null,
      holes: [], holePars: [], rating: null,
    });

    if (colMap.roundIdxs.length > 0) {
      // Use header-derived column indices
      rounds = colMap.roundIdxs
        .map((idx, i) => {
          const score = parseInt($(tds[idx]).text().trim());
          if (isNaN(score)) return null;
          return emptyRound(i + 1, score);
        })
        .filter((r): r is RoundScore => r !== null);

      if (colMap.diffIdx != null && tds[colMap.diffIdx]) {
        totalRelToPar = parseDiff($(tds[colMap.diffIdx]).text());
      }
    } else {
      // Fallback: find round scores by position relative to division col
      const divIdx = texts.findIndex((t) => DIV_RE.test(t));
      if (divIdx >= 0 && tds.length > divIdx + 4) {
        // Tail: Total | +/- | Points | Rating [| Fav]
        const lastIsNonNumeric = !/^\d/.test(texts[texts.length - 1]);
        const offset = lastIsNonNumeric ? 1 : 0;
        // 4 trailing cols: Total, +/-, Points, Rating
        const tailStart = tds.length - 4 - offset;
        totalRelToPar = parseDiff(texts[tailStart + 1] ?? "");
        // Round cells are between division and Total
        for (let i = divIdx + 1; i < tailStart; i++) {
          const score = parseInt(texts[i]);
          if (!isNaN(score)) {
            rounds.push(emptyRound(rounds.length + 1, score));
          }
        }
      }
    }

    events.push({
      tournId: match[1],
      name: link.text().trim(),
      date, tier, division, place, rounds, totalRelToPar,
    });
  });

  return events;
}

/**
 * Fetches hole pars for a PDGA event via the live scoring API.
 * @param {string} tournId - The PDGA tournament ID.
 * @param {string} division - The player's division.
 * @return {Promise<(number|null)[]>} Hole pars array (empty if unavailable).
 */
async function fetchHolePars(
  tournId: string,
  division: string
): Promise<(number | null)[]> {
  const base = "https://www.pdga.com/apps/tournament/live-api/index.cfm";
  const methods = [
    `${base}?method=getCoursesandLayouts&TournID=${tournId}`,
    `${base}?method=getCourseLayout&TournID=${tournId}&Division=${division}`,
    `${base}?method=getLayout&TournID=${tournId}&Division=${division}`,
  ];

  for (const url of methods) {
    try {
      const {data} = await axios.get(url, {
        headers: {...HEADERS, "Accept": "application/json"},
        timeout: 10000,
      });
      // Look for hole par data in various possible shapes
      const pars =
        data?.holes?.map((h: Record<string, unknown>) =>
          Number(h.Par ?? h.par ?? h.HolePar ?? h.holePar)
        ) ??
        data?.[0]?.holes?.map((h: Record<string, unknown>) =>
          Number(h.Par ?? h.par)
        ) ??
        data?.[0]?.Holes?.map((h: Record<string, unknown>) =>
          Number(h.Par ?? h.par)
        );

      if (Array.isArray(pars) && pars.length > 0 &&
          pars.every((p) => p > 0)) {
        return pars;
      }
    } catch {
      // Try next method
    }
  }
  return [];
}

/**
 * Fetches round scores from the PDGA live API and event page.
 * @param {string} tournId - The PDGA tournament ID.
 * @param {string} pdgaNumber - The player's PDGA number.
 * @param {string} division - The player's division (e.g. MPO).
 * @return {Promise<RoundScore[]>} List of round scores.
 */
async function fetchEventRounds(
  tournId: string,
  pdgaNumber: string,
  division: string
): Promise<RoundScore[]> {
  const base = "https://www.pdga.com/apps/tournament/live-api/index.cfm";

  // Fetch hole pars in parallel with scores
  const [holeParsResult, scoreData] = await Promise.allSettled([
    fetchHolePars(tournId, division),
    axios.get(
      `${base}?method=getGroupsandScores&TournID=${tournId}` +
      `&Division=${division}`,
      {
        headers: {...HEADERS, "Accept": "application/json"},
        timeout: 15000,
      }
    ),
  ]);

  const holePars: (number | null)[] =
    holeParsResult.status === "fulfilled" ? holeParsResult.value : [];
  const sumPars = (arr: (number | null)[]): number =>
    arr.reduce((s: number, p) => s + (p ?? 0), 0);
  const coursePar: number | null =
    holePars.length > 0 ? sumPars(holePars) : null;

  if (scoreData.status === "fulfilled") {
    const data = scoreData.value.data;
    const roundsData = Array.isArray(data) ? data : (data?.rounds ?? []);
    const rounds: RoundScore[] = [];

    for (const entry of roundsData) {
      const roundNum: number = entry.Round ?? entry.round;
      // Hole pars may also be in the round entry
      const entryPars: (number | null)[] = holePars.length > 0 ?
        holePars :
        (entry.HolePars ?? entry.holePars ?? []).map(Number);
      const entryCoursePar: number | null = entryPars.length > 0 ?
        sumPars(entryPars) : coursePar;

      const groups = entry.Groups ?? entry.groups ?? [];
      for (const group of groups) {
        const players = group.Players ?? group.players ?? [];
        const me = players.find(
          (p: Record<string, unknown>) =>
            String(p.PDGANum ?? p.pdgaNum) === pdgaNumber
        );
        if (!me) continue;

        const holeScores: (number | null)[] = (
          me.ScorecardHoles ?? me.scorecardHoles ?? []
        ).map((h: unknown) =>
          h == null || h === "" ? null : Number(h)
        );

        const total = Number(me.RoundScore ?? me.roundScore ?? 0);
        const rel = me.RunningTotal != null ?
          Number(me.RunningTotal) :
          (entryCoursePar != null ? total - entryCoursePar : null);

        rounds.push({
          round: roundNum,
          total,
          par: entryCoursePar,
          relativeToPar: rel,
          holes: holeScores,
          holePars: entryPars,
          rating: me.RoundRating != null ?
            Number(me.RoundRating) : null,
        });
      }
    }
    if (rounds.length > 0) return rounds;
  }

  // HTML fallback: scrape event results page
  const eventUrl = `https://www.pdga.com/tour/event/${tournId}`;
  const {data: html} = await axios.get(eventUrl, {
    headers: HEADERS, timeout: 15000,
  });
  const $e = cheerio.load(html);

  const playerLink = $e(`a[href*="/player/${pdgaNumber}"]`).first();
  if (!playerLink.length) return [];

  const row = playerLink.closest("tr");
  const table = row.closest("table");
  const cm = buildColMap($e, table);
  const cells = row.find("td").toArray();

  if (cm.roundIdxs.length > 0) {
    return cm.roundIdxs.map((idx, i) => ({
      round: i + 1,
      total: parseInt($e(cells[idx]).text().trim()) || 0,
      par: coursePar,
      relativeToPar: null,
      holes: [],
      holePars,
      rating: null,
    }));
  }

  // Last resort
  const numericCells = cells
    .map((c) => parseInt($e(c).text().trim()))
    .filter((n) => !isNaN(n) && n > 10);

  if (numericCells.length > 0) {
    const total = numericCells[numericCells.length - 1];
    const rel = cm.diffIdx != null ?
      parseDiff($e(cells[cm.diffIdx]).text()) :
      (coursePar != null ? total - coursePar : null);
    return [{
      round: 1, total,
      par: coursePar, relativeToPar: rel,
      holes: [], holePars, rating: null,
    }];
  }

  return [];
}

export const syncPDGATournaments = onCall(
  {timeoutSeconds: 120, memory: "512MiB", invoker: "public"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const {pdgaNumber} = request.data as {pdgaNumber: string};
    if (!pdgaNumber || !/^\d+$/.test(pdgaNumber)) {
      throw new HttpsError("invalid-argument", "Invalid PDGA number");
    }

    const uid = request.auth.uid;

    let events: PDGAEvent[];
    try {
      events = await fetchPlayerEvents(pdgaNumber);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpsError(
        "internal",
        `Failed to fetch PDGA profile: ${msg}`
      );
    }

    if (events.length === 0) {
      return {synced: 0, message: "No tournament history found"};
    }

    // Process up to 20 most recent events to avoid timeout
    const recent = events.slice(0, 20);
    const results: PDGATournamentResult[] = [];

    for (const event of recent) {
      try {
        let {rounds} = event;
        // Only hit event page if details page had no round data
        if (rounds.length === 0) {
          rounds = await fetchEventRounds(
            event.tournId, pdgaNumber, event.division || "MPO"
          );
        }

        const result: PDGATournamentResult = {
          ...event, rounds,
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        results.push(result);

        await getDb()
          .collection("pdga_tournaments")
          .doc(uid)
          .collection("events")
          .doc(event.tournId)
          .set(result, {merge: true});
      } catch {
        // Skip events that fail, continue with others
      }
    }

    await getDb().collection("pdga_tournaments").doc(uid).set(
      {
        pdgaNumber,
        lastSynced: admin.firestore.FieldValue.serverTimestamp(),
        eventCount: events.length,
      },
      {merge: true}
    );

    return {synced: results.length, total: events.length};
  }
);
