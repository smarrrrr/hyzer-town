import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import axios from "axios";
import * as cheerio from "cheerio";

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

interface PDGAEvent {
  tournId: string;
  name: string;
  date: string;
  division: string;
  place: string | null;
  points: string | null;
}

interface RoundScore {
  round: number;
  total: number;
  relativeToPar: number | null;
  holes: (number | null)[];
  rating: number | null;
}

interface PDGATournamentResult {
  tournId: string;
  name: string;
  date: string;
  division: string;
  place: string | null;
  rounds: RoundScore[];
}

/**
 * Fetches tournament history for a PDGA player.
 * @param {string} pdgaNumber - The player's PDGA number.
 */
async function fetchPlayerEvents(pdgaNumber: string): Promise<PDGAEvent[]> {
  const url = `https://www.pdga.com/player/${pdgaNumber}/details`;
  const {data} = await axios.get(url, {headers: HEADERS, timeout: 15000});
  const $ = cheerio.load(data);

  const events: PDGAEvent[] = [];

  $("table.views-table tbody tr, table tbody tr").each((_, row) => {
    const link = $(row).find("a[href*='/tour/event/']").first();
    const href = link.attr("href") || "";
    const match = href.match(/\/tour\/event\/(\d+)/);
    if (!match) return;

    events.push({
      tournId: match[1],
      name: link.text().trim(),
      date: $(row).find("td").eq(1).text().trim(),
      division: $(row).find("td").filter((_, td) =>
        /^(MPO|FPO|MA\d|FA\d|MJ|FJ)/i.test($(td).text().trim())
      ).first().text().trim(),
      place: $(row).find("td").filter((_, td) =>
        /^\d+$/.test($(td).text().trim())
      ).first().text().trim() || null,
      points: null,
    });
  });

  return events;
}

/**
 * Fetches round scores for a player from a PDGA event.
 * @param {string} tournId - The PDGA tournament ID.
 * @param {string} pdgaNumber - The player's PDGA number.
 * @param {string} division - The player's division (e.g. MPO).
 */
async function fetchEventRounds(
  tournId: string,
  pdgaNumber: string,
  division: string
): Promise<RoundScore[]> {
  // Try the live scoring API first
  const apiUrl =
    "https://www.pdga.com/apps/tournament/live-api/index.cfm" +
    `?method=getGroupsandScores&TournID=${tournId}&Division=${division}`;

  try {
    const {data} = await axios.get(apiUrl, {
      headers: {...HEADERS, Accept: "application/json"},
      timeout: 15000,
    });

    const rounds: RoundScore[] = [];

    // API returns rounds as arrays of groups with players
    const roundsData = Array.isArray(data) ? data : data?.rounds ?? [];

    for (const roundEntry of roundsData) {
      const roundNum: number = roundEntry.Round ?? roundEntry.round;
      const groups = roundEntry.Groups ?? roundEntry.groups ?? [];

      for (const group of groups) {
        const players = group.Players ?? group.players ?? [];
        const me = players.find(
          (p: Record<string, unknown>) =>
            String(p.PDGANum ?? p.pdgaNum) === pdgaNumber
        );
        if (!me) continue;

        const holes: (number | null)[] = (
          me.ScorecardHoles ?? me.scorecardHoles ?? []
        ).map((h: unknown) => (h == null || h === "" ? null : Number(h)));

        rounds.push({
          round: roundNum,
          total: Number(me.RoundScore ?? me.roundScore ?? 0),
          relativeToPar: me.RunningTotal != null ?
            Number(me.RunningTotal) :
            null,
          holes,
          rating: me.RoundRating != null ? Number(me.RoundRating) : null,
        });
      }
    }

    if (rounds.length > 0) return rounds;
  } catch {
    // Fall through to HTML scrape
  }

  // Fallback: scrape the event page for the player's scores
  const eventUrl = `https://www.pdga.com/tour/event/${tournId}`;
  const {data: html} = await axios.get(eventUrl, {
    headers: HEADERS,
    timeout: 15000,
  });
  const $ = cheerio.load(html);

  const rounds: RoundScore[] = [];
  $(`tr[data-pdga-number="${pdgaNumber}"], tr:contains("${pdgaNumber}")`).each(
    (_, row) => {
      const cells = $(row).find("td").toArray()
        .map((td) => $(td).text().trim());
      if (cells.length < 3) return;
      const roundNum = rounds.length + 1;
      const total = parseInt(cells[cells.length - 1]) || 0;
      rounds.push({
        round: roundNum, total,
        relativeToPar: null, holes: [], rating: null,
      });
    }
  );

  return rounds;
}

export const syncPDGATournaments = onCall(
  {timeoutSeconds: 120, memory: "512MiB"},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const {pdgaNumber} = request.data as { pdgaNumber: string };
    if (!pdgaNumber || !/^\d+$/.test(pdgaNumber)) {
      throw new HttpsError("invalid-argument", "Invalid PDGA number");
    }

    const uid = request.auth.uid;

    let events: PDGAEvent[];
    try {
      events = await fetchPlayerEvents(pdgaNumber);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpsError("internal", `Failed to fetch PDGA profile: ${msg}`);
    }

    if (events.length === 0) {
      return {synced: 0, message: "No tournament history found"};
    }

    // Process up to 20 most recent events to avoid timeout
    const recent = events.slice(0, 20);
    const results: PDGATournamentResult[] = [];

    for (const event of recent) {
      try {
        const rounds = await fetchEventRounds(
          event.tournId,
          pdgaNumber,
          event.division || "MPO"
        );
        results.push({...event, rounds});

        await getDb()
          .collection("pdga_tournaments")
          .doc(uid)
          .collection("events")
          .doc(event.tournId)
          .set(
            {
              ...event, rounds,
              syncedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            {merge: true}
          );
      } catch {
        // Skip events that fail, continue with others
      }
    }

    // Store summary on the user doc
    await getDb().collection("pdga_tournaments").doc(uid).set({
      pdgaNumber,
      lastSynced: admin.firestore.FieldValue.serverTimestamp(),
      eventCount: events.length,
    }, {merge: true});

    return {synced: results.length, total: events.length};
  }
);
