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
  relativeToPar: number | null;
  holes: (number | null)[];
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

// Date patterns PDGA uses: "01-Apr-2025", "04/01/2025", "2025-04-01"
const DATE_RE =
  /^\d{1,2}-\w{3,}-\d{4}$|^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/;

// Tier codes used by PDGA
const TIER_RE = /^(XS|ES|M|A|B|C|L|NT|BM|J|EX)$/i;

// Division codes used by PDGA
const DIV_RE = /^(MPO|FPO|MA\d|FA\d|MJ|FJ|MC|FC)/i;

/**
 * Parses round scores from a player-details table row.
 * Row layout: Place|Points|Event|Tier|Date|Division|R1|R2|...|Total|+/-|Rating
 * @param {cheerio.CheerioAPI} $ - The Cheerio instance.
 * @param {cheerio.Element} row - The table row element.
 * @return {object} Parsed rounds and totalRelToPar.
 */
function parseRoundsFromRow(
  $: cheerio.CheerioAPI,
  row: AnyNode
): { rounds: RoundScore[]; totalRelToPar: number | null } {
  const tds = $(row).find("td").toArray();
  const texts = tds.map((td) => $(td).text().trim());

  // Find division cell index
  const divIdx = texts.findIndex((t) => DIV_RE.test(t));
  if (divIdx < 0 || tds.length <= divIdx + 3) {
    return {rounds: [], totalRelToPar: null};
  }

  // Last cells: ... | Total | +/- | Avg Rating [| Fav icon]
  // Fav column may be present as an icon td — detect by checking if
  // the last cell is not numeric (icon/empty).
  const lastText = texts[texts.length - 1];
  const trailingOffset = /^\d/.test(lastText) ? 0 : 1;
  const tailStart = tds.length - 3 - trailingOffset;

  // +/- is the second of the last-3 numeric cells
  const diffText = texts[tailStart + 1];
  const diffClean = diffText.replace("+", "");
  const totalRelToPar = diffClean === "E" ?
    0 : (parseInt(diffClean) || null);

  // Round score cells sit between division and the trailing cells
  const roundCells = tds.slice(divIdx + 1, tailStart);
  const rounds: RoundScore[] = [];
  roundCells.forEach((td, i) => {
    const score = parseInt($(td).text().trim());
    if (!isNaN(score)) {
      rounds.push({
        round: i + 1,
        total: score,
        relativeToPar: null,
        holes: [],
        rating: null,
      });
    }
  });

  return {rounds, totalRelToPar};
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
  const {data} = await axios.get(url, {headers: HEADERS, timeout: 15000});
  const $ = cheerio.load(data);

  const events: PDGAEvent[] = [];

  $("table.views-table tbody tr, table tbody tr").each((_, row) => {
    const link = $(row).find("a[href*='/tour/event/']").first();
    const href = link.attr("href") ?? "";
    const match = href.match(/\/tour\/event\/(\d+)/);
    if (!match) return;

    const texts = $(row).find("td").toArray()
      .map((td) => $(td).text().trim());

    const date = texts.find((t) => DATE_RE.test(t)) ?? "";
    const tier = texts.find((t) => TIER_RE.test(t)) ?? "";
    const division = texts.find((t) => DIV_RE.test(t)) ?? "";

    // Place: first small integer (place is rarely > 200)
    const place = texts
      .find((t) => /^\d+$/.test(t) && parseInt(t) <= 500) ?? null;

    const {rounds, totalRelToPar} = parseRoundsFromRow($, row);

    events.push({
      tournId: match[1],
      name: link.text().trim(),
      date,
      tier,
      division,
      place,
      rounds,
      totalRelToPar,
    });
  });

  return events;
}

/**
 * Fetches round scores from a PDGA event page as a fallback.
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
  // Try the live scoring API first (active/recent events)
  const apiUrl =
    "https://www.pdga.com/apps/tournament/live-api/index.cfm" +
    `?method=getGroupsandScores&TournID=${tournId}` +
    `&Division=${division}`;

  try {
    const {data} = await axios.get(apiUrl, {
      headers: {...HEADERS, "Accept": "application/json"},
      timeout: 15000,
    });
    const roundsData = Array.isArray(data) ? data : (data?.rounds ?? []);
    const rounds: RoundScore[] = [];

    for (const entry of roundsData) {
      const roundNum: number = entry.Round ?? entry.round;
      const groups = entry.Groups ?? entry.groups ?? [];
      for (const group of groups) {
        const players = group.Players ?? group.players ?? [];
        const me = players.find(
          (p: Record<string, unknown>) =>
            String(p.PDGANum ?? p.pdgaNum) === pdgaNumber
        );
        if (!me) continue;
        const holes: (number | null)[] = (
          me.ScorecardHoles ?? me.scorecardHoles ?? []
        ).map((h: unknown) =>
          h == null || h === "" ? null : Number(h)
        );
        rounds.push({
          round: roundNum,
          total: Number(me.RoundScore ?? me.roundScore ?? 0),
          relativeToPar: me.RunningTotal != null ?
            Number(me.RunningTotal) : null,
          holes,
          rating: me.RoundRating != null ? Number(me.RoundRating) : null,
        });
      }
    }
    if (rounds.length > 0) return rounds;
  } catch {
    // Fall through to HTML scrape
  }

  // HTML fallback: find player row via their profile link
  const eventUrl = `https://www.pdga.com/tour/event/${tournId}`;
  const {data: html} = await axios.get(eventUrl, {
    headers: HEADERS,
    timeout: 15000,
  });
  const $e = cheerio.load(html);

  const playerLink = $e(`a[href*="/player/${pdgaNumber}"]`).first();
  if (!playerLink.length) return [];

  const row = playerLink.closest("tr");
  const table = row.closest("table");

  // Determine round columns from thead
  const colHeaders: Array<{text: string; idx: number}> = [];
  table.find("thead tr").first().find("th, td").each((i, th) => {
    colHeaders.push({text: $e(th).text().trim(), idx: i});
  });

  const roundCols = colHeaders.filter((h) => /^R\d+$/i.test(h.text));
  const diffCol = colHeaders.find((h) => /^\+\/-$|^diff$/i.test(h.text));

  const cells = row.find("td").toArray();

  if (roundCols.length > 0) {
    return roundCols.map((col) => {
      const cell = cells[col.idx];
      const total = parseInt($e(cell).text().trim()) || 0;
      return {
        round: parseInt(col.text.replace(/R/i, "")),
        total,
        relativeToPar: null,
        holes: [],
        rating: null,
      };
    });
  }

  // Last resort: grab the total and +/-
  if (cells.length >= 2) {
    const diffText = diffCol ?
      $e(cells[diffCol.idx]).text().trim() : "";
    const diffVal = diffText.replace("+", "");
    return [{
      round: 1,
      total: parseInt($e(cells[cells.length - 1]).text().trim()) || 0,
      relativeToPar: diffVal === "E" ?
        0 : (parseInt(diffVal) || null),
      holes: [],
      rating: null,
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

        // Only fetch from event page if details page had no rounds
        if (rounds.length === 0) {
          rounds = await fetchEventRounds(
            event.tournId,
            pdgaNumber,
            event.division || "MPO"
          );
        }

        const result: PDGATournamentResult = {
          ...event,
          rounds,
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
