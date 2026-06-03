// One-off builder: parses the pasted Wikipedia "2026 FIFA World Cup squads"
// stat tables (data/sources/wc2026-squads.txt) into data/rosters.json.
//
// The dump has columns: No. | Pos. | Player | DOB (aged) | Caps | Goals | Club,
// where Club is prefixed by the player's national federation (which encodes the
// club's country). We split on the fixed DOB pattern so names/clubs with spaces
// parse cleanly, then map the federation prefix to a league label.
//
//   npx tsx scripts/build-rosters.ts
import { readFileSync, writeFileSync } from "node:fs";

// Table team name -> our team code (data/fixtures-2026.json).
const NAME_TO_CODE: Record<string, string> = {
  "Czech Republic": "CZE", Mexico: "MEX", "South Africa": "RSA", "South Korea": "KOR",
  "Bosnia and Herzegovina": "BIH", Canada: "CAN", Qatar: "QAT", Switzerland: "SUI",
  Brazil: "BRA", Haiti: "HAI", Morocco: "MAR", Scotland: "SCO", Australia: "AUS",
  Paraguay: "PAR", Turkey: "TUR", "United States": "USA", "Curaçao": "CUW", Ecuador: "ECU",
  Germany: "GER", "Ivory Coast": "CIV", Japan: "JPN", Netherlands: "NED", Sweden: "SWE",
  Tunisia: "TUN", Belgium: "BEL", Egypt: "EGY", Iran: "IRN", "New Zealand": "NZL",
  "Cape Verde": "CPV", "Saudi Arabia": "KSA", Spain: "ESP", Uruguay: "URU", France: "FRA",
  Iraq: "IRQ", Norway: "NOR", Senegal: "SEN", Algeria: "ALG", Argentina: "ARG",
  Austria: "AUT", Jordan: "JOR", Colombia: "COL", "DR Congo": "COD", Portugal: "POR",
  Uzbekistan: "UZB", Croatia: "CRO", England: "ENG", Ghana: "GHA", Panama: "PAN",
};

// National federation prefix -> league label (the player's club country/league).
// Inferred from the federation flag, so it reflects the club's country; a handful
// of second-division clubs are labelled with the country's top league.
const FED_TO_LEAGUE: Record<string, string> = {
  "Royal Dutch Football Association": "Eredivisie",
  "Football Association of the Czech Republic": "Czech First League",
  "German Football Association": "Bundesliga",
  "The Football Association": "England (EPL/EFL)",
  "Portuguese Football Federation": "Liga Portugal",
  "Hellenic Football Federation": "Super League Greece",
  "Russian Football Union": "Russian Premier League",
  "French Football Federation": "Ligue 1",
  "Mexican Football Federation": "Liga MX",
  "Cyprus Football Association": "Cypriot First Division",
  "Italian Football Federation": "Serie A",
  "Saudi Arabian Football Federation": "Saudi Pro League",
  "Turkish Football Federation": "Süper Lig",
  "Royal Spanish Football Federation": "La Liga",
  "Royal Belgian Football Association": "Belgian Pro League",
  "Korea Football Association": "K League 1",
  "Japan Football Association": "J1 League",
  "Austrian Football Association": "Austrian Bundesliga",
  "Danish Football Association": "Danish Superliga",
  "Chinese Football Association": "Chinese Super League",
  "Football Association of Serbia": "Serbian SuperLiga",
  "Scottish Football Association": "Scottish Premiership",
  "United States Soccer Federation": "MLS",
  "Canadian Soccer Association": "MLS",
  "Norwegian Football Federation": "Eliteserien",
  "Swiss Football Association": "Swiss Super League",
  "Swedish Football Association": "Allsvenskan",
  "Brazilian Football Confederation": "Brasileirão",
  "Argentine Football Association": "Primera División (ARG)",
  "Qatar Football Association": "Qatar Stars League",
  "United Arab Emirates Football Association": "UAE Pro League",
  "Egyptian Football Association": "Egyptian Premier League",
  "South African Football Association": "PSL",
  "Football Federation Islamic Republic of Iran": "Persian Gulf Pro League",
  "Uzbekistan Football Association": "Uzbekistan Super League",
  "Iraq Football Association": "Iraq Stars League",
  "Jordan Football Association": "Jordanian Pro League",
  "Football Association of Slovenia": "PrvaLiga",
  "Slovak Football Association": "Slovak First League",
  "Ecuadorian Football Federation": "Serie A (ECU)",
  "Colombian Football Federation": "Categoría Primera A",
  "Uruguayan Football Association": "Primera División (URU)",
  "Paraguayan Football Association": "Primera División (PAR)",
  "Costa Rican Football Federation": "Liga FPD",
  "Venezuelan Football Federation": "Liga FUTVE",
  "Football Federation of Chile": "Primera División (CHI)",
  "National Autonomous Federation of Football of Honduras": "Liga Nacional (HON)",
  "Football Association of Ireland": "League of Ireland",
  "Football Association of Wales": "England (EFL)",
  "Football Australia": "A-League",
  "New Zealand Football": "A-League",
  "Football Association of Malaysia": "Malaysia Super League",
  "Israel Football Association": "Israeli Premier League",
  "Football Association of Finland": "Veikkausliiga",
  "Football Association of Indonesia": "Liga 1 (IDN)",
  "Football Association of Thailand": "Thai League 1",
  "Football Federation of Armenia": "Armenian Premier League",
  "Association of Football Federations of Azerbaijan": "Azerbaijan Premier League",
  "Kazakhstan Football Federation": "Kazakhstan Premier League",
  "Royal Moroccan Football Federation": "Botola",
  "Tunisian Football Federation": "Ligue Professionnelle 1 (TUN)",
  "Algerian Football Federation": "Ligue Professionnelle 1 (ALG)",
  "Ghana Football Association": "Ghana Premier League",
  "Panamanian Football Federation": "LPF (PAN)",
  "Haitian Football Federation": "Ligue Haïtienne",
  "Hungarian Football Federation": "NB I",
  "Polish Football Association": "Ekstraklasa",
  "Romanian Football Federation": "Liga I",
  "Bulgarian Football Union": "First Professional League (BUL)",
  "Croatian Football Federation": "HNL",
  "Football Association of Bosnia and Herzegovina": "Bosnian Premier League",
};

const FEDS = Object.keys(FED_TO_LEAGUE).sort((a, b) => b.length - a.length);

function splitClub(raw: string): { club: string; league: string | null } {
  for (const fed of FEDS) {
    if (raw.startsWith(fed + " ")) return { club: raw.slice(fed.length + 1).trim(), league: FED_TO_LEAGUE[fed] };
  }
  return { club: raw.trim(), league: null };
}

const ROW = /^(\d+)\s+(GK|DF|MF|FW)\s+(.+?)\s+[A-Z][a-z]+ \d{1,2}, \d{4} \(aged \d+\)\s+(\d+)\s+(\d+)\s+(.+)$/;

interface Player {
  name: string;
  position: string;
  club: string;
  league: string | null;
  caps: number;
  goals: number;
  assists: number | null;
  firstCapYear: number | null;
}

function main() {
  const text = readFileSync("data/sources/wc2026-squads.txt", "utf8");
  const lines = text.split("\n");
  const rosters: Record<string, Player[]> = {};
  const unmatchedFed = new Set<string>();
  let current: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("Coach")) {
      // team name is the previous non-empty line
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j].trim();
        if (!prev) continue;
        const code = NAME_TO_CODE[prev];
        if (code) {
          current = code;
          rosters[code] = [];
        } else {
          console.warn(`Unmapped team name near line ${i}: "${prev}"`);
          current = null;
        }
        break;
      }
      continue;
    }
    const m = ROW.exec(line);
    if (!m || !current) continue;
    const [, , pos, rawName, caps, goals, rawClub] = m;
    const { club, league } = splitClub(rawClub);
    if (league === null) unmatchedFed.add(rawClub);
    rosters[current].push({
      name: rawName.replace(/\s*\(captain\)\s*$/, "").trim(),
      position: pos,
      club,
      league,
      caps: Number(caps),
      goals: Number(goals),
      assists: null,
      firstCapYear: null,
    });
  }

  const codes = Object.keys(rosters);
  const total = codes.reduce((n, c) => n + rosters[c].length, 0);
  console.log(`Teams: ${codes.length}, players: ${total}`);
  for (const c of codes) if (rosters[c].length < 23) console.warn(`  small squad ${c}: ${rosters[c].length}`);
  if (unmatchedFed.size) {
    console.warn("Clubs with no federation match (league=null):");
    for (const u of unmatchedFed) console.warn("  " + u);
  }

  const out = {
    note: "Official 2026 FIFA World Cup squads (final squads, June 2026), parsed from the Wikipedia squad stat tables via scripts/build-rosters.ts. This is the MANUAL OVERRIDE LAYER, merged on top of any auto-pulled Wikipedia rows at read time. caps/goals are senior international totals at tournament start. league is inferred from the club's national federation, so it reflects the club's country and may not be the exact division. assists and firstCapYear are not in the source and are left null.",
    asOf: "2026-06-03",
    fields: ["name", "position", "club", "league", "caps", "goals", "assists", "firstCapYear"],
    rosters,
  };
  writeFileSync("data/rosters.json", JSON.stringify(out, null, 2) + "\n");
  console.log("Wrote data/rosters.json");
}

main();
