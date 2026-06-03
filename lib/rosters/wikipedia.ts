// Free, ToS-friendly roster source: parses the "Current squad" table from a
// national team's English Wikipedia article (CC-licensed; a descriptive
// User-Agent is required by Wikipedia's API policy). Squad templates give us
// name / position / caps / goals / club; league, assists and debut year are not
// in the table and stay null for the manual-override layer to fill.
//
// Never throws — returns a structured result so the cron can log and move on.

import { normalizePosition, type Player } from "./types";

const API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "WhosYurGoat-WorldCup2026/1.0 (https://whosyurgoat.app; roster sync)";
const TIMEOUT_MS = 12_000;

// Wikipedia article titles that don't follow "<name> national football team".
const TITLE_OVERRIDES: Record<string, string> = {
  USA: "United States men's national soccer team",
  CAN: "Canada men's national soccer team",
  KOR: "South Korea national football team",
  IRN: "Iran national football team",
  KSA: "Saudi Arabia national football team",
  RSA: "South Africa national football team",
  CIV: "Ivory Coast national football team",
  COD: "DR Congo national football team",
  CPV: "Cape Verde national football team",
  CUW: "Curaçao national football team",
  TUR: "Turkey national football team",
  CZE: "Czech Republic national football team",
};

export interface RosterFetchResult {
  ok: boolean;
  players: Player[];
  title: string;
  reason?: string;
}

export function wikipediaTitle(code: string, name: string): string {
  return TITLE_OVERRIDES[code] ?? `${name} national football team`;
}

// Strip wiki markup from a template value: drop {{templates}}, take the display
// side of [[link|display]], unwrap [[link]], collapse whitespace.
function cleanWiki(v: string): string {
  return v
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/''+/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Split a template's inner text into top-level params, respecting nested
// [[wikilinks]] and {{templates}} (whose values contain their own | and }}).
function templateParams(inner: string): Record<string, string> {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    const c2 = inner[i + 1];
    if ((c === "[" && c2 === "[") || (c === "{" && c2 === "{")) {
      depth++;
      cur += c + c2;
      i++;
      continue;
    }
    if ((c === "]" && c2 === "]") || (c === "}" && c2 === "}")) {
      if (depth > 0) depth--;
      cur += c + c2;
      i++;
      continue;
    }
    if (c === "|" && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);

  const map: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue; // template name / positional args
    const k = p.slice(0, eq).trim().toLowerCase();
    if (k) map[k] = p.slice(eq + 1).trim();
  }
  return map;
}

// From index `start` (pointing at "{{"), return the balanced template substring.
function extractBalanced(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth++;
      i++;
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function toInt(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// Isolate the first squad block (Current squad), excluding later blocks such as
// "Recent call-ups" which reuse the same player templates.
function firstSquadBlock(wikitext: string): string {
  const startRe = /\{\{\s*(?:nat fs[^}]*start|national football squad start)/i;
  const start = wikitext.search(startRe);
  if (start < 0) return wikitext; // fall back to whole text; parser is tolerant
  const endRe = /\{\{\s*(?:nat fs[^}]*end|national football squad end)\s*\}\}/i;
  const rest = wikitext.slice(start);
  const end = rest.search(endRe);
  return end < 0 ? rest : rest.slice(0, end);
}

function parsePlayers(wikitext: string): Player[] {
  const block = firstSquadBlock(wikitext);
  const players: Player[] = [];
  // Locate each player template start; both "{{nat fs g player ...}}" and
  // "{{national football squad player ...}}" (and the no-"g" variant) appear.
  const startRe = /\{\{\s*(?:nat fs(?: g)? player|national football squad player)/gi;
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(block)) !== null) {
    const tpl = extractBalanced(block, m.index);
    const inner = tpl.replace(/^\{\{/, "").replace(/\}\}$/, "");
    const p = templateParams(inner);
    const name = cleanWiki(p.name ?? "");
    if (!name) continue;
    players.push({
      name,
      position: normalizePosition(p.pos),
      club: cleanWiki(p.club ?? "") || null,
      league: null,
      caps: toInt(p.caps),
      goals: toInt(p.goals),
      assists: null,
      firstCapYear: null,
      source: "wikipedia",
    });
    // Advance past this template to avoid re-matching nested starts.
    startRe.lastIndex = m.index + tpl.length;
  }
  return players;
}

// Exposed for unit testing the wikitext parser without a network call.
export const parsePlayersForTest = parsePlayers;

export async function fetchWikipediaRoster(code: string, name: string): Promise<RosterFetchResult> {
  const title = wikipediaTitle(code, name);
  const params = new URLSearchParams({
    action: "parse",
    page: title,
    prop: "wikitext",
    format: "json",
    formatversion: "2",
    redirects: "1",
  });
  let res: Response;
  try {
    res = await fetch(`${API}?${params.toString()}`, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 86_400 },
    });
  } catch (err) {
    return { ok: false, players: [], title, reason: err instanceof Error ? err.message : "fetch failed" };
  }
  if (!res.ok) return { ok: false, players: [], title, reason: `http ${res.status}` };

  let json: { parse?: { wikitext?: string }; error?: { info?: string } };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return { ok: false, players: [], title, reason: "bad JSON" };
  }
  if (json.error) return { ok: false, players: [], title, reason: json.error.info ?? "wiki error" };
  const wikitext = json.parse?.wikitext;
  if (!wikitext) return { ok: false, players: [], title, reason: "no wikitext" };

  const players = parsePlayers(wikitext);
  if (players.length === 0) return { ok: false, players: [], title, reason: "no squad table found" };
  return { ok: true, players, title };
}
