// src/App.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ReferenceArea,
 ComposedChart,
  ReferenceLine,
  LabelList,
} from "recharts";
import { RefreshCcw, RotateCcw, Home, BarChart3, Gauge, Users } from "lucide-react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { PLAYER_IMAGE_MANIFEST } from "./playerImageManifest";

function fmtAUD(n: number) {
  return n.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  });
}

function fmtAUDShort(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    const decimals = abs >= 10_000_000 ? 0 : 1;
    return `$${v.toFixed(decimals)}m`;
  }
  return `$${Math.round(n / 1000)}k`;
}

function fmtProbPct(p: number | null | undefined) {
  if (p == null) return "—";
  const v = Math.max(0, Math.min(1, p));
  const pct = v * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  if (pct > 0 && pct < 1) return "<1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

const ACQ_FALLBACK_COLORS = [
  "#2563EB", // blue
  "#16A34A", // green
  "#DC2626", // red
  "#6B7280", // grey
  "#EAB308", // yellow
  "#7C3AED", // purple
  "#EC4899", // pink
];

// Stable acquisition colours (category -> colour), fixed across all teams/seasons.
const ACQ_COLOR_MAP: Record<string, string> = {
  // AFL men's
  National: "#7C3AED", // purple
  "National Draft": "#7C3AED", // purple
  "Top-10 National": "#2563EB", // blue
  "Top-20 National": "#16A34A", // green
  "Rookie/Post-Draft": "#6B7280", // grey
  "Rookie Draft": "#2563EB", // blue
  "Mid-Season": "#EC4899", // pink
  "Mid-Season Draft": "#EC4899", // pink
  Trade: "#EAB308", // yellow
  "Free Agency": "#DC2626", // red
  "Free Agent": "#DC2626", // red
  "Pre-Draft": "#16A34A", // green
  "Pre-Listing": "#16A34A", // green
  "Category B": "#EC4899", // pink
  SSP: "#6B7280", // grey
  Other: "#6B7280", // grey
  // AFLW-specific
  Draft: "#2563EB", // blue
  "Top-5 Draft": "#1D4ED8", // dark blue
  "Top-10 Draft": "#3B82F6", // medium blue
  "Draft (Pick 1-5)": "#1D4ED8", // dark blue
  "Draft (Pick 6-10)": "#60A5FA", // light blue
  "Draft (Pick 11+)": "#93C5FD", // pale blue
  "Marquee/Pre-list": "#7C3AED", // purple
  "Cross-code": "#F97316", // orange
  "State League Recruit": "#0D9488", // teal
  Rookie: "#6B7280", // grey
  Priority: "#A855F7", // violet
  Marquee: "#7C3AED", // purple
  "Expansion signing": "#14B8A6", // teal-green
  "Pre-season Draft": "#0EA5E9", // sky blue
};

// deterministic fallback so any unknown category is still consistent
function stableColorForKey(key: string) {
  const k = toTrimmedString(key);
  if (ACQ_COLOR_MAP[k]) return ACQ_COLOR_MAP[k];

  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return ACQ_FALLBACK_COLORS[h % ACQ_FALLBACK_COLORS.length];
}

// --- Logos from src/AFL_Logos_Official (Vite)
// Vite v5+ glob: use query '?url' instead of deprecated `as: 'url'`
const LOGOS = import.meta.glob("/src/AFL_Logos_Official/*.{png,svg,jpg,jpeg,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;



function getLogoUrlByClubName(clubName: string) {
  // Try exact file names first (fast path)
  const targets = [
    `/src/AFL_Logos_Official/${clubName}.png`,
    `/src/AFL_Logos_Official/${clubName}.svg`,
    `/src/AFL_Logos_Official/${clubName}.jpg`,
    `/src/AFL_Logos_Official/${clubName}.jpeg`,
    `/src/AFL_Logos_Official/${clubName}.webp`,
  ];
  for (const t of targets) if (LOGOS[t]) return LOGOS[t];

  // Fallback: fuzzy match by filename (handles cases like "Geelong" vs "Geelong Cats")
  const norm = (s: string) =>
    (s ?? "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const compact = (s: string) =>
    (s ?? "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "");

  const stripSuffix = (s: string) =>
    (s ?? "").replace(/\s+(Lions|Cats|SUNS|Suns|GIANTS|Giants|Swans|Eagles|Bulldogs|Saints|Kangaroos)\s*$/i, "").trim();

  const candidates = Array.from(
    new Set([
      clubName,
      normalizeClubName(clubName),
      stripSuffix(clubName),
      stripSuffix(normalizeClubName(clubName)),
    ].filter(Boolean))
  ).map(norm);
  const candidateCompacts = candidates.map(compact);

  // Score all possible matches and pick the strongest to avoid false positives
  // like "Melbourne" winning over "NorthMelbourne".
  let bestUrl: string | null = null;
  let bestScore = -1;

  for (const [path, url] of Object.entries(LOGOS)) {
    const base = path.split("/").pop() ?? "";
    const stem = base.replace(/\.(png|svg|jpg|jpeg|webp)$/i, "");
    const stemN = norm(stem);
    const stemCompact = compact(stem);

    let score = 0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const cCompact = candidateCompacts[i];
      if (!c) continue;

      // exact normalized text match
      if (c === stemN) score = Math.max(score, 120);
      // exact compact match (handles "North Melbourne" vs "NorthMelbourne")
      if (cCompact && cCompact === stemCompact) score = Math.max(score, 110);
      // filename contains the candidate phrase/token
      if (c.length >= 4 && stemN.includes(c)) score = Math.max(score, 80);
      if (cCompact.length >= 4 && stemCompact.includes(cCompact)) score = Math.max(score, 75);
      // reverse containment is weaker and only a fallback
      if (stemN.length >= 6 && c.includes(stemN)) score = Math.max(score, 40);
    }

    if (score > bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }

  return bestUrl;
}

// --- Player images hosted outside the bundle and resolved by player ID.
const PLAYER_IMAGE_BASE_URL = toTrimmedString(import.meta.env.VITE_PLAYER_IMAGE_BASE_URL);

const PLAYER_IMAGE_LOOKUP = (() => {
  const map = new Map<string, string>();
  for (const [playerId, fileName] of Object.entries(PLAYER_IMAGE_MANIFEST)) {
    const trimmed = playerId.trim();
    if (!trimmed || !fileName) continue;
    map.set(trimmed.toLowerCase(), fileName);
    map.set(normalizePlayerId(trimmed).toLowerCase(), fileName);
  }
  return map;
})();

function buildPlayerImageUrl(fileName: string): string | null {
  if (!PLAYER_IMAGE_BASE_URL || !fileName) return null;

  const [basePath, query = ""] = PLAYER_IMAGE_BASE_URL.split("?");
  const cleanBasePath = basePath.replace(/\/+$/, "");
  if (!cleanBasePath) return null;

  const encodedFileName = fileName
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  if (!encodedFileName) return null;
  return query ? `${cleanBasePath}/${encodedFileName}?${query}` : `${cleanBasePath}/${encodedFileName}`;
}

function getPlayerImgUrl(playerId: string | number | null | undefined, playerName?: string | null) {
  const rawId = toTrimmedString(playerId);
  const id = normalizePlayerId(rawId);
  const rawName = toTrimmedString(playerName);
  const keyify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");

  const candidates = [
    rawId,
    id,
    `CD_I${id}`,
    `CD-${id}`,
    rawName,
    keyify(rawName),
  ]
    .filter(Boolean)
    .map((x) => String(x));

  for (const c of candidates) {
    const direct = PLAYER_IMAGE_LOOKUP.get(c.toLowerCase());
    if (direct) return buildPlayerImageUrl(direct);
    const normalized = PLAYER_IMAGE_LOOKUP.get(normalizePlayerId(c).toLowerCase());
    if (normalized) return buildPlayerImageUrl(normalized);
    const keyified = PLAYER_IMAGE_LOOKUP.get(keyify(c));
    if (keyified) return buildPlayerImageUrl(keyified);
  }
  return null;
}

// --------------------
// Types
// --------------------
type LeagueCode = "AFL" | "AFLW";
type TeamOption = { id: string; name: string; league: LeagueCode; label?: string };

type RosterPlayerRow = {
  season: number;
  team: string;
  team_id: string;
  league: LeagueCode;
  providerId: string;
  player_name: string;
  age: number;
  position_group: string;
  games: number;

  ratings: number;   
  age_cat: string;   
};

type TeamKpiRow = {
  Club: string;
  season: number;
  team_id: string;
  league: LeagueCode;
  squad_age_avg: number;
  squad_age_yoy: number | null;
  squad_experience_avg_games: number;
  squad_experience_yoy: number | null;
  squad_turnover_players: number;
  squad_turnover_yoy: number | null;
};

type VflFormRow = {
  season: number;
  player_name: string;
  playerId: string;
  team: string;
  team_id?: string;
  league?: string;
  weighted_avg: number;
};

type AflFormRow = {
  season: number;
  player_name: string;
  playerId: string;
  team: string;
  team_id: string;
  league: LeagueCode;
  weighted_avg: number;
  recent_form: number | null;
  form_change: number | null;
};

type RankRow = {
  Club: string;
  league: LeagueCode;
  year: number;
  actual_rank: number | null;
  forecast_a_rank: number | null;
  forecast_b_rank: number | null;

  finish_1_p10?: number | null;
  finish_1_p25?: number | null;
  finish_1_p75?: number | null;
  finish_1_p90?: number | null;
  finish_2_p10?: number | null;
  finish_2_p25?: number | null;
  finish_2_p75?: number | null;
  finish_2_p90?: number | null;
};

type SkillRadarRow = {
  season: string;
  squad_name: string;
  team_id: string;
  league: LeagueCode;
  KH_Ratio: number;
  GB_MK_Ratio: number;
  Fwd_Half: number;
  Scores: number;
  PPchain: number;
  Points_per_I50: number;
  Repeat_I50s: number;
  Rating_Ball_Use: number;
  Rating_Ball_Win: number;
  Chain_Metres: number;
  Time_in_Poss_Pct: number;
};

type AcquisitionRow = {
  Club: string;
  Year: number;
  Draft: string;
  value: number;
  team_id: string;
  league: LeagueCode;
};

type PlayerProjectionRow = {
  team: string;
  season: number;
  team_id: string;
  league: LeagueCode;
  playerId: string;
  player_name: string;
  rating: number;
  salary: number | null;
  AA: number | null;
  Games: number | null;
};


type CareerProjectionRow = {
  SourceproviderId: string;
  SourcePlayer: string;
  SourceClub: string;
  SourceSeason: number;
  SourceRating: number;
  SourcePosition: string;
  Horizon: number;
  Season: number;
  estimate: number | null;
  lower: number | null;
  upper: number | null;
  salary: number | null;
  Optimistic?: number | null;
  Pessimistic?: number | null;
  salary_opt?: number | null;
  salary_pes?: number | null;
  AA: number | null;
  Seasons: number | null;
  Season_90: number | null;
  Games: number | null;

  Height?: string | null;
  Age?: string | null;
  Drafted?: string | null;
  draftYear?: string | null;

  // Optional columns that may exist in your CSV (safe to ignore if missing)
  Type?: string;
  team?: string;

  // Ranks (often present in your export)
  rank_all?: number | null;
  rank_pos?: number | null;

  // Optional performance components (present in your career_projections.csv export)
  Kicks?: number | null;
  Hitouts?: number | null;
  Intercepts?: number | null;
  Spoils?: number | null;
  Transition?: number | null;
  Shots?: number | null;
  Stoppage?: number | null;
  Ball_Use?: number | null;
  Ball_Winning?: number | null;
  Pressure?: number | null;

  // Advanced stat percentiles (new file)
  Kicking?: number | null;
  Handballing?: number | null;
  Transition_Ball_Use?: number | null;
  Post_Clearance_Ball_Use?: number | null;
  Clearance_Ball_Use?: number | null;
  Aerial?: number | null;
  Ground?: number | null;
  Run_Carry?: number | null;
  Turnover_Transition_Ball_Winning?: number | null;
  Stoppage_Transition_Ball_Winning?: number | null;
  Pre_Clearance_Ball_Winning?: number | null;
  Spoiling?: number | null;
};

type ComparablePlayerRow = {
  SourceproviderId: string;
  SourcePlayer: string;
  SourceSeason: number;
  SourcePosition: string;
  SourceClub: string;
  SimilarPlayer: string;
  SimilarSeason: number;
  similarity: number;
  rank?: number | null;
  adj_1?: number | null;
  adj_2?: number | null;
  adj_3?: number | null;
  adj_4?: number | null;
  adj_5?: number | null;
  adj_6?: number | null;
  adj_7?: number | null;
  adj_8?: number | null;
  adj_9?: number | null;
  adj_10?: number | null;
};

type PlayerStatsAggRow = {
  season: number;
  player_id: string; // keep as string for safe joins
  player_name: string;
  metric_name: string;
  category: string;
  metric_value: number;
};



// --------------------
// Teams
// --------------------
const TEAMS: TeamOption[] = [
  { id: "10", name: "Adelaide Crows", league: "AFL" },
  { id: "20", name: "Brisbane Lions", league: "AFL" },
  { id: "30", name: "Carlton", league: "AFL" },
  { id: "40", name: "Collingwood", league: "AFL" },
  { id: "50", name: "Essendon", league: "AFL" },
  { id: "60", name: "Fremantle", league: "AFL" },
  { id: "70", name: "Geelong Cats", league: "AFL" },
  { id: "1000", name: "Gold Coast SUNS", league: "AFL" },
  { id: "1010", name: "GWS GIANTS", league: "AFL" },
  { id: "80", name: "Hawthorn", league: "AFL" },
  { id: "90", name: "Melbourne", league: "AFL" },
  { id: "100", name: "North Melbourne", league: "AFL" },
  { id: "110", name: "Port Adelaide", league: "AFL" },
  { id: "120", name: "Richmond", league: "AFL" },
  { id: "130", name: "St Kilda", league: "AFL" },
  { id: "160", name: "Sydney", league: "AFL" },
  { id: "150", name: "West Coast", league: "AFL" },
  { id: "140", name: "Western Bulldogs", league: "AFL" },
  { id: "8098", name: "Adelaide Crows", league: "AFLW", label: "Adelaide Crows (AFLW)" },
  { id: "7887", name: "Brisbane Lions", league: "AFLW", label: "Brisbane Lions (AFLW)" },
  { id: "8096", name: "Carlton", league: "AFLW", label: "Carlton (AFLW)" },
  { id: "8097", name: "Collingwood", league: "AFLW", label: "Collingwood (AFLW)" },
  { id: "9406", name: "Essendon", league: "AFLW", label: "Essendon (AFLW)" },
  { id: "7886", name: "Fremantle", league: "AFLW", label: "Fremantle (AFLW)" },
  { id: "8467", name: "Geelong Cats", league: "AFLW", label: "Geelong Cats (AFLW)" },
  { id: "8786", name: "Gold Coast SUNS", league: "AFLW", label: "Gold Coast SUNS (AFLW)" },
  { id: "7889", name: "GWS GIANTS", league: "AFLW", label: "GWS GIANTS (AFLW)" },
  { id: "9407", name: "Hawthorn", league: "AFLW", label: "Hawthorn (AFLW)" },
  { id: "7386", name: "Melbourne", league: "AFLW", label: "Melbourne (AFLW)" },
  { id: "8466", name: "North Melbourne", league: "AFLW", label: "North Melbourne (AFLW)" },
  { id: "9409", name: "Port Adelaide", league: "AFLW", label: "Port Adelaide (AFLW)" },
  { id: "8788", name: "Richmond", league: "AFLW", label: "Richmond (AFLW)" },
  { id: "8796", name: "St Kilda", league: "AFLW", label: "St Kilda (AFLW)" },
  { id: "9408", name: "Sydney Swans", league: "AFLW", label: "Sydney Swans (AFLW)" },
  { id: "8787", name: "West Coast Eagles", league: "AFLW", label: "West Coast Eagles (AFLW)" },
  { id: "7387", name: "Western Bulldogs", league: "AFLW", label: "Western Bulldogs (AFLW)" },
];



const DEFAULT_TEAM_ID = "40"; // Collingwood
const DEFAULT_SEASON = 2026;
const RECENT_SEASON_WINDOW = 3;
const MIN_RECENT_SEASON = DEFAULT_SEASON - (RECENT_SEASON_WINDOW - 1);
const UI_SEASONS = Array.from({ length: RECENT_SEASON_WINDOW }, (_, i) => MIN_RECENT_SEASON + i) as number[];
const CAREER_TILES_EXPORT_ID = "career-tiles-export-target";
const CAREER_PDF_EXPORT_ID = "career-pdf-export-target";
const CAREER_MAIN_EXPORT_ID = "career-main-export-target";
const CAREER_EXPORT_CAPTURE_WIDTH = 1088;
const CAREER_EXPORT_CAPTURE_MIN_HEIGHT = 920;
const CAREER_EXPORT_CAPTURE_SPLIT = "0.30fr 0.70fr";
const CAREER_EXPORT_CAPTURE_ZOOM = 0.94;

// Back-compat: accept older abbreviation-style team codes in URLs (?team=COLL or /team/COLL) and coerce to numeric ids.
const LEGACY_TEAM_CODE_TO_ID: Record<string, string> = {
  ADE: "10",
  BRI: "20",
  CARL: "30",
  COLL: "40",
  ESS: "50",
  FRE: "60",
  GEE: "70",
  GC: "1000",
  GWS: "1010",
  HAW: "80",
  MELB: "90",
  NM: "100",
  PORT: "110",
  RICH: "120",
  STK: "130",
  SYD: "160",
  WCE: "150",
  WB: "140",
};

const TEAM_PRIMARY_COLOR: Record<string, string> = {
  Adelaide: "#002B5C",
  "Brisbane Lions": "#7C003E",
  Carlton: "#001F5B",
  Collingwood: "#111111",
  Essendon: "#CC0000",
  Fremantle: "#4B1F6F",
  "Geelong Cats": "#002B5C",
  "Gold Coast SUNS": "#B5121B",
  "GWS GIANTS": "#F05A28",
  Hawthorn: "#5A2A00",
  Melbourne: "#001B3A",
  "North Melbourne": "#003DA5",
  "Port Adelaide": "#008AAB",
  Richmond: "#F5B301",
  "St Kilda": "#111111",
  Sydney: "#D71920",
  "West Coast": "#002B5C",
  "Western Bulldogs": "#1E3A8A",
};

const TEAM_BY_ID = new Map(TEAMS.map((t) => [t.id, t] as const));

const AGE_CAT_COLOR: Record<string, string> = {
  "Rising Stars": "#2563EB",
  "Established Youth": "#7C3AED",
  "Prime": "#059669",
  "Veterans": "#F59E0B",
  "Old Timers": "#EF4444",
};


function normalizeClubName(s: string) {
  const x = toTrimmedString(s);
  const map: Record<string, string> = {
    "Adelaide Crows": "Adelaide",
    "Brisbane": "Brisbane Lions",
    Geelong: "Geelong Cats",
    "Gold Coast": "Gold Coast SUNS",
    "Gold Coast Suns": "Gold Coast SUNS",
    "GWS": "GWS GIANTS",
    "Greater Western Sydney": "GWS GIANTS",
    "North Melbourne": "North Melbourne",
    Kangaroos: "North Melbourne",
    Port: "Port Adelaide",
    "St Kilda": "St Kilda",
    "Sydney Swans": "Sydney",
    "West Coast Eagles": "West Coast",
    "Western Bulldogs": "Western Bulldogs",
  };
  return map[x] ?? x;
}

function normalizeLeague(x: any): LeagueCode {
  const raw = toTrimmedString(x).toUpperCase();
  return raw === "AFLW" ? "AFLW" : "AFL";
}

function normalizeTeamId(x: any): string {
  return toTrimmedString(x);
}

function isKnownTeamId(teamId: string | null | undefined): boolean {
  return !!getTeamOptionById(teamId);
}

function getTeamOptionById(teamId: string | null | undefined): TeamOption | null {
  const id = normalizeTeamId(teamId);
  return id ? TEAM_BY_ID.get(id) ?? null : null;
}

function findTeamOption(rawTeamId: any, rawTeamName: any, rawLeague: any): TeamOption | null {
  const direct = getTeamOptionById(rawTeamId);
  if (direct) return direct;

  const teamName = normalizeClubName(toTrimmedString(rawTeamName));
  if (!teamName) return null;

  const league = normalizeLeague(rawLeague);
  return (
    TEAMS.find((t) => t.league === league && normalizeClubName(t.name) === teamName) ??
    TEAMS.find((t) => t.league === "AFL" && normalizeClubName(t.name) === teamName) ??
    TEAMS.find((t) => normalizeClubName(t.name) === teamName) ??
    null
  );
}

function resolveTeamIdentity(rawTeamId: any, rawTeamName: any, rawLeague: any) {
  const option = findTeamOption(rawTeamId, rawTeamName, rawLeague);
  const team = option?.name ?? normalizeClubName(toTrimmedString(rawTeamName));
  const team_id = option?.id ?? normalizeTeamId(rawTeamId);
  const league = option?.league ?? normalizeLeague(rawLeague);
  return { team, team_id, league };
}

function coerceTeamId(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  // already a numeric id in TEAMS
  if (TEAMS.some((t) => t.id === v)) return v;

  const upper = v.toUpperCase();
  if (LEGACY_TEAM_CODE_TO_ID[upper]) return LEGACY_TEAM_CODE_TO_ID[upper];
  for (const [legacyCode, teamId] of Object.entries(LEGACY_TEAM_CODE_TO_ID)) {
    if (upper.startsWith(legacyCode)) return teamId;
  }

  // allow club name in URLs (e.g. /team/Collingwood) as a last resort
  const vNorm = normalizeClubName(v).toLowerCase();
  const byName = TEAMS.find((t) => normalizeClubName(t.name).toLowerCase() === vNorm);
  return byName?.id ?? "";
}


function formatPct(x: number) {
  return `${x.toFixed(1)}%`;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// --------------------
// Data loader (Azure SWA API -> /api/data?file=...)
// --------------------
// This replaces the old "fetch CSV from /data/*.csv" approach.
// Your Azure Function returns JSON rows parsed from the CSV in private Blob Storage.
//
// If you MUST call the API from the browser, put the key in a Vite env var:
//   VITE_DATA_API_KEY=...   (note: this is only "light protection" in-browser).
// If a server/SharePoint process calls the API, keep the key server-side.
const DATA_API_KEY = (import.meta as any).env?.VITE_DATA_API_KEY as string | undefined;
const USE_LOCAL_DATA = String((import.meta as any).env?.VITE_USE_LOCAL_DATA ?? "").toLowerCase() === "true";
const LOCAL_DATA_BASE = String((import.meta as any).env?.VITE_LOCAL_DATA_BASE ?? "/local-data").replace(/\/+$/, "") || "/local-data";
let localDataManifestPromise: Promise<any | null> | null = null;

function toTrimmedString(x: any): string {
  // Ensures we can safely call .trim() even if the API returns numbers/nulls.
  return String(x ?? "").trim();
}

function toPresentString(x: any): string | null {
  const s = toTrimmedString(x);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "na" || lower === "n/a" || lower === "null" || lower === "nan" || lower === "undefined" || lower === "-") return null;
  return s;
}

function normalizePlayerId(x: any): string {
  // Canonicalise IDs so deep links work even if some CSVs store IDs like "CD_I1004757"
  // while URLs (and other files) use just "1004757".
  const s = toTrimmedString(x);
  // Strip common provider prefixes (case-insensitive)
  return s.replace(/^CD[_-]?I/i, "");
}

function toNumberOrNull(x: any): number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const t = toTrimmedString(x);
  if (t === "" || t.toLowerCase() === "na" || t.toLowerCase() === "null") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function clampUiSeason(input: number): number {
  return UI_SEASONS.includes(input) ? input : DEFAULT_SEASON;
}

function isRecentSeasonValue(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= MIN_RECENT_SEASON && value <= DEFAULT_SEASON;
}

function resolveIncomingTeamId(routeTeamId: string | null | undefined, searchParams: URLSearchParams): string {
  const candidates = [
    routeTeamId,
    searchParams.get("team"),
    searchParams.get("teamId"),
    searchParams.get("club"),
    searchParams.get("clubName"),
    searchParams.get("teamName"),
    searchParams.get("code"),
  ];

  for (const candidate of candidates) {
    const teamId = coerceTeamId(candidate);
    if (isKnownTeamId(teamId)) return teamId;
  }

  return DEFAULT_TEAM_ID;
}

function pickSeasonRow<T extends { season: number }>(
  rows: T[],
  targetSeason: number
): { row: T | null; usedSeason: number | null; isExact: boolean } {
  if (!rows.length) return { row: null, usedSeason: null, isExact: false };
  const sorted = [...rows].sort((a, b) => a.season - b.season);
  const exact = sorted.find((r) => r.season === targetSeason);
  if (exact) return { row: exact, usedSeason: targetSeason, isExact: true };

  const pastOrCurrent = sorted.filter((r) => r.season <= targetSeason);
  if (pastOrCurrent.length) {
    const row = pastOrCurrent[pastOrCurrent.length - 1];
    return { row, usedSeason: row.season, isExact: false };
  }

  const latest = sorted[sorted.length - 1];
  return { row: latest, usedSeason: latest.season, isExact: false };
}

async function loadApiDataAsObjects<T>(file: string, mapper: (r: Record<string, any>) => T | null): Promise<T[]> {
  const { rows } = await fetchApiRows(file);
  const out: T[] = [];

  for (const r of rows) {
    const obj = mapper((r ?? {}) as Record<string, any>);
    if (obj) out.push(obj);
  }
  return out;
}

async function loadOptionalApiDataAsObjects<T>(
  file: string,
  mapper: (r: Record<string, any>) => T | null
): Promise<T[]> {
  try {
    return await loadApiDataAsObjects(file, mapper);
  } catch (err: any) {
    const message = String(err?.message ?? err ?? "");
    if (
      /invalid file/i.test(message) ||
      /failed to load .*local snapshots \(404\)/i.test(message) ||
      /blobnotfound/i.test(message) ||
      /the specified blob does not exist/i.test(message) ||
      /failed to load .* via api \(404\)/i.test(message)
    ) {
      return [];
    }
    throw err;
  }
}

function parseLastUpdatedLabel(value: string | null): string {
  const raw = toTrimmedString(value);
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isFinite(d.getTime())) {
    return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  }
  return "";
}

async function fetchLocalManifest(): Promise<any | null> {
  if (!localDataManifestPromise) {
    localDataManifestPromise = (async () => {
      try {
        const res = await fetch(`${LOCAL_DATA_BASE}/manifest.json`, { cache: "no-store" });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    })();
  }
  return localDataManifestPromise;
}

async function fetchApiRows(file: string): Promise<{ rows: Record<string, any>[]; lastUpdatedLabel: string }> {
  if (USE_LOCAL_DATA) {
    const url = `${LOCAL_DATA_BASE}/${file}.json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${file} from local snapshots (${res.status})`);

    const json = await res.json();
    const rows = Array.isArray(json) ? json : [];
    const manifest = await fetchLocalManifest();
    const entry = Array.isArray(manifest?.files) ? manifest.files.find((f: any) => f?.file === file) : null;
    const lastUpdatedLabel = parseLastUpdatedLabel(entry?.lastModified ?? manifest?.generatedAt ?? null);
    return { rows, lastUpdatedLabel };
  }

  const url = `/api/data?file=${encodeURIComponent(file)}`;

  const headers: Record<string, string> = {};
  if (DATA_API_KEY) headers["x-data-key"] = DATA_API_KEY;

  const res = await fetch(url, { headers });

  // Helpful error messages (especially when the API key isn't present)
  if (res.status === 401) {
    throw new Error(
      DATA_API_KEY
        ? `Unauthorized calling ${url} (check VITE_DATA_API_KEY matches DATA_API_KEY in SWA Environment Variables)`
        : `Unauthorized calling ${url} (no VITE_DATA_API_KEY set in the frontend)`
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text ? `Failed to load ${file} via API (${res.status}): ${text}` : `Failed to load ${file} via API (${res.status})`);
  }

  const json = await res.json();
  const rows = Array.isArray(json) ? json : [];
  const lastUpdatedLabel = parseLastUpdatedLabel(
    res.headers.get("x-file-last-modified") ??
      res.headers.get("x-last-modified") ??
      res.headers.get("last-modified")
  );

  return { rows, lastUpdatedLabel };
}

async function loadApiDataAsObjectsWithMeta<T>(
  file: string,
  mapper: (r: Record<string, any>) => T | null
): Promise<{ rows: T[]; lastUpdatedLabel: string }> {
  const { rows, lastUpdatedLabel } = await fetchApiRows(file);
  const out: T[] = [];
  for (const r of rows) {
    const obj = mapper((r ?? {}) as Record<string, any>);
    if (obj) out.push(obj);
  }
  return { rows: out, lastUpdatedLabel };
}

// Try multiple possible blob filenames (helps when you rename a CSV in Azure Blob)
async function loadApiDataAsObjectsWithFallback<T>(
  files: string[],
  mapper: (r: Record<string, any>) => T | null
): Promise<T[]> {
  let lastErr: any = null;
  for (const f of files) {
    try {
      return await loadApiDataAsObjects<T>(f, mapper);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`Failed to load any of: ${files.join(", ")}`);
}


// --------------------
// UI bits
// --------------------
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.92)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 22,
        padding: 14,
        boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  Icon,
  imgSrc,
}: {
  label: string;
  value: string;
  sub: string;
  Icon: any;
  imgSrc?: string | null;
}) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, color: "rgba(0,0,0,0.6)", marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3, color: "#111" }}>{value}</div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(0,0,0,0.5)",
              marginTop: 4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={sub}
          >
            {sub}
          </div>
        </div>

        <div
          style={{
            height: 40,
            width: 40,
            borderRadius: 14,
            background: "rgba(0,0,0,0.05)",
            display: "grid",
            placeItems: "center",
            border: "1px solid rgba(0,0,0,0.08)",
            overflow: "hidden",
          }}
        >
          {imgSrc ? (
            <img
              src={imgSrc}
              alt=""
              style={{ height: "100%", width: "100%", objectFit: "cover" }}
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
            />
          ) : (
            <Icon size={18} color="rgba(0,0,0,0.7)" />
          )}
        </div>
      </div>
    </Card>
  );
}

function Pill({
  active,
  children,
  onClick,
  disabled,
  size = "md",
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  size?: "xs" | "sm" | "md";
}) {
  const isSmall = size === "sm";
  const isXs = size === "xs";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 999,
        padding: isXs ? "4px 8px" : isSmall ? "5px 9px" : "8px 12px",
        border: "1px solid rgba(0,0,0,0.14)",
        background: active ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.8)",
        color: "rgba(0,0,0,0.8)",
        fontSize: isXs ? 10 : isSmall ? 11 : 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#111" }}>{title}</div>
      {right}
    </div>
  );
}

// ---- Diff colouring (green positive, red negative)
function diffColor(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "rgba(0,0,0,0.60)";
  if (n > 0) return "#059669"; // green
  if (n < 0) return "#DC2626"; // red
  return "rgba(0,0,0,0.60)";
}

// ---- Custom label above histogram columns
function ColumnTopLabel({ x, y, width, value }: any) {
  const tx = (x ?? 0) + (width ?? 0) / 2;
  const ty = Math.max(12, (y ?? 0) - 6);
  return (
    <text x={tx} y={ty} textAnchor="middle" fill="rgba(0,0,0,0.65)" fontSize={11}>
      {value}
    </text>
  );
}

// ---- Horizontal bar rows
function HorizontalBarRows({
  rows,
  labelKey,
  valueKey,
  getColor,
  barHeight = 14,
  valueColWidth = 44,
  labelCol = { min: 130, ideal: 170, max: 240 },
  rowGap = 12,
  colGap = 10,
}: {
  rows: any[];
  labelKey: string;
  valueKey: string;
  getColor?: (label: string) => string;
  barHeight?: number;
  valueColWidth?: number;
  labelCol?: { min: number; ideal: number; max: number };
  rowGap?: number;
  colGap?: number;
}) {
  const max = Math.max(
    1,
    ...rows.map((r) => {
      const n = Number(r[valueKey]);
      return Number.isFinite(n) ? n : 0;
    })
  );
  const labelColTemplate = `${labelCol.ideal}px 1fr`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: rowGap, marginTop: 6 }}>
      {rows.map((r) => {
        const value = Number(r[valueKey]);
        const safeValue = Number.isFinite(value) ? value : 0;
        const pct = (safeValue / max) * 100;
        const label = String(r[labelKey] ?? "");

        return (
          <div
            key={label}
            style={{
              display: "grid",
              gridTemplateColumns: labelColTemplate,
              gap: colGap,
              alignItems: "center",
            }}
          >
            <div
              style={{
                fontSize: 14,
                color: "rgba(0,0,0,0.72)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={r[labelKey]}
            >
              {label}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: `1fr ${valueColWidth}px`, gap: 8, alignItems: "center" }}>
              {/* Simple rectangular bar (track + fill) */}
              <div
                style={{
                  position: "relative",
                  height: barHeight,
                  background: "rgba(0,0,0,0.08)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: getColor ? getColor(label) : AGE_CAT_COLOR[label] ?? "rgba(0,0,0,0.65)",
                  }}
                />
              </div>
              <div style={{ fontSize: 12, color: "rgba(0,0,0,0.6)", textAlign: "right", lineHeight: 1 }}>
                {Number.isFinite(value) ? `${value.toFixed(0)}%` : "—"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --------------------
// Derived helpers
// --------------------
function makeAgeHistogram(players: RosterPlayerRow[]) {
  const bins = Array.from({ length: 35 - 18 + 1 }, (_, i) => 18 + i);
  const counts = new Map<number, number>();
  bins.forEach((a) => counts.set(a, 0));
  for (const p of players) {
    const a = Math.round(p.age);
    if (a >= 18 && a <= 35) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return bins.map((age) => ({ age, count: counts.get(age) ?? 0, label: String(age) }));
}


function safeYoY(v: number | null | undefined, decimals = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "YoY: —";
  const s = v >= 0 ? "+" : "";
  return `YoY: ${s}${v.toFixed(decimals)}`;
}

// --------------------
// Player projection table
// --------------------
type PlayerTableRow = { name: string; rating: number; salary: number | null; AA: number | null; Games: number | null };

function PlayerProjectionTable({ rows }: { rows: PlayerTableRow[] }) {
  return (
    <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 0.6fr 1fr 0.7fr",
          background: "rgba(0,0,0,0.03)",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
          padding: "10px 12px",
          fontSize: 12,
          fontWeight: 800,
          color: "rgba(0,0,0,0.7)",
        }}
      >
        <div>Player</div>
        <div style={{ textAlign: "right" }}>Rating</div>
        <div style={{ textAlign: "right" }}>Salary</div>
        <div style={{ textAlign: "right" }}>AA%</div>
      </div>

      <div style={{ maxHeight: 260, overflow: "auto" }}>
        {rows.map((r, idx) => (
          <div
            key={`${r.name}-${idx}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1.6fr 0.6fr 1fr 0.7fr",
              padding: "10px 12px",
              borderBottom: idx === rows.length - 1 ? "none" : "1px solid rgba(0,0,0,0.06)",
              fontSize: 13,
              color: "rgba(0,0,0,0.72)",
              alignItems: "center",
            }}
          >
            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>
              {r.name}
            </div>
            <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.rating.toFixed(1)}</div>
            <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {r.salary != null && Number.isFinite(r.salary) ? fmtAUD(r.salary) : "—"}
            </div>
            <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {r.AA != null && Number.isFinite(r.AA) ? formatPct(r.AA * 100) : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


/**
 * CareerProjectionDashboard
 * Mirrors the Python "career trajectory" viz: title + KPI strip + left percentiles + right time-series with CI band.
 * Uses dummy data for now — wire to your API/CSV later.
 */
/**
 * CareerProjectionDashboard
 * Uses career_projections.csv (careerProjections prop) to render:
 * - KPI strip (snapshot at last actual season)
 * - Left: advanced stat placeholders (keep wiring later)
 * - Right: time-series of rating with CI band + salary tooltips
 */

function CareerProjectionDashboard({
  defaultTeam,
  careerProjections,
  careerProjectionsLastUpdated,
  comparablePlayers,
  playerStatsAgg,
  playerProjections,
  rosterPlayers,
  selectedSeason,
  initialPlayerId,
  onPlayerIdChange,
}: {
  defaultTeam: string;
  careerProjections: CareerProjectionRow[];
  careerProjectionsLastUpdated?: string;
  comparablePlayers: ComparablePlayerRow[];
  playerStatsAgg: PlayerStatsAggRow[];
  playerProjections: PlayerProjectionRow[];
  rosterPlayers: RosterPlayerRow[];
  selectedSeason: number;
  initialPlayerId?: string;
  onPlayerIdChange?: (id: string) => void;
}) {
  // Primary club context comes from the top-level team selector (query param)
  const teamOption = getTeamOptionById(defaultTeam);
  const selectedLeague = teamOption?.league ?? "AFL";
  const teamName = (teamOption?.name ?? defaultTeam) as string;
  const teamKey = normalizeClubName(teamName);
  const teamColor = TEAM_PRIMARY_COLOR[teamKey] ?? "#111827";
  const logoSrc = getLogoUrlByClubName(teamName);

  const ordinalSuffix = (n: number) => {
    const v = Math.round(n);
    const mod100 = v % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
    const mod10 = v % 10;
    if (mod10 === 1) return `${v}st`;
    if (mod10 === 2) return `${v}nd`;
    if (mod10 === 3) return `${v}rd`;
    return `${v}th`;
  };

  const pctColor = (p: number) => {
    // red → yellow → green (0..100)
    const t = Math.max(0, Math.min(1, p / 100));
    const lerp = (a: number, b: number, x: number) => Math.round(a + (b - a) * x);
    const r0 = { r: 215, g: 48, b: 39 }; // #d73027
    const r1 = { r: 254, g: 224, b: 139 }; // #fee08b
    const r2 = { r: 26, g: 152, b: 80 }; // #1a9850
    let c;
    if (t < 0.5) {
      const x = t / 0.5;
      c = { r: lerp(r0.r, r1.r, x), g: lerp(r0.g, r1.g, x), b: lerp(r0.b, r1.b, x) };
    } else {
      const x = (t - 0.5) / 0.5;
      c = { r: lerp(r1.r, r2.r, x), g: lerp(r1.g, r2.g, x), b: lerp(r1.b, r2.b, x) };
    }
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
  };

  // ---------- Player pickers ----------
  // Primary list: players at the selected club (if team column exists)
  const clubPlayers = useMemo(() => {
    const map = new Map<string, { name: string; id: string; team?: string; pos?: string }>();
    for (const r of careerProjections) {
      const t = toTrimmedString(r.team);
      if (t) {
        const resolved = resolveTeamIdentity(t, t, "AFL");
        if (normalizeTeamId(resolved.team_id) !== normalizeTeamId(defaultTeam)) continue;
      }
      const id = normalizePlayerId(r.SourceproviderId);
      const name = toTrimmedString(r.SourcePlayer);
      if (!id || !name) continue;
      const key = `${id}__${name}`;
      if (!map.has(key)) map.set(key, { name, id, team: r.team, pos: r.SourcePosition });
    }

    for (const r of rosterPlayers) {
      if (
        normalizeTeamId(r.team_id) !== normalizeTeamId(defaultTeam) ||
        r.league !== selectedLeague
      ) {
        continue;
      }
      const id = normalizePlayerId(r.providerId);
      const name = toTrimmedString(r.player_name);
      if (!id || !name) continue;
      const key = `${id}__${name}`;
      if (!map.has(key)) map.set(key, { name, id, team: r.team, pos: r.position_group });
    }

    for (const r of playerProjections) {
      if (
        normalizeTeamId(r.team_id) !== normalizeTeamId(defaultTeam) ||
        r.league !== selectedLeague
      ) {
        continue;
      }
      const id = normalizePlayerId(r.playerId);
      const name = toTrimmedString(r.player_name);
      if (!id || !name) continue;
      const key = `${id}__${name}`;
      if (!map.has(key)) map.set(key, { name, id, team: r.team });
    }

    const out = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    return out.length ? out : [{ name: "Select a player", id: "" }];
  }, [careerProjections, rosterPlayers, playerProjections, defaultTeam, selectedLeague]);

  // Compare list: any player in the database
  const allPlayers = useMemo(() => {
    const map = new Map<string, { name: string; id: string; team?: string; pos?: string }>();
    for (const r of careerProjections) {
      const id = normalizePlayerId(r.SourceproviderId);
      const name = toTrimmedString(r.SourcePlayer);
      if (!id || !name) continue;
      const key = `${id}__${name}`;
      if (!map.has(key)) map.set(key, { name, id, team: r.team, pos: r.SourcePosition });
    }
    for (const r of rosterPlayers) {
      const id = normalizePlayerId(r.providerId);
      const name = toTrimmedString(r.player_name);
      if (!id || !name) continue;
      const key = `${id}__${name}`;
      if (!map.has(key)) map.set(key, { name, id, team: r.team, pos: r.position_group });
    }
    for (const r of playerProjections) {
      const id = normalizePlayerId(r.playerId);
      const name = toTrimmedString(r.player_name);
      if (!id || !name) continue;
      const key = `${id}__${name}`;
      if (!map.has(key)) map.set(key, { name, id, team: r.team });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [careerProjections, rosterPlayers, playerProjections]);

  const [playerId, setPlayerId] = useState<string>(() => (
    initialPlayerId && clubPlayers.some((p) => normalizePlayerId(p.id) === normalizePlayerId(initialPlayerId))
      ? initialPlayerId
      : clubPlayers[0]?.id ?? ""
  ));

  // Keep the selected player stable on deep links:
  // 1) If the URL provides a valid playerId, prefer it.
  // 2) Otherwise (or if invalid), fall back to the first player for the selected club.
  //
  // This avoids a race where we briefly select the first alphabetical player and immediately
  // rewrite the URL, even though the deep-linked player exists once data has loaded.
  useEffect(() => {
    if (!clubPlayers.length) return;

    const desired =
      initialPlayerId && clubPlayers.some((p) => normalizePlayerId(p.id) === normalizePlayerId(initialPlayerId))
        ? initialPlayerId
        : (playerId && clubPlayers.some((p) => normalizePlayerId(p.id) === normalizePlayerId(playerId)) ? playerId : null);

    if (desired && normalizePlayerId(desired) !== normalizePlayerId(playerId)) {
      setPlayerId(desired);
      return;
    }

    if (!desired) {
      setPlayerId(clubPlayers[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubPlayers, initialPlayerId]);
// Bubble selection up so the URL can stay in sync (for share links / embeds)
  useEffect(() => {
    if (!playerId) return;
    onPlayerIdChange?.(playerId);
  }, [playerId, onPlayerIdChange]);


  const [comparePlayerId, setComparePlayerId] = useState<string>(""); // "" = off
  const [compareQuery, setCompareQuery] = useState<string>("");
  const [showComparablePlayers, setShowComparablePlayers] = useState<boolean>(false);

  // keep the text box in sync when compare id changes (e.g. from URL updates)
  useEffect(() => {
    if (!comparePlayerId) {
      setCompareQuery("");
      return;
    }
    const p = allPlayers.find((x) => x.id === comparePlayerId);
    if (p) setCompareQuery(p.name);
  }, [comparePlayerId, allPlayers]);

  useEffect(() => {
    // if compare player is the same as primary, clear it
    if (comparePlayerId && comparePlayerId === playerId) setComparePlayerId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const player = useMemo(() => clubPlayers.find((p) => p.id === playerId) ?? clubPlayers[0], [clubPlayers, playerId]);
  const comparePlayer = useMemo(
    () => (comparePlayerId ? allPlayers.find((p) => p.id === comparePlayerId) ?? null : null),
    [allPlayers, comparePlayerId]
  );

  type OutlookMode = "neutral" | "optimistic" | "pessimistic";
  const [outlook, setOutlook] = useState<OutlookMode>("neutral");
  type ProjectionMetric = "rating" | "salary";
  const [projectionMetric, setProjectionMetric] = useState<ProjectionMetric>("rating");


  const headshotUrl = player?.id ? getPlayerImgUrl(player.id, player.name) : null;

  // ---------- Build trajectories ----------
  function buildTrajectoryForId(id: string) {
    if (!id) return [] as any[];

    const rows = careerProjections
      .filter((r) => normalizePlayerId(r.SourceproviderId) === normalizePlayerId(id))
      .sort((a, b) => a.Season - b.Season);

    const pickFirstPositive = (vals: Array<number | null | undefined>) => {
      for (const v of vals) {
        if (v == null) continue;
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return null;
    };

    const seasonsNeutral = pickFirstPositive(rows.map((r) => (r as any).Seasons));
    const seasonsOpt = pickFirstPositive(rows.map((r) => (r as any).Season_90));
    const yearsToProject = outlook === "optimistic" ? seasonsOpt ?? seasonsNeutral : seasonsNeutral;

    const filteredRows = yearsToProject
      ? rows.filter((r) => {
          const type = (r.Type ?? "").toLowerCase();
          const isActual = type === "actual" || type === "hist" || type === "history";
          return isActual || (r.Horizon != null && r.Horizon <= yearsToProject);
        })
      : rows;

    return filteredRows.map((r) => {
      const type = (r.Type ?? "").toLowerCase();
      const isActual = type === "actual" || type === "hist" || type === "history";

      // Scenario selection applies to projections only; actuals stay as-is.
      const asNumOrNull = (v: any) => {
        if (v == null) return null;
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const projEstimate =
        outlook === "optimistic"
          ? asNumOrNull((r as any).Optimistic ?? r.estimate)
          : outlook === "pessimistic"
          ? asNumOrNull((r as any).Pessimistic ?? r.estimate)
          : asNumOrNull(r.estimate);

      const projSalary =
        outlook === "optimistic"
          ? asNumOrNull((r as any).salary_opt ?? r.salary)
          : outlook === "pessimistic"
          ? asNumOrNull((r as any).salary_pes ?? r.salary)
          : asNumOrNull(r.salary);
      const optimisticEstimate = asNumOrNull((r as any).Optimistic ?? r.estimate);
      const pessimisticEstimate = asNumOrNull((r as any).Pessimistic ?? r.estimate);
      const optimisticSalary = asNumOrNull((r as any).salary_opt ?? r.salary);
      const pessimisticSalary = asNumOrNull((r as any).salary_pes ?? r.salary);

      const lower = r.lower;
      const upper = r.upper;

      return {
        season: r.Season,
        actual: isActual ? r.estimate : null,
        estimate: isActual ? null : projEstimate,
        optimistic: isActual ? null : optimisticEstimate,
        pessimistic: isActual ? null : pessimisticEstimate,
        lower0: lower,
        band: lower != null && upper != null ? Math.max(0, upper - lower) : null,
        salary: isActual ? r.salary : projSalary,
        salary_optimistic: isActual ? null : optimisticSalary,
        salary_pessimistic: isActual ? null : pessimisticSalary,
        AA: r.AA,
        Games: r.Games,
        Seasons: r.Seasons,
        Season_90: (r as any).Season_90 ?? null,
        position: toTrimmedString(r.SourcePosition),
        team: toTrimmedString(r.team),
        rank_all: r.rank_all ?? null,
        rank_pos: r.rank_pos ?? null,
        horizon: r.Horizon,
        sourceSeason: r.SourceSeason,

        // Advanced stats (pass-through)
        Ball_Use: r.Ball_Use ?? null,
        Kicking: r.Kicking ?? null,
        Handballing: r.Handballing ?? null,
        Transition_Ball_Use: r.Transition_Ball_Use ?? null,
        Post_Clearance_Ball_Use: r.Post_Clearance_Ball_Use ?? null,
        Clearance_Ball_Use: r.Clearance_Ball_Use ?? null,
        Ball_Winning: r.Ball_Winning ?? null,
        Intercepts: r.Intercepts ?? null,
        Aerial: r.Aerial ?? null,
        Ground: r.Ground ?? null,
        Run_Carry: r.Run_Carry ?? null,
        Turnover_Transition_Ball_Winning: r.Turnover_Transition_Ball_Winning ?? null,
        Stoppage_Transition_Ball_Winning: r.Stoppage_Transition_Ball_Winning ?? null,
        Pre_Clearance_Ball_Winning: r.Pre_Clearance_Ball_Winning ?? null,
        Spoiling: r.Spoiling ?? null,
      };
    });
  }

  const primaryTraj = useMemo(() => (player?.id ? buildTrajectoryForId(player.id) : []), [careerProjections, player?.id, outlook]);
  const compareTraj = useMemo(
    () => (comparePlayer?.id ? buildTrajectoryForId(comparePlayer.id) : []),
    [careerProjections, comparePlayer?.id, outlook]
  );

  const compareTeamKey = useMemo(() => {
    const t = toTrimmedString(compareTraj.find((d: any) => d.team)?.team);
    return t ? normalizeClubName(t) : "";
  }, [compareTraj]);

  const compareColor = useMemo(() => (compareTeamKey ? TEAM_PRIMARY_COLOR[compareTeamKey] ?? "#111111" : "#111111"), [compareTeamKey]);

  // Merge into one chart dataset
  const trajectory = useMemo(() => {
    const seasons = Array.from(new Set([...primaryTraj.map((d: any) => d.season), ...compareTraj.map((d: any) => d.season)])).sort(
      (a, b) => a - b
    );

    const bySeason = new Map<number, any>();
    for (const s of seasons) bySeason.set(s, { season: s });

    for (const d of primaryTraj) {
      const r = bySeason.get(d.season) ?? { season: d.season };
      bySeason.set(d.season, {
        ...r,
        actual_rating: d.actual,
        estimate_rating: d.estimate,
        optimistic_rating: d.optimistic,
        pessimistic_rating: d.pessimistic,
        lower0_rating: d.lower0,
        band_rating: d.band,
        salary_actual: d.actual != null ? d.salary : null,
        salary_estimate: d.estimate != null ? d.salary : null,
        salary_optimistic: d.salary_optimistic,
        salary_pessimistic: d.salary_pessimistic,
        salary: d.salary,
        AA: d.AA,
        Games: d.Games,
        Seasons: d.Seasons,
        position: d.position,
        team: d.team,
        rank_all: d.rank_all,
        rank_pos: d.rank_pos,
        horizon: d.horizon,
        sourceSeason: d.sourceSeason,
      });
    }

    for (const d of compareTraj) {
      const r = bySeason.get(d.season) ?? { season: d.season };
      bySeason.set(d.season, {
        ...r,
        c_actual_rating: d.actual,
        c_estimate_rating: d.estimate,
        c_lower0_rating: d.lower0,
        c_band_rating: d.band,
        c_salary_actual: d.actual != null ? d.salary : null,
        c_salary_estimate: d.estimate != null ? d.salary : null,
        c_salary: d.salary,
      });
    }

    
    // Bridge (dashed) between last actual and first projection so the line reads continuously.
    const lastA = [...primaryTraj].filter((d: any) => d.actual != null).slice(-1)[0] ?? null;
    const firstP = primaryTraj.find((d: any) => d.estimate != null) ?? null;
    if (lastA && firstP && lastA.season !== firstP.season) {
      const ra = bySeason.get(lastA.season) ?? { season: lastA.season };
      const rp = bySeason.get(firstP.season) ?? { season: firstP.season };
      bySeason.set(lastA.season, { ...ra, bridge_rating: lastA.actual, bridge_salary: lastA.salary });
      bySeason.set(firstP.season, { ...rp, bridge_rating: firstP.estimate, bridge_salary: firstP.salary });
    }
    return Array.from(bySeason.values()).sort((a, b) => a.season - b.season);
  }, [primaryTraj, compareTraj]);

  const chartTrajectory = useMemo(() => {
    return (trajectory as any[]).map((d) => ({
      ...d,
      actual: d.actual_rating,
      estimate: d.estimate_rating,
      optimistic: d.optimistic_rating,
      pessimistic: d.pessimistic_rating,
      lower0: d.lower0_rating,
      band: d.band_rating,
      c_actual: d.c_actual_rating,
      c_estimate: d.c_estimate_rating,
      c_lower0: d.c_lower0_rating,
      c_band: d.c_band_rating,
      bridge: d.bridge_rating,
    }));
  }, [trajectory]);

  const ratingBenchmarks = useMemo(() => {
    const seasonSet = new Set((trajectory as any[]).map((d) => d.season));
    if (!seasonSet.size) return { leagueAvg: null as number | null, top10Avg: null as number | null };

    const isActualType = (t: any) => {
      const x = String(t ?? "").toLowerCase();
      return x === "actual" || x === "hist" || x === "history";
    };

    const values: number[] = [];
    for (const r of careerProjections) {
      if (!seasonSet.has(r.Season)) continue;
      if (isActualType((r as any).Type)) continue;
      const v = typeof r.estimate === "number" ? r.estimate : Number(String(r.estimate ?? "").trim());
      if (Number.isFinite(v)) values.push(v);
    }

    if (!values.length) return { leagueAvg: null as number | null, top10Avg: null as number | null };

    const leagueAvg = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const startIdx = Math.max(0, Math.floor(0.9 * sorted.length));
    const topSlice = sorted.slice(startIdx);
    const top10Avg = topSlice.reduce((a, b) => a + b, 0) / topSlice.length;

    return { leagueAvg, top10Avg };
  }, [careerProjections, trajectory]);

  // Dynamic Y-axis domain: min(lower) - 3, max(upper) + 3 (includes compare series when present)
  const yDomain = useMemo<[number, number]>(() => {
    const lows: number[] = [];
    const highs: number[] = [];
    const vals: number[] = [];

    for (const d of chartTrajectory as any[]) {
      const loA = typeof d.lower0 === "number" && Number.isFinite(d.lower0) ? d.lower0 : null;
      const hiA =
        loA != null && typeof d.band === "number" && Number.isFinite(d.band) ? loA + d.band : null;

      const loB = typeof d.c_lower0 === "number" && Number.isFinite(d.c_lower0) ? d.c_lower0 : null;
      const hiB =
        loB != null && typeof d.c_band === "number" && Number.isFinite(d.c_band) ? loB + d.c_band : null;

      if (loA != null) lows.push(loA);
      if (hiA != null) highs.push(hiA);
      if (loB != null) lows.push(loB);
      if (hiB != null) highs.push(hiB);

      const vA = d.actual ?? d.estimate;
      const vOpt = d.optimistic;
      const vPes = d.pessimistic;
      const vB = d.c_actual ?? d.c_estimate;

      if (typeof vA === "number" && Number.isFinite(vA)) vals.push(vA);
      if (typeof vOpt === "number" && Number.isFinite(vOpt)) vals.push(vOpt);
      if (typeof vPes === "number" && Number.isFinite(vPes)) vals.push(vPes);
      if (typeof vB === "number" && Number.isFinite(vB)) vals.push(vB);
    }

    const minBase = lows.length ? Math.min(...lows) : vals.length ? Math.min(...vals) : 4;
    const maxBase = highs.length ? Math.max(...highs) : vals.length ? Math.max(...vals) : 20;

    let min = minBase - 3;
    let max = maxBase + 3;

    const top10 = ratingBenchmarks.top10Avg;
    if (typeof top10 === "number" && Number.isFinite(top10)) {
      // Always include the Top 10% benchmark in-range.
      max = Math.max(max, top10);
      // If Top 10% is the upper bound driver, ensure +1 rating point headroom.
      if (top10 >= maxBase - 1e-6) {
        max = Math.max(max, top10 + 1);
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) return [4, 20];
    if (min === max) {
      min -= 1;
      max += 1;
    }
    if (min > max) {
      const tmp = min;
      min = max;
      max = tmp;
    }

// Round to neat integers so the axis doesn't show awkward decimals
// and avoid a misleading 0 baseline when values are clearly > 0.
const minRounded = Math.floor(min);
const maxRounded = Math.ceil(max);
const minFinal = Math.max(1, minRounded);
const maxFinal = Math.max(minFinal + 1, maxRounded);

return [minFinal, maxFinal];
  }, [chartTrajectory, ratingBenchmarks.top10Avg]);


  // ---------- KPI helpers ----------
  const lastActual = useMemo(() => {
    const actualRows = primaryTraj.filter((d: any) => d.actual != null);
    if (actualRows.length) return actualRows[actualRows.length - 1];

    const candidates = primaryTraj.filter((d: any) => d.estimate != null && d.band == null);
    if (candidates.length) return candidates[candidates.length - 1];

    return primaryTraj.length ? primaryTraj[0] : null;
  }, [primaryTraj]);

  const nextProj = useMemo(() => {
    const p = primaryTraj.find((d: any) => d.estimate != null);
    return p ?? null;
  }, [primaryTraj]);

  const seasonFixed = useMemo(() => {
    const fromSource = primaryTraj.find((d: any) => d.sourceSeason != null)?.sourceSeason ?? null;
    if (fromSource != null) return fromSource;
    return lastActual?.season ?? primaryTraj[0]?.season ?? null;
  }, [primaryTraj, lastActual]);

  const targetProjectionSeason = useMemo(() => {
    const baseSeason = seasonFixed ?? selectedSeason ?? lastActual?.season ?? null;
    return baseSeason == null ? null : baseSeason + 1;
  }, [seasonFixed, selectedSeason, lastActual]);

  const compareSeasonFixed = useMemo(() => {
    const fromSource = compareTraj.find((d: any) => d.sourceSeason != null)?.sourceSeason ?? null;
    if (fromSource != null) return fromSource;
    const lastCompareActual = compareTraj.filter((d: any) => d.actual != null);
    if (lastCompareActual.length > 0) return lastCompareActual[lastCompareActual.length - 1].season ?? null;
    return compareTraj[0]?.season ?? null;
  }, [compareTraj]);

  const compareTargetProjectionSeason = useMemo(() => {
    if (compareSeasonFixed != null) return compareSeasonFixed + 1;
    return targetProjectionSeason;
  }, [compareSeasonFixed, targetProjectionSeason]);
  const optimisticLabelKey = projectionMetric === "salary" ? "salary_optimistic" : "optimistic";
  const pessimisticLabelKey = projectionMetric === "salary" ? "salary_pessimistic" : "pessimistic";

  const pickProjectionRowForSeason = useCallback(
    (pid: string, desiredSeason: number | null): PlayerProjectionRow | null => {
      const rows = playerProjections.filter((p: PlayerProjectionRow) => normalizePlayerId(p.playerId) === pid);
      if (rows.length === 0) return null;

      if (desiredSeason != null) {
        const exact = rows.find((r) => r.season === desiredSeason);
        if (exact) return exact;

        const nearestFuture = rows
          .filter((r) => r.season > desiredSeason)
          .sort((a, b) => a.season - b.season)[0];
        if (nearestFuture) return nearestFuture;
      }

      return [...rows].sort((a, b) => b.season - a.season)[0];
    },
    [playerProjections]
  );

  const comparableTop10 = useMemo(() => {
    if (!showComparablePlayers) return [];
    // Match on providerId + source season (career projection season fixed / selected)
    const sourceProviderId = normalizePlayerId(playerId);
    const sourceSeason = seasonFixed;

    const rows = (comparablePlayers ?? []).filter(
      (r) => normalizePlayerId(r.SourceproviderId) === sourceProviderId && r.SourceSeason === sourceSeason
    );

    const sorted = [...rows].sort((a, b) => {
      // prefer explicit rank if present
      const ra = a.rank ?? null;
      const rb = b.rank ?? null;
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      // otherwise higher similarity first
      return (b.similarity ?? 0) - (a.similarity ?? 0);
    });

    return sorted.slice(0, 10);
  }, [comparablePlayers, playerId, seasonFixed, showComparablePlayers]);

  const outcomeProbs = useMemo(() => {
    const clamp01 = (x: any): number | null => {
      if (x == null) return null;
      const n = typeof x === "number" ? x : Number(String(x).trim());
      if (!Number.isFinite(n)) return null;
      // Handle 0–100 storage (percent) if it ever occurs.
      // If the value is accidentally a *count* (e.g., games played > 100), treat it as not-a-probability.
      if (n > 100) return null;
      const v = n > 1 ? n / 100 : n;
      return Math.max(0, Math.min(1, v));
    };

    // Source AA probability from player_projections (Azure Blob -> API).
    // Games probability is sourced from career_projections below.
    const pid = normalizePlayerId(player?.id);
    const projRow = pid ? pickProjectionRowForSeason(pid, targetProjectionSeason) : null;

    const pickFirst = (row: any, keys: string[]) => {
      for (const k of keys) {
        const v = row?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
      }
      return null;
    };

    const projAA = clamp01(
      pickFirst(projRow, ["AA", "AA_prob", "AA_future_prob", "AA_probability", "AAProb", "AAProbability"])
    );
    // Derive probabilities from career_projections trajectory.
    // IMPORTANT: use projected-season probabilities only (never actual-game counts).
    const pickProbFromTrajectory = (key: "AA" | "Games") => {
      const sourceSeason = seasonFixed ?? null;
      const projectedRows = primaryTraj.filter((d: any) => {
        if (d == null) return false;
        if (sourceSeason != null && typeof d.season === "number") return d.season > sourceSeason;
        return typeof d.horizon === "number" ? d.horizon > 0 : false;
      });

      if (targetProjectionSeason != null) {
        const targetRow = projectedRows.find((d: any) => d.season === targetProjectionSeason && d[key] != null);
        const targetV = clamp01(targetRow?.[key]);
        if (targetV != null) return targetV;
      }

      // Prefer Horizon = 1 projected row when available.
      const h1 = projectedRows.find((d: any) => d.horizon === 1 && d[key] != null);
      const h1v = clamp01(h1?.[key]);
      if (h1v != null) return h1v;

      // Otherwise: first non-null probability-looking value from projected rows only.
      const anyProb = projectedRows
        .sort((a: any, b: any) => (a.season ?? 0) - (b.season ?? 0))
        .map((d: any) => clamp01(d[key]))
        .find((v: any) => v != null);

      return anyProb ?? null;
    };

    return {
      AA: projAA ?? pickProbFromTrajectory("AA"),
      // Games probability is intentionally sourced from career_projections only.
      Games: pickProbFromTrajectory("Games"),
    };
  }, [player, primaryTraj, pickProjectionRowForSeason, targetProjectionSeason, seasonFixed]);

  const rankInfo = useMemo(() => {
    const snapSeason = lastActual?.season ?? null;
    if (!player?.id || snapSeason == null)
      return { all: null as number | null, pos: null as number | null, totalAll: null as number | null, totalPos: null as number | null };

    const seasonRows = careerProjections.filter((r) => r.Season === snapSeason);
    const hasActual = seasonRows.some((r) => ["actual", "hist", "history"].includes((r.Type ?? "").toLowerCase()));
    const usable = hasActual ? seasonRows.filter((r) => ["actual", "hist", "history"].includes((r.Type ?? "").toLowerCase())) : seasonRows;

    const playerRow =
      usable.find((r) => normalizePlayerId(r.SourceproviderId) === normalizePlayerId(player.id)) ??
      seasonRows.find((r) => normalizePlayerId(r.SourceproviderId) === normalizePlayerId(player.id)) ??
      null;

    const playerPos = toTrimmedString(playerRow?.SourcePosition);

    // Build a unique player list for counts (and as fallback for ranks)
    const byPlayer = new Map<string, { id: string; pos: string; rating: number }>();
    for (const r of usable) {
      const id = normalizePlayerId(r.SourceproviderId);
      if (!id) continue;
      const rating = r.estimate ?? null;
      if (rating == null) continue;
      const pos = toTrimmedString(r.SourcePosition);
      const prev = byPlayer.get(id);
      if (!prev || rating > prev.rating) byPlayer.set(id, { id, pos, rating });
    }

    const allSorted = Array.from(byPlayer.values()).sort((a, b) => b.rating - a.rating);
    const totalAll = allSorted.length || null;

    const posSorted = playerPos ? allSorted.filter((x) => toTrimmedString(x.pos) === playerPos) : [];
    const totalPos = posSorted.length || null;

    // Prefer direct ranks from the export if available
    const directAll = playerRow?.rank_all ?? null;
    const directPos = playerRow?.rank_pos ?? null;

    if (directAll != null || directPos != null) return { all: directAll, pos: directPos, totalAll, totalPos };

    // Fallback: compute ranks from season estimate
    const allIdx = allSorted.findIndex((x) => x.id === player.id);
    const all = allIdx >= 0 ? allIdx + 1 : null;

    const posIdx = posSorted.findIndex((x) => x.id === player.id);
    const pos = posIdx >= 0 ? posIdx + 1 : null;

    return { all, pos, totalAll, totalPos };
  }, [careerProjections, player, lastActual]);

  const kpis = useMemo(() => {
    const mv = nextProj?.salary ?? lastActual?.salary ?? null;

    // Career value = sum of future salaries (projected years)
    const snapSeason = lastActual?.season ?? null;
    const careerValue =
      snapSeason == null
        ? null
        : primaryTraj
            .filter((d: any) => d.season > snapSeason && d.salary != null)
            .reduce((acc: number, d: any) => acc + Number(d.salary), 0);

    const rankAll = rankInfo?.all ?? null;
    const rankPos = rankInfo?.pos ?? null;
    const totalAll = rankInfo?.totalAll ?? null;
    const totalPos = rankInfo?.totalPos ?? null;

    // Player vitals come from career_projections.csv (Height / Age / Drafted columns).
    // Match IDs using the same normalization as the rest of the dashboard, then
    // prefer the selected snapshot season when available.
    const vitals = (() => {
      const pid = normalizePlayerId(player?.id ?? "");
      if (!pid) return { height: null as string | null, age: null as string | null, drafted: null as string | null };

      const rows = careerProjections.filter((r) => normalizePlayerId(r.SourceproviderId) === pid);
      const rosterAge = (() => {
        const rosterRows = rosterPlayers.filter((r) => normalizePlayerId(r.providerId) === pid);
        if (!rosterRows.length) return null as string | null;
        const row =
          rosterRows.find((r) => r.season === selectedSeason) ??
          rosterRows.reduce((best, r) => (Math.abs(r.season - selectedSeason) < Math.abs(best.season - selectedSeason) ? r : best), rosterRows[0]);
        const ageNum = typeof row?.age === "number" && Number.isFinite(row.age) ? Math.round(row.age) : null;
        return ageNum != null ? `${ageNum}yr` : null;
      })();
      const draftLabel = (r: CareerProjectionRow): string | null => {
        const drafted = toPresentString(r.Drafted);
        if (drafted) return drafted;
        const draftYear = toPresentString(r.draftYear);
        return draftYear ? `Draft ${draftYear}` : null;
      };
      const vitalsScore = (r: CareerProjectionRow) =>
        [toPresentString(r.Height), toPresentString(r.Age), draftLabel(r)].filter(Boolean).length;
      const seasonMatch = (r: CareerProjectionRow) => seasonFixed != null && (r.SourceSeason === seasonFixed || r.Season === seasonFixed);
      const rankRows = (arr: CareerProjectionRow[]) =>
        [...arr].sort((a, b) => {
          const scoreDiff = vitalsScore(b) - vitalsScore(a);
          if (scoreDiff !== 0) return scoreDiff;
          return (a.Horizon ?? Number.MAX_SAFE_INTEGER) - (b.Horizon ?? Number.MAX_SAFE_INTEGER);
        });

      const pick = rankRows(rows.filter((r) => seasonMatch(r)))[0] ?? rankRows(rows)[0];

      return {
        height: toPresentString(pick?.Height),
        age: toPresentString(pick?.Age) || rosterAge || null,
        drafted: pick ? draftLabel(pick) : null,
      };
    })();

    return [
      {
        label: "Market Value",
        value: mv != null ? `$${Math.round(mv / 1000)}k` : "—",
        sub: careerValue != null && Number.isFinite(careerValue) ? `Career value: ${fmtAUD(careerValue)}` : "",
      },
      {
        label: "Rank (AFL)",
        value: rankAll != null ? ordinalSuffix(rankAll) : "—",
        sub: totalAll != null ? `out of ${totalAll} players` : "",
      },
      {
        label: "Rank (Position)",
        value: rankPos != null ? ordinalSuffix(rankPos) : "—",
        sub: totalPos != null ? `out of ${totalPos} position players` : "",
      },
      {
        label: "Vitals",
        value: vitals.height ?? (vitals.age ? `Age ${vitals.age}` : "—"),
        sub: vitals.height ? `${vitals.age ? `Age ${vitals.age}` : "Age —"} • ${vitals.drafted ?? "Draft —"}` : (vitals.drafted ?? "Draft —"),
      },
    ];
  }, [lastActual, nextProj, rankInfo, primaryTraj, outlook, careerProjections, player?.id, seasonFixed, rosterPlayers, selectedSeason]);

  // ----------------------------------------
  // Advanced stats (left panel)
  // Your CSV now stores RAW metric values. We convert them to percentiles
  // based on: Season (row.Season) + Metric column.
  // ----------------------------------------

  const ADV_METRICS: { label: string; key: keyof any }[] = [
    { label: "Ball Use", key: "Ball_Use" },
    { label: "Kicking", key: "Kicking" },
    { label: "Handballing", key: "Handballing" },
    { label: "Transition", key: "Transition_Ball_Use" },
    { label: "Post clearance", key: "Post_Clearance_Ball_Use" },
    { label: "Clearance", key: "Clearance_Ball_Use" },
    { label: "Ball Winning", key: "Ball_Winning" },
    { label: "Intercepts", key: "Intercepts" },
    { label: "Aerial", key: "Aerial" },
    { label: "Ground", key: "Ground" },
    { label: "Run/Carry", key: "Run_Carry" },
    { label: "TO-Transition", key: "Turnover_Transition_Ball_Winning" },
    { label: "Stopp-Transition", key: "Stoppage_Transition_Ball_Winning" },
    { label: "Pre clearance", key: "Pre_Clearance_Ball_Winning" },
    { label: "Spoiling", key: "Spoiling" },
  ];

  // Build season+metric distributions once.
  // We dedupe to 1 row per player per season (take the first encountered row).
  const advDistributions = useMemo(() => {
    const seasonPlayerRow = new Map<number, Map<string, any>>();

    const isActualType = (t: any) => {
      const x = String(t ?? "").toLowerCase();
      return x === "actual" || x === "hist" || x === "history";
    };

    for (const r of careerProjections) {
      const season = r.Season;
      const id = normalizePlayerId(r.SourceproviderId);
      if (!id || season == null) continue;

      let byPlayer = seasonPlayerRow.get(season);
      if (!byPlayer) {
        byPlayer = new Map();
        seasonPlayerRow.set(season, byPlayer);
      }
      const prev = byPlayer.get(id);
      if (!prev) {
        byPlayer.set(id, r);
      } else {
        // Prefer actual/history rows when available (avoids accidentally
        // using a projected row for the same season/player).
        const prevIsActual = isActualType((prev as any).Type);
        const curIsActual = isActualType((r as any).Type);
        if (!prevIsActual && curIsActual) byPlayer.set(id, r);
      }
    }

    const out = new Map<number, Record<string, number[]>>();

    for (const [season, byPlayer] of seasonPlayerRow.entries()) {
      const buckets: Record<string, number[]> = {};
      for (const m of ADV_METRICS) buckets[String(m.key)] = [];

      for (const row of byPlayer.values()) {
        for (const m of ADV_METRICS) {
          const v: any = (row as any)[m.key];
          const n = typeof v === "number" ? v : v == null ? NaN : Number(String(v).trim());
          if (Number.isFinite(n)) buckets[String(m.key)].push(n);
        }
      }

      // Sort arrays for fast percentile lookup
      for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => a - b);
      out.set(season, buckets);
    }

    return out;
  }, [careerProjections]);

  const percentileFromSorted = (val: number, sorted: number[]) => {
    if (!sorted.length) return null;
    // percentile = (less + 0.5*equal) / n * 100
    // Use binary search boundaries for equal range.
    const n = sorted.length;

    let lo = 0,
      hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < val) lo = mid + 1;
      else hi = mid;
    }
    const firstGE = lo;

    lo = 0;
    hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= val) lo = mid + 1;
      else hi = mid;
    }
    const firstGT = lo;

    const less = firstGE;
    const eq = Math.max(0, firstGT - firstGE);
    return ((less + 0.5 * eq) / n) * 100;
  };

  const skillRows = useMemo(() => {
    const snap: any = lastActual ?? nextProj ?? null;
    const season = snap?.season ?? null;
    const seasonBuckets = season != null ? advDistributions.get(season) : null;

    return ADV_METRICS.map((m) => {
      const raw: any = snap?.[m.key];
      const v = typeof raw === "number" ? raw : raw == null ? null : Number(String(raw).trim());
      if (v == null || !Number.isFinite(v)) return { label: m.label, p: null as number | null };
      const dist = seasonBuckets?.[String(m.key)] ?? [];
      const p = percentileFromSorted(v, dist);
      return { label: m.label, p };
    });
  }, [lastActual, nextProj, advDistributions]);

  // ---- Player compare sidebar (similar to team compare panel)
  const [comparePanelOpen, setComparePanelOpen] = useState(false);

  const playerCompareRows = useMemo(() => {
    if (!comparePlayer) return [] as { category: string; rows: { metric: string; a: number; b: number; diff: number }[] }[];
    const snapSeason = lastActual?.season ?? null;
    if (snapSeason == null) return [];

    const seasonRows = playerStatsAgg.filter((r) => r.season === snapSeason);
    if (!seasonRows.length) return [];

    const aId = String(player.id).trim();
    const bId = String(comparePlayer.id).trim();

    const byMetric = new Map<string, { category: string; vals: number[]; a?: number; b?: number }>();

    for (const r of seasonRows) {
      const metric = toTrimmedString(r.metric_name);
      if (!metric) continue;

      let rec = byMetric.get(metric);
      if (!rec) {
        rec = { category: toTrimmedString(r.category) || "Other", vals: [] };
        byMetric.set(metric, rec);
      }

      if (typeof r.metric_value === "number" && Number.isFinite(r.metric_value)) rec.vals.push(r.metric_value);

      const pid = String(r.player_id).trim();
      if (pid === aId) rec.a = r.metric_value;
      if (pid === bId) rec.b = r.metric_value;
    }

    const percentile = (val: number, arr: number[]) => {
      if (!arr.length) return null;
      const less = arr.filter((x) => x < val).length;
      const eq = arr.filter((x) => x === val).length;
      return ((less + 0.5 * eq) / arr.length) * 100;
    };

    const flat: { category: string; metric: string; a: number; b: number; diff: number }[] = [];
    for (const [metric, rec] of byMetric.entries()) {
      if (rec.a == null || rec.b == null) continue;
      if (rec.vals.length < 8) continue; // avoid tiny samples
      const aPct = percentile(rec.a, rec.vals);
      const bPct = percentile(rec.b, rec.vals);
      if (aPct == null || bPct == null) continue;
      flat.push({ category: rec.category, metric, a: aPct, b: bPct, diff: aPct -bPct });
    }

    const CATEGORY_ORDER = ["Ball Use", "Ball Winning", "Defence", "Pressure", "Stoppage", "Scoreboard Impact", "Ruck"];

    const grouped = new Map<string, { category: string; rows: { metric: string; a: number; b: number; diff: number }[] }>();
    for (const r of flat) {
      const key = r.category || "Other";
      if (!grouped.has(key)) grouped.set(key, { category: key, rows: [] });
      grouped.get(key)!.rows.push({ metric: r.metric, a: r.a, b: r.b, diff: r.diff });
    }

    const groups = Array.from(grouped.values());
    groups.sort((g1, g2) => {
      const i1 = CATEGORY_ORDER.indexOf(g1.category);
      const i2 = CATEGORY_ORDER.indexOf(g2.category);
      if (i1 === -1 && i2 === -1) return g1.category.localeCompare(g2.category);
      if (i1 === -1) return 1;
      if (i2 === -1) return -1;
      return i1 - i2;
    });

    for (const g of groups) g.rows.sort((a, b) => a.metric.localeCompare(b.metric));
    return groups;
  }, [playerStatsAgg, comparePlayer, lastActual, player]);


  const compareOutcomeProbs = useMemo(() => {
    if (!comparePlayer) return { AA: null as number | null, Games: null as number | null };

    const clamp01 = (x: any): number | null => {
      if (x == null) return null;
      const n = typeof x === "number" ? x : Number(String(x).trim());
      if (!Number.isFinite(n)) return null;
      if (n > 100) return null;
      const v = n > 1 ? n / 100 : n;
      return Math.max(0, Math.min(1, v));
    };

    const pid = normalizePlayerId(comparePlayer.id);
    const projRow = pid ? pickProjectionRowForSeason(pid, compareTargetProjectionSeason) : null;

    const pickFirst = (row: any, keys: string[]) => {
      for (const k of keys) {
        const v = row?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
      }
      return null;
    };

    const projAA = clamp01(
      pickFirst(projRow, ["AA", "AA_prob", "AA_future_prob", "AA_probability", "AAProb", "AAProbability"])
    );
    const rows = compareTraj;
    const pickProbFromTrajectory = (key: "AA" | "Games") => {
      const sourceSeason = compareSeasonFixed ?? null;
      const projectedRows = rows.filter((d: any) => {
        if (d == null) return false;
        if (sourceSeason != null && typeof d.season === "number") return d.season > sourceSeason;
        return typeof d.horizon === "number" ? d.horizon > 0 : false;
      });

      if (compareTargetProjectionSeason != null) {
        const targetRow = projectedRows.find((d: any) => d.season === compareTargetProjectionSeason && d[key] != null);
        const targetV = clamp01(targetRow?.[key]);
        if (targetV != null) return targetV;
      }

      const h1 = projectedRows.find((d: any) => d.horizon === 1 && d[key] != null);
      const h1v = clamp01(h1?.[key]);
      if (h1v != null) return h1v;
      const anyProb = projectedRows
        .sort((a: any, b: any) => (a.season ?? 0) - (b.season ?? 0))
        .map((d: any) => clamp01(d[key]))
        .find((v: any) => v != null);
      return anyProb ?? null;
    };

    return {
      AA: projAA ?? pickProbFromTrajectory("AA"),
      // Games probability is intentionally sourced from career_projections only.
      Games: pickProbFromTrajectory("Games"),
    };
  }, [comparePlayer, compareTraj, pickProjectionRowForSeason, compareTargetProjectionSeason, compareSeasonFixed]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 22, fontWeight: 950, letterSpacing: -0.4, lineHeight: 1.05, color: "#111" }}>
              {player?.name ?? "Career Trajectory"}
            </div>
            <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>{teamName}</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>Player</div>
            <select
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              style={{
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.14)",
                background: "rgba(255,255,255,0.9)",
                color: "rgba(0,0,0,0.82)",
                cursor: "pointer",
                fontWeight: 700,
                minWidth: 240,
              }}
            >
              {clubPlayers.map((p) => (
                <option key={`${p.id}-${p.name}`} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>Outlook</div>
            <select
              value={outlook}
              onChange={(e) => setOutlook(e.target.value as OutlookMode)}
              style={{
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.14)",
                background: "rgba(255,255,255,0.9)",
                color: "rgba(0,0,0,0.82)",
                cursor: "pointer",
                fontWeight: 700,
                minWidth: 170,
              }}
            >
              <option value="neutral">Neutral</option>
              <option value="optimistic">Optimistic</option>
              <option value="pessimistic">Pessimistic</option>
            </select>
          </div>


          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>Compare</div>
            <input
              list="compare-player-list"
              value={compareQuery}
              onChange={(e) => {
                const v = e.target.value;
                setCompareQuery(v);
                if (!v) {
                  setComparePlayerId("");
                  return;
                }
                const match = allPlayers.find((p) => p.name.toLowerCase() === v.toLowerCase());
                if (match) setComparePlayerId(match.id);
              }}
              placeholder="Type a player…"
              style={{
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.14)",
                background: "rgba(255,255,255,0.9)",
                color: "rgba(0,0,0,0.82)",
                fontWeight: 700,
                minWidth: 260,
              }}
            />
            <datalist id="compare-player-list">
              {allPlayers.map((p) => (
                <option key={`copt-${p.id}-${p.name}`} value={p.name} />
              ))}
            </datalist>
          </div>
        </div>
      </div>

      <button
        onClick={() => setShowComparablePlayers(true)}
        style={{
          fontSize: 12,
          padding: "9px 12px",
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.14)",
          background: "rgba(255,255,255,0.95)",
          color: "rgba(0,0,0,0.82)",
          fontWeight: 800,
          cursor: "pointer",
        }}
        title="Show the 10 most comparable players (with their next-10-year adjusted performance trend)"
      >
        Comparable Players
      </button>

      {showComparablePlayers && (
        <div
          onClick={() => setShowComparablePlayers(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1100px, 96vw)",
              maxHeight: "90vh",
              overflow: "auto",
              borderRadius: 18,
              background: "rgba(255,255,255,0.98)",
              boxShadow: "0 18px 60px rgba(0,0,0,0.25)",
              border: "1px solid rgba(0,0,0,0.1)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, letterSpacing: 0.12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>
                  PERFORMANCE OF THE 10 MOST COMPARABLE PLAYERS
                </div>
                <div style={{ marginTop: 2, fontSize: 18, fontWeight: 950, letterSpacing: -0.2, color: "#111" }}>
                  {player?.name ?? "Player"} • {seasonFixed}
                </div>
              </div>

              <button
                onClick={() => setShowComparablePlayers(false)}
                style={{
                  fontSize: 12,
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.14)",
                  background: "rgba(255,255,255,0.95)",
                  color: "rgba(0,0,0,0.82)",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>

            <div style={{ height: 12 }} />

            {comparableTop10.length === 0 ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px dashed rgba(0,0,0,0.2)",
                  background: "rgba(0,0,0,0.02)",
                  color: "rgba(0,0,0,0.65)",
                  fontSize: 13,
                }}
              >
                No comparable-player rows found for this player/season.
                <div style={{ marginTop: 6, fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
                  Expected join keys: SourceproviderId + SourceSeason (matching the currently selected player + season).
                  File name expected: <b>comparable_players.csv</b> in <b>src/data/</b> (local) or your API (prod).
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                {comparableTop10.map((r, i) => {
                  const series = Array.from({ length: 10 }, (_, k) => {
                    const idx = k + 1;
                    const key = `adj_${idx}` as keyof ComparablePlayerRow;
                    const v = r[key] as number | null | undefined;
                    return { x: idx, y: v == null || !Number.isFinite(v) ? null : v };
                  }) as { x: number; y: number | null }[];
                  const hasAnyFuturePoint = series.some((d) => d.y != null);

                  return (
                    <div
                      key={`comp-${i}-${r.SimilarPlayer}-${r.SimilarSeason}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid rgba(0,0,0,0.1)",
                        background: "rgba(255,255,255,0.85)",
                      }}
                    >
                      <div style={{ minWidth: 210 }}>
                        <div style={{ fontSize: 16, fontWeight: 950, color: "#111", lineHeight: 1.05 }}>
                          {i + 1}. {r.SimilarPlayer}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: "rgba(0,0,0,0.6)", fontWeight: 800 }}>
                          YEAR: {r.SimilarSeason}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "rgba(0,0,0,0.6)", fontWeight: 800 }}>
                          SIMILARITY: {Number.isFinite(r.similarity) ? r.similarity.toFixed(2) : "—"}
                        </div>
                      </div>

                      <div style={{ flex: 1, height: 70 }}>
                        {hasAnyFuturePoint ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                              <XAxis dataKey="x" type="number" domain={[1, 10]} allowDecimals={false} hide />
                              <YAxis hide domain={["auto", "auto"]} />
                              <Line
                                type="monotone"
                                dataKey="y"
                                stroke="rgba(0,0,0,0.75)"
                                strokeWidth={3}
                                dot={false}
                                isAnimationActive={false}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        ) : (
                          <div
                            style={{
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "rgba(0,0,0,0.45)",
                              fontSize: 12,
                            }}
                          >
                            *No future seasons
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div id={CAREER_PDF_EXPORT_ID} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* KPI strip */}
      <div id={CAREER_TILES_EXPORT_ID}>
        <Card style={{ overflow: "hidden", padding: 8 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(122px, 0.72fr) repeat(4, minmax(0, 1fr))",
              gap: 8,
              alignItems: "stretch",
            }}
          >
            <div
              title={careerProjectionsLastUpdated ? `Last updated: ${careerProjectionsLastUpdated}` : undefined}
              style={{
                borderRadius: 16,
                padding: "2px 10px",
                background: "rgba(245,245,246,0.7)",
                border: "1px solid rgba(0,0,0,0.08)",
                minHeight: 56,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {headshotUrl ? (
                <img
                  src={headshotUrl}
                  alt={player?.name ?? ""}
                  style={{ height: 72, width: 72, objectFit: "contain", display: "block" }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 900,
                    color: "rgba(0,0,0,0.45)",
                    letterSpacing: 0.5,
                  }}
                >
                  {(player?.name ?? "—")
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((s) => s[0]?.toUpperCase())
                    .join("")}
                </div>
              )}
            </div>

            {kpis.map((k) => (
              <div
                key={k.label}
                style={{
                  borderRadius: 16,
                  padding: "2px 10px",
                  background: "rgba(245,245,246,0.7)",
                  border: "1px solid rgba(0,0,0,0.08)",
                  minHeight: 56,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                }}
              >
                {(() => {
                  return (
                    <>
                <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{k.label}</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 950,
                    letterSpacing: -0.2,
                    marginTop: 6,
                    color: "#111",
                    whiteSpace: "normal",
                    overflow: "visible",
                    textOverflow: "clip",
                  }}
                >
                  {k.value}
                </div>
                {k.sub ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: "rgba(0,0,0,0.50)",
                      marginTop: 4,
                      lineHeight: 1.2,
                      whiteSpace: "normal",
                      overflow: "visible",
                      textOverflow: "clip",
                    }}
                  >
                    {k.sub}
                  </div>
                ) : null}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Main row */}
      <div id={CAREER_MAIN_EXPORT_ID} style={{ display: "grid", gridTemplateColumns: "0.36fr 0.64fr", gap: 14 }}>
        {/* Left panel */}
        <Card>
          <SectionTitle title="Advanced Stats" right={<span style={{ fontSize: 11, color: "rgba(0,0,0,0.55)" }}>Percentiles</span>} />
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
            {/* Ball Use */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 950, color: "#111", marginBottom: 8 }}>Ball Use</div>
              {["Ball Use", "Kicking", "Handballing", "Transition", "Post clearance", "Clearance"].map((lbl) => {
                const r = skillRows.find((x) => x.label === lbl);
                if (!r) return null;
                return (
                  <div
                    key={r.label}
                    style={{ display: "grid", gridTemplateColumns: "1fr 60px 1.3fr", gap: 10, alignItems: "center", marginBottom: 8 }}
                  >
                    <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{r.label}</div>
                    <div style={{ fontSize: 12, color: "#111", fontWeight: 950, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.p == null ? "—" : ordinalSuffix(r.p)}
                    </div>
                    <div style={{ height: 12, borderRadius: 999, background: "rgba(0,0,0,0.06)", position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(0,0,0,0.35)" }} />
                      <div style={{ height: "100%", width: `${r.p ?? 0}%`, background: pctColor(r.p ?? 0), opacity: 0.9 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Ball Winning */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 12, fontWeight: 950, color: "#111", marginBottom: 8 }}>Ball Winning</div>
              {["Ball Winning", "Intercepts", "Aerial", "Ground", "Run/Carry", "TO-Transition", "Stop-Trans", "Pre clearance"].map(
                (lbl) => {
                  const r = skillRows.find((x) => x.label === lbl);
                  if (!r) return null;
                  return (
                    <div
                      key={r.label}
                      style={{ display: "grid", gridTemplateColumns: "1fr 60px 1.3fr", gap: 10, alignItems: "center", marginBottom: 8 }}
                    >
                      <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{r.label}</div>
                      <div style={{ fontSize: 12, color: "#111", fontWeight: 950, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {r.p == null ? "—" : ordinalSuffix(r.p)}
                      </div>
                      <div style={{ height: 12, borderRadius: 999, background: "rgba(0,0,0,0.06)", position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(0,0,0,0.35)" }} />
                        <div style={{ height: "100%", width: `${r.p ?? 0}%`, background: pctColor(r.p ?? 0), opacity: 0.9 }} />
                      </div>
                    </div>
                  );
                }
              )}
            </div>

            {/* Spoiling (standalone) */}
            {(() => {
              const r = skillRows.find((x) => x.label === "Spoiling");
              if (!r) return null;
              return (
                <div key={r.label} style={{ display: "grid", gridTemplateColumns: "1fr 60px 1.3fr", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: "#111", fontWeight: 950, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {r.p == null ? "—" : ordinalSuffix(r.p)}
                  </div>
                  <div style={{ height: 12, borderRadius: 999, background: "rgba(0,0,0,0.06)", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(0,0,0,0.35)" }} />
                    <div style={{ height: "100%", width: `${r.p ?? 0}%`, background: pctColor(r.p ?? 0), opacity: 0.9 }} />
                  </div>
                </div>
              );
            })()}

            <div style={{ height: 1, background: "rgba(0,0,0,0.08)", marginTop: 4 }} />

            <div style={{ fontSize: 12, fontWeight: 950, color: "#111", marginTop: 2 }}>Career Outcomes</div>

            {/* AA probability */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 1.3fr", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>All Australian</div>
              <div style={{ fontSize: 12, color: "#111", fontWeight: 950, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {fmtProbPct(outcomeProbs.AA)}
              </div>
              <div style={{ height: 12, borderRadius: 999, background: "rgba(0,0,0,0.06)", position: "relative", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.max(0, Math.min(1, outcomeProbs.AA ?? 0)) * 100}%`, background: pctColor((outcomeProbs.AA ?? 0) * 100), opacity: 0.9 }} />
              </div>
            </div>

            {/* 100 games probability */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 1.3fr", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>100+ Games</div>
              <div style={{ fontSize: 12, color: "#111", fontWeight: 950, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {fmtProbPct(outcomeProbs.Games)}
              </div>
              <div style={{ height: 12, borderRadius: 999, background: "rgba(0,0,0,0.06)", position: "relative", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.max(0, Math.min(1, outcomeProbs.Games ?? 0)) * 100}%`, background: pctColor((outcomeProbs.Games ?? 0) * 100), opacity: 0.9 }} />
              </div>
            </div>

            <div style={{ marginTop: 8, fontSize: 11, color: "rgba(0,0,0,0.45)", fontStyle: "italic" }}>
              *Outcomes probabilities are based on the most recent season form
            </div>
          </div>
        </Card>

        {/* Right plot */}
        <Card style={{ minHeight: 520, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="club logo"
              style={{
                position: "absolute",
                right: 12,
                top: 10,
                height: 120,
                width: 120,
                objectFit: "contain",
                opacity: 0.10,
                pointerEvents: "none",
                filter: "grayscale(1)",
              }}
            />
          ) : null}

          <SectionTitle
            title="Career Projection"
            right={
              <span style={{ fontSize: 11, color: "rgba(0,0,0,0.55)" }}>
                {comparePlayer ? "" : ""}
              </span>
            }
          />

          <div style={{ marginTop: 8, height: 460, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 6,
                transform: "translateX(-50%)",
                zIndex: 3,
                display: "flex",
                gap: 3,
                padding: "3px 4px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.92)",
                border: "1px solid rgba(0,0,0,0.08)",
                boxShadow: "0 3px 8px rgba(0,0,0,0.06)",
              }}
            >
              <Pill size="xs" active={projectionMetric === "rating"} onClick={() => setProjectionMetric("rating")}>
                Rating
              </Pill>
              <Pill size="xs" active={projectionMetric === "salary"} onClick={() => setProjectionMetric("salary")}>
                Salary
              </Pill>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartTrajectory} margin={{ top: 10, right: 26, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                <XAxis dataKey="season" tick={{ fontSize: 11 }} />
                <YAxis domain={yDomain} tick={{ fontSize: 11 }} allowDecimals={false} tickCount={6} />
                <Tooltip
                  formatter={(v: any, n: any, props: any) => {
                    if (v == null) return ["—", n];
                    if (projectionMetric === "salary") {
                      const payload = props?.payload ?? {};
                      let salaryVal: any = null;
                      switch (props?.dataKey) {
                        case "actual":
                          salaryVal = payload.salary_actual ?? payload.salary;
                          break;
                        case "estimate":
                          salaryVal = payload.salary_estimate ?? payload.salary;
                          break;
                        case "c_actual":
                          salaryVal = payload.c_salary_actual ?? payload.c_salary;
                          break;
                        case "c_estimate":
                          salaryVal = payload.c_salary_estimate ?? payload.c_salary;
                          break;
                        case "bridge":
                          salaryVal = payload.salary_estimate ?? payload.salary_actual ?? payload.salary;
                          break;
                        case "optimistic":
                          salaryVal = payload.salary_optimistic ?? payload.salary_estimate ?? payload.salary;
                          break;
                        case "pessimistic":
                          salaryVal = payload.salary_pessimistic ?? payload.salary_estimate ?? payload.salary;
                          break;
                        default:
                          salaryVal = payload.salary ?? null;
                          break;
                      }
                      const sval = typeof salaryVal === "number" ? salaryVal : Number(salaryVal);
                      if (!Number.isFinite(sval)) return ["—", n];
                      return [fmtAUDShort(sval), n];
                    }
                    const val = typeof v === "number" ? v : Number(v);
                    if (!Number.isFinite(val)) return ["—", n];
                    return [val.toFixed(1), n];
                  }}
                  labelFormatter={(l) => `Season ${l}`}
                />

                {ratingBenchmarks.leagueAvg != null ? (
                  <ReferenceLine
                    y={ratingBenchmarks.leagueAvg}
                    stroke="#9CA3AF"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    ifOverflow="extendDomain"
                    label={{ value: "League avg", position: "insideLeft", fill: "#F59E0B", fontSize: 11, dy: -6 }}
                  />
                ) : null}

                {ratingBenchmarks.top10Avg != null ? (
                  <ReferenceLine
                    y={ratingBenchmarks.top10Avg}
                    stroke="#9CA3AF"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    ifOverflow="extendDomain"
                    label={{ value: "Top 10%", position: "insideLeft", fill: "#10B981", fontSize: 11, dy: -6 }}
                  />
                ) : null}

                {/* Primary CI band */}
                <Area type="monotone" dataKey="lower0" stackId="ci1" stroke="none" fill="transparent" isAnimationActive={false} />
                <Area type="monotone" dataKey="band" stackId="ci1" stroke="none" fill="rgba(0,0,0,0.12)" isAnimationActive={false} />

                {/* Compare CI band (lighter) */}
                {comparePlayer ? (
                  <>
                    <Area type="monotone" dataKey="c_lower0" stackId="ci2" stroke="none" fill="transparent" isAnimationActive={false} />
                    <Area type="monotone" dataKey="c_band" stackId="ci2" stroke="none" fill="rgba(0,0,0,0.07)" isAnimationActive={false} />
                  </>
                ) : null}

                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke="#111"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="bridge"
                  name="Bridge"
                  stroke={teamColor}
                  strokeDasharray="6 4"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />

                <Line
                  type="monotone"
                  dataKey="optimistic"
                  name="Optimistic Trend"
                  stroke={teamColor}
                  strokeOpacity={0.36}
                  strokeDasharray="4 4"
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey={optimisticLabelKey}
                    position="top"
                    offset={10}
                    formatter={(v: any) => {
                      if (v == null) return "";
                      const val = typeof v === "number" ? v : Number(v);
                      if (!Number.isFinite(val)) return "";
                      return projectionMetric === "salary" ? fmtAUDShort(val) : val.toFixed(1);
                    }}
                    fontSize={10}
                    fill="rgba(0,0,0,0.28)"
                  />
                </Line>

                <Line
                  type="monotone"
                  dataKey="pessimistic"
                  name="Pessimistic Trend"
                  stroke={teamColor}
                  strokeOpacity={0.24}
                  strokeDasharray="2 5"
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey={pessimisticLabelKey}
                    position="bottom"
                    offset={8}
                    formatter={(v: any) => {
                      if (v == null) return "";
                      const val = typeof v === "number" ? v : Number(v);
                      if (!Number.isFinite(val)) return "";
                      return projectionMetric === "salary" ? fmtAUDShort(val) : val.toFixed(1);
                    }}
                    fontSize={10}
                    fill="rgba(0,0,0,0.24)"
                  />
                </Line>


                <Line
                  type="monotone"
                  dataKey="estimate"
                  name="Projection"
                  stroke={teamColor}
                  strokeWidth={3.5}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey={projectionMetric === "salary" ? "salary_estimate" : "estimate"}
                    position="top"
                    offset={14}
                    formatter={(v: any) => {
                      if (v == null) return "";
                      const val = typeof v === "number" ? v : Number(v);
                      if (!Number.isFinite(val)) return "";
                      return projectionMetric === "salary" ? fmtAUDShort(val) : val.toFixed(1);
                    }}
                    fontSize={11}
                    fill="rgba(0,0,0,0.55)"
                  />
                </Line>

                {comparePlayer ? (
                  <Line
                    type="monotone"
                    dataKey="c_estimate"
                    name="Compare Projection"
                    stroke={compareColor}
                    strokeDasharray="6 4"
                    strokeWidth={3}
                    dot={false}
                    activeDot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
              Shaded band = lower/upper confidence interval (when available). Dashed lines = league avg + top 10% avg rating. Compare series is dashed.
              <span style={{ color: "rgba(0,0,0,0.34)" }}> Optimistic and pessimistic trend lines are always shown as softer overlays.</span>
            </div>
        </Card>
      </div>
      </div>

      {/* Right compare sidebar (player-level) */}
      {!comparePanelOpen && (
        <button className="compareToggleBtn" onClick={() => setComparePanelOpen(true)}>
          Compare
        </button>
      )}

      {comparePanelOpen && (
        <div className="comparePanel">
          <div className="comparePanelHeader">
            <div>
              <div style={{ fontSize: 13, fontWeight: 950, color: "rgba(0,0,0,0.55)", letterSpacing: -0.2 }}>Compare</div>
              <div style={{ fontSize: 11, color: "rgba(0,0,0,0.50)" }}>Side-by-side percentiles</div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {comparePlayer ? (
                <button
                  onClick={() => setComparePlayerId("")}
                  style={{
                    borderRadius: 999,
                    padding: "7px 10px",
                    border: "1px solid rgba(0,0,0,0.14)",
                    background: "rgba(255,255,255,0.85)",
                    fontSize: 12,
                    cursor: "pointer",
                    color: "rgba(0,0,0,0.72)",
                    fontWeight: 800,
                  }}
                >
                  Clear
                </button>
              ) : null}

              <button
                onClick={() => setComparePanelOpen(false)}
                style={{
                  borderRadius: 999,
                  padding: "7px 10px",
                  border: "1px solid rgba(0,0,0,0.14)",
                  background: "rgba(0,0,0,0.06)",
                  fontSize: 12,
                  cursor: "pointer",
                  color: "rgba(0,0,0,0.72)",
                  fontWeight: 800,
                }}
              >
                Close
              </button>
            </div>
          </div>

          <div className="comparePanelBody">
            <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.70)", marginBottom: 8 }}>Select a player</div>

            <select
              value={comparePlayerId}
              onChange={(e) => setComparePlayerId(e.target.value)}
              style={{
                width: "100%",
                fontSize: 12,
                padding: "10px 10px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.14)",
                background: "rgba(255,255,255,0.92)",
                color: "rgba(0,0,0,0.82)",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              <option value="">No comparison</option>
              {allPlayers.map((p) => (
                <option key={`panel-${p.id}-${p.name}`} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {!comparePlayer ? (
              <div style={{ marginTop: 14, fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
                Pick a player to show a side-by-side breakdown for the snapshot season.
              </div>
            ) : (
              <>
                <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>Head-to-head</div>
                    <div style={{ fontSize: 11, color: "rgba(0,0,0,0.50)" }}>Diff =  {player.name} - {comparePlayer.name}</div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", marginBottom: 6 }}>Career outcomes</div>
                    <table className="miniTable">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th style={{ textAlign: "right" }}>{player.name}</th>
                          <th style={{ textAlign: "right" }}>{comparePlayer.name}</th>
                          <th style={{ textAlign: "right" }}>Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { m: "All Australian", a: outcomeProbs.AA, b: compareOutcomeProbs.AA },
                          { m: "100+ Games", a: outcomeProbs.Games, b: compareOutcomeProbs.Games },
                        ].map((r) => {
                          const a = r.a == null ? null : r.a * 100;
                          const b = r.b == null ? null : r.b * 100;
                          const d = a == null || b == null ? null : a - b;
                          return (
                            <tr key={r.m}>
                              <td>{r.m}</td>
                              <td style={{ textAlign: "right" }}>{a == null ? "—" : fmtProbPct(a / 100)}</td>
                              <td style={{ textAlign: "right" }}>{b == null ? "—" : fmtProbPct(b / 100)}</td>
                              <td
                                style={{
                                  textAlign: "right",
                                  fontVariantNumeric: "tabular-nums",
                                  color: diffColor(d),
                                  fontWeight: 900,
                                }}
                              >
                                {d == null ? "—" : `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", marginBottom: 6 }}>Component percentiles (snapshot season)</div>
                    {playerCompareRows.length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {playerCompareRows.map((g: any) => (
                          <div key={g.category}>
                            <div style={{ fontSize: 11, fontWeight: 950, color: "rgba(0,0,0,0.68)", marginBottom: 6 }}>
                              {g.category}
                            </div>
                            <table className="miniTable">
                              <thead>
                                <tr>
                                  <th>Metric</th>
                                  <th style={{ textAlign: "right" }}>{player.name}</th>
                                  <th style={{ textAlign: "right" }}>{comparePlayer.name}</th>
                                  <th style={{ textAlign: "right" }}>Diff</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.rows.map((r: any) => (
                                  <tr key={`${g.category}-${r.metric}`}>
                                    <td>{r.metric}</td>
                                    <td style={{ textAlign: "right" }}>{r.a.toFixed(0)}%</td>
                                    <td style={{ textAlign: "right" }}>{r.b.toFixed(0)}%</td>
                                    <td
                                      style={{
                                        textAlign: "right",
                                        fontVariantNumeric: "tabular-nums",
                                        color: diffColor(r.diff),
                                        fontWeight: 900,
                                      }}
                                    >
                                      {(r.diff >= 0 ? "+" : "") + r.diff.toFixed(0)}%
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
                        No component metrics found for this snapshot season in <code>CD_player_stats_agg.csv</code>.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}



// -----------------------------
// Routing (path-based deep links)
// -----------------------------
function TeamRoute() {
  const params = useParams();
  return <AppCore routeMode="team" routeTeamId={String((params as any).teamId || "")} routePlayerId={null} />;
}

function PlayerRoute() {
  const params = useParams();
  return <AppCore routeMode="player" routeTeamId={null} routePlayerId={String((params as any).playerId || "")} />;
}


// Default export wraps the existing single-page UI in a router so deep links work:
//   /team/40?season=2026
//   /player/CD_I1019038?season=2026
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/team/40" replace />} />
        <Route path="/team/:teamId" element={<TeamRoute />} />
        <Route path="/player/:playerId" element={<PlayerRoute />} />
        {/* Back-compat: old query-string-only links */}
        <Route path="*" element={<Navigate to="/team/40" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function AppCore({ routeMode, routeTeamId, routePlayerId }: { routeMode: "team" | "player"; routeTeamId: string | null; routePlayerId: string | null; }) {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const didInitSeasonRef = useRef(false);
  const [team, setTeam] = useState(() => resolveIncomingTeamId(routeMode === "team" ? routeTeamId : null, searchParams));
  const [season, setSeason] = useState<number>(DEFAULT_SEASON);
const [compareTeam, setCompareTeam] = useState<string>(""); // "" = no comparison
const [comparePanelOpen, setComparePanelOpen] = useState(false);
const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);
const [page, setPage] = useState<"team" | "career">(() => (routeMode === "player" ? "career" : "team"));
const [currentPlayerId, setCurrentPlayerId] = useState<string>(() => (routeMode === "player" ? normalizePlayerId(routePlayerId) : ""));
const [exportPlayerName, setExportPlayerName] = useState<string>("");
const [playerTeamResolved, setPlayerTeamResolved] = useState(false);
const selectedTeamOption = useMemo(() => getTeamOptionById(team), [team]);
const selectedLeague = selectedTeamOption?.league ?? "AFL";
const teamOptionsForLeague = useMemo(
  () => TEAMS.filter((t) => t.league === selectedLeague),
  [selectedLeague]
);
useEffect(() => {
  setCompareTeam("");
}, [team]);

useEffect(() => {
  // When the player changes, allow team to be inferred again unless the URL explicitly provides a team.
  const explicitTeam = (new URLSearchParams(location.search).get("team") || "").trim();
  if (!explicitTeam) setPlayerTeamResolved(false);
}, [currentPlayerId, location.search]);

    useEffect(() => {
    // Sync URL -> state (only when the URL changes)
    const sp = new URLSearchParams(location.search);

    const parsedSeason = Number(sp.get("season") || DEFAULT_SEASON);
    let nextSeason = clampUiSeason(parsedSeason);
    if (!didInitSeasonRef.current) {
      // Always open on current season after a hard refresh.
      if (routeMode === "team") nextSeason = DEFAULT_SEASON;
      didInitSeasonRef.current = true;
    }
    setSeason((prev) => (nextSeason !== prev ? nextSeason : prev));

    if (routeMode === "team") {
      const nextTeam = resolveIncomingTeamId(routeTeamId, sp);
      setTeam((prev) => (nextTeam !== prev ? nextTeam : prev));
      setPage((prev) => (prev !== "team" ? "team" : prev));
    } else {
      // /player/:playerId route
      setPage((prev) => (prev !== "career" ? "career" : prev));

      const qTeam = resolveIncomingTeamId(null, sp);
      if (qTeam === DEFAULT_TEAM_ID && !sp.get("team") && !sp.get("teamId") && !sp.get("club") && !sp.get("clubName") && !sp.get("teamName") && !sp.get("code")) {
        // No explicit team information was provided on the player route.
      } else {
        setTeam((prev) => (qTeam !== prev ? qTeam : prev));
        setPlayerTeamResolved(true);
      }

      const rid = normalizePlayerId(routePlayerId);
      if (rid) {
        setCurrentPlayerId((prev) => (rid !== prev ? rid : prev));
        if (!qTeam) setPlayerTeamResolved(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMode, routeTeamId, routePlayerId, location.search]);

  // Keep the URL (path + query) in sync with the in-app state so SharePoint embeds can deep-link reliably.
  useEffect(() => {
    const baseSeason = clampUiSeason(Number.isFinite(season) ? season : DEFAULT_SEASON);

    if (page === "team") {
      const nextPath = `/team/${team || DEFAULT_TEAM_ID}`;
      const nextSearch = `?season=${encodeURIComponent(String(baseSeason))}`;
      const next = nextPath + nextSearch;
      const cur = location.pathname + location.search;
      if (cur !== next) navigate(next, { replace: true });
      return;
    }

    // career
    const pid = normalizePlayerId(currentPlayerId);
    if (!pid) return; // wait until we have a selected player
    const nextPath = `/player/${encodeURIComponent(pid)}`;
    const explicitTeam = (new URLSearchParams(location.search).get("team") || "").trim();
    const includeTeam = playerTeamResolved || !!explicitTeam;
    const nextSearch = includeTeam
      ? `?team=${encodeURIComponent(String(team || ""))}&season=${encodeURIComponent(String(baseSeason))}`
      : `?season=${encodeURIComponent(String(baseSeason))}`;

    const next = nextPath + nextSearch;
    const cur = location.pathname + location.search;
    if (cur !== next) navigate(next, { replace: true });
  }, [page, team, season, currentPlayerId, playerTeamResolved, location.pathname, location.search, navigate]);

  const clubName = useMemo(() => selectedTeamOption?.name ?? team, [selectedTeamOption, team]);
  const clubLabel = useMemo(() => selectedTeamOption?.label ?? clubName, [selectedTeamOption, clubName]);
  const clubKey = useMemo(() => normalizeClubName(clubName), [clubName]);
  const teamColor = useMemo(() => TEAM_PRIMARY_COLOR[clubKey] ?? "#111111", [clubKey]);

  const logoSrc = useMemo(() => getLogoUrlByClubName(clubName), [clubName]);
  const exportFileBase = useMemo(() => {
    const toSlug = (v: string, fallback: string) =>
      v
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || fallback;

    const clubSlug = toSlug(clubName, "club");
    const playerSlug = toSlug(exportPlayerName || normalizePlayerId(currentPlayerId), "player");
    const subjectSlug = page === "career" ? playerSlug : clubSlug;
    return `afl-dash-${subjectSlug}-${page}-${season}`;
  }, [clubName, page, season, exportPlayerName, currentPlayerId]);

  const captureElementCanvas = async (node: HTMLElement, scale = 2) => {
    const { default: html2canvas } = await import("html2canvas");
    return html2canvas(node, {
      backgroundColor: "#f5f5f6",
      useCORS: true,
      logging: false,
      scale: Math.max(1.5, Math.min(scale, window.devicePixelRatio || 2)),
      windowWidth: node.scrollWidth,
      windowHeight: node.scrollHeight,
    });
  };

  const captureCareerCanvas = async (target: HTMLElement, scale = 2) => {
    const prevWidth = target.style.width;
    const prevMaxWidth = target.style.maxWidth;
    const prevMargin = target.style.margin;
    const prevGap = target.style.gap;
    const prevZoom = target.style.getPropertyValue("zoom");
    const mainRow = target.querySelector<HTMLElement>(`#${CAREER_MAIN_EXPORT_ID}`);
    const prevMainMinHeight = mainRow?.style.minHeight ?? "";
    const prevMainGridTemplateColumns = mainRow?.style.gridTemplateColumns ?? "";
    const prevMainGap = mainRow?.style.gap ?? "";

    target.style.width = `${CAREER_EXPORT_CAPTURE_WIDTH}px`;
    target.style.maxWidth = `${CAREER_EXPORT_CAPTURE_WIDTH}px`;
    target.style.margin = "0 auto";
    target.style.gap = "10px";
    target.style.setProperty("zoom", String(CAREER_EXPORT_CAPTURE_ZOOM));
    if (mainRow) {
      mainRow.style.minHeight = `${CAREER_EXPORT_CAPTURE_MIN_HEIGHT}px`;
      mainRow.style.gridTemplateColumns = CAREER_EXPORT_CAPTURE_SPLIT;
      mainRow.style.gap = "12px";
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      return await captureElementCanvas(target, scale);
    } finally {
      target.style.width = prevWidth;
      target.style.maxWidth = prevMaxWidth;
      target.style.margin = prevMargin;
      target.style.gap = prevGap;
      if (mainRow) {
        mainRow.style.minHeight = prevMainMinHeight;
        mainRow.style.gridTemplateColumns = prevMainGridTemplateColumns;
        mainRow.style.gap = prevMainGap;
      }
      if (prevZoom) {
        target.style.setProperty("zoom", prevZoom);
      } else {
        target.style.removeProperty("zoom");
      }
    }
  };

  const onExportPng = async () => {
    if (exporting) return;
    if (page !== "career") {
      window.alert("Switch to Career view to export the Career image.");
      return;
    }
    setExporting("png");
    try {
      const target = document.getElementById(CAREER_PDF_EXPORT_ID);
      if (!target) throw new Error("Career export target not found.");
      const canvas = await captureCareerCanvas(target, 2);
      const url = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = `${exportFileBase}-career-projection.png`;
      link.click();
    } catch (err) {
      console.error("PNG export failed:", err);
      window.alert("Could not export PNG. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  const onExportPdf = async () => {
    if (exporting) return;
    if (page !== "career") {
      window.alert("Switch to Career view to export the Career PDF.");
      return;
    }
    setExporting("pdf");
    try {
      const target = document.getElementById(CAREER_PDF_EXPORT_ID);
      if (!target) throw new Error("Career PDF export target not found.");
      const [canvas, { jsPDF }] = await Promise.all([captureCareerCanvas(target, 2), import("jspdf")]);

      // Export to a near 1088x1288 portrait frame for better report placeholder fit.
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: [CAREER_EXPORT_CAPTURE_WIDTH, CAREER_EXPORT_CAPTURE_MIN_HEIGHT],
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const sideMargin = 26;
      const topMargin = 24;
      const bottomMargin = 24;
      const maxWidth = pageWidth - sideMargin * 2;
      const maxHeight = pageHeight - topMargin - bottomMargin;
      const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      const renderWidth = canvas.width * ratio;
      const renderHeight = canvas.height * ratio;
      const x = (pageWidth - renderWidth) / 2;
      const y = topMargin + (maxHeight - renderHeight) / 2;

      pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, renderWidth, renderHeight, undefined, "FAST");
      pdf.save(`${exportFileBase}-career-projection.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
      window.alert("Could not export PDF. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  // --------
  // Data state
  // --------
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayerRow[]>([]);
  const [teamKpis, setTeamKpis] = useState<TeamKpiRow[]>([]);
  const [rankSeries, setRankSeries] = useState<RankRow[]>([]);
  const [skillRadar, setSkillRadar] = useState<SkillRadarRow[]>([]);
  const [acqBreakdown, setAcqBreakdown] = useState<AcquisitionRow[]>([]);
  const [playerProjections, setPlayerProjections] = useState<PlayerProjectionRow[]>([]);
  const [aflForm, setAflForm] = useState<AflFormRow[]>([]);
  const [vflForm, setVflForm] = useState<VflFormRow[]>([]);
  const [careerProjections, setCareerProjections] = useState<CareerProjectionRow[]>([]);
  const [careerProjectionsLastUpdated, setCareerProjectionsLastUpdated] = useState<string>("");
  const [playerStatsAgg, setPlayerStatsAgg] = useState<PlayerStatsAggRow[]>([]);
  const [comparablePlayers, setComparablePlayers] = useState<ComparablePlayerRow[]>([]);

  useEffect(() => {
    if (page !== "career") {
      setExportPlayerName("");
      return;
    }
    const pid = normalizePlayerId(currentPlayerId);
    if (!pid) {
      setExportPlayerName("");
      return;
    }

    const rosterRow =
      rosterPlayers.find(
        (r) =>
          normalizePlayerId(r.providerId) === pid &&
          r.season === season &&
          (normalizeTeamId(r.team_id) === normalizeTeamId(team) || !normalizeTeamId(team))
      ) ??
      rosterPlayers.find((r) => normalizePlayerId(r.providerId) === pid && normalizeTeamId(r.team_id) === normalizeTeamId(team)) ??
      rosterPlayers.find((r) => normalizePlayerId(r.providerId) === pid);
    const rosterName = toTrimmedString(rosterRow?.player_name);

    const careerRow =
      careerProjections.find((r) => normalizePlayerId(r.SourceproviderId) === pid && r.SourceSeason === season) ??
      careerProjections.find((r) => normalizePlayerId(r.SourceproviderId) === pid);
    const careerName = toTrimmedString(careerRow?.SourcePlayer);

    const nextName = rosterName || careerName || "";
    setExportPlayerName((prev) => (prev === nextName ? prev : nextName));
  }, [page, currentPlayerId, season, team, rosterPlayers, careerProjections]);

  // Keep teamId in sync with the selected player (based on roster_players for the chosen season).
  useEffect(() => {
    if (routeMode !== "player") return;
    if (!currentPlayerId) return;

    const row = rosterPlayers.find(
      (r) => normalizePlayerId(r.providerId) === normalizePlayerId(currentPlayerId) && r.season === season
    );
    if (!row) return;

    const resolvedTeamId = normalizeTeamId(row.team_id);
    if (resolvedTeamId) {
      if (resolvedTeamId !== team) setTeam(resolvedTeamId);
      if (!playerTeamResolved) setPlayerTeamResolved(true);
    }
  }, [routeMode, currentPlayerId, rosterPlayers, season, team, searchParams, playerTeamResolved]);




  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setLoadErr(null);

        const [roster, kpis, ranks, radar, acq, proj, aflFormRows, vflFormRows, careerProjResult, playerStatsAggRows, comparableRows] = await Promise.all([
          Promise.all([
            loadApiDataAsObjects<RosterPlayerRow>("roster_players.csv", (r) => {
              const seasonN = toNumberOrNull(r["season"]);
              const ageN = toNumberOrNull(r["age"]);
              const gamesN = toNumberOrNull(r["games"]);
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["team"], r["league"]);
              const ratingsN = toNumberOrNull(r["ratings"]) ?? 0;
              const ageCat = toTrimmedString(r["age_cat"]);
              if (!isRecentSeasonValue(seasonN) || ageN === null || gamesN === null || !teamIdentity.team || !teamIdentity.team_id) return null;
              return {
                season: seasonN,
                team: teamIdentity.team,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                providerId: r["providerId"] ?? "",
                player_name: r["player_name"] ?? "",
                age: ageN,
                position_group: r["position_group"] ?? "",
                games: gamesN,
                ratings: ratingsN,
                age_cat: ageCat,
              };
            }),
            loadOptionalApiDataAsObjects<RosterPlayerRow>("roster_players_aflw.csv", (r) => {
              const seasonN = toNumberOrNull(r["season"]);
              const ageN = toNumberOrNull(r["age"]);
              const gamesN = toNumberOrNull(r["games"]);
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["team"], r["league"]);
              const ratingsN = toNumberOrNull(r["ratings"]) ?? 0;
              const ageCat = toTrimmedString(r["age_cat"]);
              if (!isRecentSeasonValue(seasonN) || ageN === null || gamesN === null || !teamIdentity.team || !teamIdentity.team_id) return null;
              return {
                season: seasonN,
                team: teamIdentity.team,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                providerId: r["providerId"] ?? "",
                player_name: r["player_name"] ?? "",
                age: ageN,
                position_group: r["position_group"] ?? "",
                games: gamesN,
                ratings: ratingsN,
                age_cat: ageCat,
              };
            }),
          ]).then((parts) => parts.flat()),

          Promise.all([
            loadApiDataAsObjects<TeamKpiRow>("team_kpis.csv", (r) => {
              const club = normalizeClubName(r["Club"] ?? "");
              const seasonN = toNumberOrNull(r["season"]);
              const ageAvg = toNumberOrNull(r["squad_age_avg"]);
              const expAvg = toNumberOrNull(r["squad_experience_avg_games"]);
              const turnover = toNumberOrNull(r["squad_turnover_players"]);
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["Club"], r["league"]);
              if (!club || !isRecentSeasonValue(seasonN) || ageAvg === null || expAvg === null || !teamIdentity.team_id) return null;
              return {
                Club: club,
                season: seasonN,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                squad_age_avg: ageAvg,
                squad_age_yoy: toNumberOrNull(r["squad_age_yoy"]),
                squad_experience_avg_games: expAvg,
                squad_experience_yoy: toNumberOrNull(r["squad_experience_yoy"]),
                squad_turnover_players: turnover ?? 0,
                squad_turnover_yoy: toNumberOrNull(r["squad_turnover_yoy"]),
              };
            }),
            loadOptionalApiDataAsObjects<TeamKpiRow>("team_kpis_aflw.csv", (r) => {
              const club = normalizeClubName(r["Club"] ?? "");
              const seasonN = toNumberOrNull(r["season"]);
              const ageAvg = toNumberOrNull(r["squad_age_avg"]);
              const expAvg = toNumberOrNull(r["squad_experience_avg_games"]);
              const turnover = toNumberOrNull(r["squad_turnover_players"]);
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["Club"], r["league"]);
              if (!club || !isRecentSeasonValue(seasonN) || ageAvg === null || expAvg === null || !teamIdentity.team_id) return null;
              return {
                Club: club,
                season: seasonN,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                squad_age_avg: ageAvg,
                squad_age_yoy: toNumberOrNull(r["squad_age_yoy"]),
                squad_experience_avg_games: expAvg,
                squad_experience_yoy: toNumberOrNull(r["squad_experience_yoy"]),
                squad_turnover_players: turnover ?? 0,
                squad_turnover_yoy: toNumberOrNull(r["squad_turnover_yoy"]),
              };
            }),
          ]).then((parts) => parts.flat()),

          Promise.all([
            loadApiDataAsObjects<RankRow>("team_rank_timeseries.csv", (r) => {
              const club = normalizeClubName(r["Club"] ?? "");
              const yearN = toNumberOrNull(r["year"]);
              if (!club || !isRecentSeasonValue(yearN)) return null;

              return {
                Club: club,
                league: "AFL" as LeagueCode,
                year: yearN,
                actual_rank: toNumberOrNull(r["actual_rank"]),
                forecast_a_rank: toNumberOrNull(r["forecast_a_rank"]),
                forecast_b_rank: toNumberOrNull(r["forecast_b_rank"]),
                finish_1_p10: toNumberOrNull(r["finish_1_p10"]),
                finish_1_p25: toNumberOrNull(r["finish_1_p25"]),
                finish_1_p75: toNumberOrNull(r["finish_1_p75"]),
                finish_1_p90: toNumberOrNull(r["finish_1_p90"]),
                finish_2_p10: toNumberOrNull(r["finish_2_p10"]),
                finish_2_p25: toNumberOrNull(r["finish_2_p25"]),
                finish_2_p75: toNumberOrNull(r["finish_2_p75"]),
                finish_2_p90: toNumberOrNull(r["finish_2_p90"]),
              };
            }),
            loadOptionalApiDataAsObjects<RankRow>("team_rank_timeseries_aflw.csv", (r) => {
              const club = normalizeClubName(r["Club"] ?? "");
              const yearN = toNumberOrNull(r["year"]);
              if (!club || !isRecentSeasonValue(yearN)) return null;

              return {
                Club: club,
                league: "AFLW" as LeagueCode,
                year: yearN,
                actual_rank: toNumberOrNull(r["actual_rank"]),
                forecast_a_rank: toNumberOrNull(r["forecast_a_rank"]),
                forecast_b_rank: toNumberOrNull(r["forecast_b_rank"]),
                finish_1_p10: toNumberOrNull(r["finish_1_p10"]),
                finish_1_p25: toNumberOrNull(r["finish_1_p25"]),
                finish_1_p75: toNumberOrNull(r["finish_1_p75"]),
                finish_1_p90: toNumberOrNull(r["finish_1_p90"]),
                finish_2_p10: toNumberOrNull(r["finish_2_p10"]),
                finish_2_p25: toNumberOrNull(r["finish_2_p25"]),
                finish_2_p75: toNumberOrNull(r["finish_2_p75"]),
                finish_2_p90: toNumberOrNull(r["finish_2_p90"]),
              };
            }),
          ]).then((parts) => parts.flat()),

          Promise.all([
            loadApiDataAsObjects<SkillRadarRow>("team_skill_radar.csv", (r) => {
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["squad.name"] ?? r["squad_name"], r["league"]);
              const seasonStr = toTrimmedString(r["season"] ?? r["season.id"]);
              const seasonN = toNumberOrNull(seasonStr);
              if (!teamIdentity.team || !teamIdentity.team_id || !seasonStr || !isRecentSeasonValue(seasonN)) return null;

              const num = (k: string) => toNumberOrNull(r[k]) ?? 0;

              return {
                season: seasonStr,
                squad_name: teamIdentity.team,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                KH_Ratio: num("KH_Ratio"),
                GB_MK_Ratio: num("GB_MK_Ratio"),
                Fwd_Half: num("Fwd_Half"),
                Scores: num("Scores"),
                PPchain: num("PPchain"),
                Points_per_I50: num("Points_per_I50"),
                Repeat_I50s: num("Repeat_I50s"),
                Rating_Ball_Use: num("Rating_Ball_Use"),
                Rating_Ball_Win: num("Rating_Ball_Win"),
                Chain_Metres: num("Chain_Metres"),
                Time_in_Poss_Pct: num("Time_in_Poss_Pct"),
              };
            }),
            loadOptionalApiDataAsObjects<SkillRadarRow>("team_skill_radar_aflw.csv", (r) => {
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["squad.name"] ?? r["squad_name"], r["league"]);
              const seasonStr = toTrimmedString(r["season"] ?? r["season.id"]);
              const seasonN = toNumberOrNull(seasonStr);
              if (!teamIdentity.team || !teamIdentity.team_id || !seasonStr || !isRecentSeasonValue(seasonN)) return null;

              const num = (k: string) => toNumberOrNull(r[k]) ?? 0;

              return {
                season: seasonStr,
                squad_name: teamIdentity.team,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                KH_Ratio: num("KH_Ratio"),
                GB_MK_Ratio: num("GB_MK_Ratio"),
                Fwd_Half: num("Fwd_Half"),
                Scores: num("Scores"),
                PPchain: num("PPchain"),
                Points_per_I50: num("Points_per_I50"),
                Repeat_I50s: num("Repeat_I50s"),
                Rating_Ball_Use: num("Rating_Ball_Use"),
                Rating_Ball_Win: num("Rating_Ball_Win"),
                Chain_Metres: num("Chain_Metres"),
                Time_in_Poss_Pct: num("Time_in_Poss_Pct"),
              };
            }),
          ]).then((parts) => parts.flat()),

          Promise.all([
            loadApiDataAsObjects<AcquisitionRow>("player_acquisition_breakdown.csv", (r) => {
              const club = normalizeClubName(r["Club"] ?? "");
              const year = toNumberOrNull(r["Year"]);
              const value = toNumberOrNull(r["value"]);
              const draft = toTrimmedString(r["Draft"]);
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["Club"], r["league"]);
              if (!club || !isRecentSeasonValue(year) || value === null || !draft || !teamIdentity.team_id) return null;
              return { Club: club, Year: year, Draft: draft, value, team_id: teamIdentity.team_id, league: teamIdentity.league };
            }),
            loadOptionalApiDataAsObjects<AcquisitionRow>("player_acquisition_breakdown_aflw.csv", (r) => {
              const club = normalizeClubName(r["Club"] ?? "");
              const year = toNumberOrNull(r["Year"]);
              const value = toNumberOrNull(r["value"]);
              const draft = toTrimmedString(r["Draft"]);
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["Club"], r["league"]);
              if (!club || !isRecentSeasonValue(year) || value === null || !draft || !teamIdentity.team_id) return null;
              return { Club: club, Year: year, Draft: draft, value, team_id: teamIdentity.team_id, league: teamIdentity.league };
            }),
          ]).then((parts) => parts.flat()),

          Promise.all([
            loadApiDataAsObjectsWithFallback<PlayerProjectionRow>(["player_projection.csv", "player_projections.csv"], (r) => {
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["team"], r["league"]);
              const seasonN = toNumberOrNull(r["season"]);
              const rating = toNumberOrNull(r["rating"]);
              const games = toNumberOrNull(r["Games"] ?? r["games"] ?? "");
              const playerId = toTrimmedString(r["playerId"]);
              const playerName = toTrimmedString(r["player_name"]);

              if (!teamIdentity.team || !teamIdentity.team_id || !isRecentSeasonValue(seasonN) || rating === null || !playerId || !playerName) return null;

              return {
                team: teamIdentity.team,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                season: seasonN,
                playerId,
                player_name: playerName,
                rating,
                salary: toNumberOrNull(r["salary"]),
                AA: toNumberOrNull(r["AA"]),
                Games: games,
              };
            }),
            loadOptionalApiDataAsObjects<PlayerProjectionRow>("player_projections_aflw.csv", (r) => {
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["team"], r["league"]);
              const seasonN = toNumberOrNull(r["season"]);
              const rating = toNumberOrNull(r["rating"]);
              const games = toNumberOrNull(r["Games"] ?? r["games"] ?? "");
              const playerId = toTrimmedString(r["playerId"]);
              const playerName = toTrimmedString(r["player_name"]);

              if (!teamIdentity.team || !teamIdentity.team_id || !isRecentSeasonValue(seasonN) || rating === null || !playerId || !playerName) return null;

              return {
                team: teamIdentity.team,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                season: seasonN,
                playerId,
                player_name: playerName,
                rating,
                salary: toNumberOrNull(r["salary"]),
                AA: toNumberOrNull(r["AA"]),
                Games: games,
              };
            }),
          ]).then((parts) => parts.flat()),

          Promise.all([
            loadApiDataAsObjects<AflFormRow>("form_player_afl.csv", (r) => {
              const seasonN = toNumberOrNull(r["season"]);
              const wavg = toNumberOrNull(r["weighted_avg"]);
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["team"], r["league"]);
              const playerId = toTrimmedString(r["playerId"]);
              const playerName = toTrimmedString(r["player_name"]);
              if (!isRecentSeasonValue(seasonN) || wavg === null || !teamIdentity.team || !teamIdentity.team_id || !playerId || !playerName) return null;
              return {
                season: seasonN,
                playerId,
                team: teamIdentity.team,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                player_name: playerName,
                weighted_avg: wavg,
                recent_form: toNumberOrNull(r["recent_form"]),
                form_change: toNumberOrNull(r["form_change"]),
              };
            }),
            loadOptionalApiDataAsObjects<AflFormRow>("form_player_aflw.csv", (r) => {
              const seasonN = toNumberOrNull(r["season"]);
              const wavg = toNumberOrNull(r["weighted_avg"]);
              const teamIdentity = resolveTeamIdentity(r["team_id"], r["team"], r["league"]);
              const playerId = toTrimmedString(r["playerId"]);
              const playerName = toTrimmedString(r["player_name"]);
              if (!isRecentSeasonValue(seasonN) || wavg === null || !teamIdentity.team || !teamIdentity.team_id || !playerId || !playerName) return null;
              return {
                season: seasonN,
                playerId,
                team: teamIdentity.team,
                team_id: teamIdentity.team_id,
                league: teamIdentity.league,
                player_name: playerName,
                weighted_avg: wavg,
                recent_form: toNumberOrNull(r["recent_form"]),
                form_change: toNumberOrNull(r["form_change"]),
              };
            }),
          ]).then((parts) => parts.flat()),

          loadApiDataAsObjects<VflFormRow>("form_player_vfl.csv", (r) => {
            const seasonN = toNumberOrNull(r["season"]);
            const wavg = toNumberOrNull(r["weighted_avg"]);
            const teamS = toTrimmedString(r["team"]);
            const playerId = toTrimmedString(r["playerId"]);
            const playerName = toTrimmedString(r["player_name"]);
            const teamIdentity = resolveTeamIdentity(r["team_id"], r["team"], r["league"]);

            if (!isRecentSeasonValue(seasonN) || wavg === null || !teamS || !playerId || !playerName) return null;

            return {
              season: seasonN,
              playerId,
              team: teamIdentity.team || teamS,
              team_id: teamIdentity.team_id || undefined,
              league: teamIdentity.league,
              player_name: playerName,
              weighted_avg: wavg,
            };
          }),

          // Career projections
          loadApiDataAsObjectsWithMeta<CareerProjectionRow>("career_projections.csv", (r) => {
            const seasonN = toNumberOrNull(r["Season"]);
            const horizonN = toNumberOrNull(r["Horizon"]);
            const srcSeasonN = toNumberOrNull(r["SourceSeason"]);

            if (seasonN === null || horizonN === null) return null;

            return {
              SourceproviderId: toTrimmedString(r["SourceproviderId"]),
              SourcePlayer: toTrimmedString(r["SourcePlayer"]),
              SourceClub: normalizeClubName(r["SourceClub"] ?? r["team"] ?? ""),
              SourceSeason: srcSeasonN ?? seasonN,
              SourceRating: toNumberOrNull(r["SourceRating"]) ?? 0,
              SourcePosition: toTrimmedString(r["SourcePosition"]),
              Horizon: horizonN,
              Season: seasonN,
              estimate: toNumberOrNull(r["estimate"]),
              lower: toNumberOrNull(r["lower"]),
              upper: toNumberOrNull(r["upper"]),
              salary: toNumberOrNull(r["salary"]),
              Optimistic: toNumberOrNull(r["Optimistic"] ?? r["optimistic"]),
              Pessimistic: toNumberOrNull(r["Pessimistic"] ?? r["pessimistic"]),
              salary_opt: toNumberOrNull(r["salary_opt"] ?? r["salaryOpt"] ?? r["Salary_Opt"] ?? r["SalaryOpt"]),
              salary_pes: toNumberOrNull(r["salary_pes"] ?? r["salaryPes"] ?? r["Salary_Pes"] ?? r["SalaryPes"]),
              AA: toNumberOrNull(r["AA"] ?? r["AA "] ?? r["All Australian"] ?? r["AllAustralian"] ?? r["AA_prob"] ?? r["AAProb"] ?? r["AA Probability"] ?? r["AA_Prob"]),
              Seasons: toNumberOrNull(r["Seasons"]),
              Season_90: toNumberOrNull(
                r["Season_90"] ??
                  r["season_90"] ??
                  r["Season90"] ??
                  r["season90"] ??
                  r["Season_90 "] ??
                  r["Season 90"]
              ),
              Games: toNumberOrNull(r["Games"] ?? r["Games100"] ?? r["Games_100"] ?? r["Games100+"] ?? r["Games100Plus"] ?? r["Games Probability"] ?? r["Games_prob"] ?? r["GamesProb"]),
              Height:
                toPresentString(
                  r["Height"] ??
                    r["height"] ??
                    r["Height.y"] ??
                    r["height.y"] ??
                    r["Height_x"] ??
                    r["Height.x"] ??
                    r["height_x"] ??
                    r["height.x"] ??
                    r["Height_cm"] ??
                    r["height_cm"] ??
                    r["height.cm"] ??
                    r["Height (cm)"]
                ) || null,
              Age:
                toPresentString(
                  r["Age"] ??
                    r["age"] ??
                    r["Age.y"] ??
                    r["age.y"] ??
                    r["Age_x"] ??
                    r["Age.x"] ??
                    r["age_x"] ??
                    r["age.x"] ??
                    r["Age_Season"] ??
                    r["age.season"] ??
                    r["age_season"]
                ) || null,
              Drafted:
                toPresentString(
                  r["Drafted"] ??
                    r["drafted"] ??
                    r["Drafted.y"] ??
                    r["drafted.y"] ??
                    r["Drafted_x"] ??
                    r["Drafted.x"] ??
                    r["drafted_x"] ??
                    r["drafted.x"] ??
                    r["Draft"] ??
                    r["draft"]
                ) || null,
              draftYear:
                toPresentString(
                  r["draftYear"] ??
                    r["DraftYear"] ??
                    r["draftYear.y"] ??
                    r["DraftYear.y"] ??
                    r["draftYear_x"] ??
                    r["DraftYear_x"] ??
                    r["draft_year"] ??
                    r["Draft Year"]
                ) || null,
                            Type: toTrimmedString(r["Type"]) || undefined,
              team: toTrimmedString(r["team"]) || undefined,
              rank_all: toNumberOrNull(r["rank_all"] ?? r["Rank_all"] ?? r["rankAll"] ?? r["rank_all "]),
              rank_pos: toNumberOrNull(r["rank_pos"] ?? r["Rank_pos"] ?? r["rankPos"] ?? r["rank_pos "]),

              // Performance components (safe even if missing)
              Kicks: toNumberOrNull(r["Kicks"]),
              Hitouts: toNumberOrNull(r["Hitouts"]),
              Intercepts: toNumberOrNull(r["Intercepts"]),
              Spoils: toNumberOrNull(r["Spoils"]),
              Transition: toNumberOrNull(r["Transition"]),
              Shots: toNumberOrNull(r["Shots"]),
              Stoppage: toNumberOrNull(r["Stoppage"]),
              Ball_Use: toNumberOrNull(r["Ball_Use"]),
              Ball_Winning: toNumberOrNull(r["Ball_Winning"]),
              Pressure: toNumberOrNull(r["Pressure"]),

              // New advanced stats (safe even if missing)
              Kicking: toNumberOrNull(r["Kicking"]),
              Handballing: toNumberOrNull(r["Handballing"]),
              Transition_Ball_Use: toNumberOrNull(r["Transition_Ball_Use"] ?? r["Transition_BallUse"] ?? r["Transition Ball Use"]),
              Post_Clearance_Ball_Use: toNumberOrNull(r["Post_Clearance_Ball_Use"] ?? r["Post Clearance Ball Use"]),
              Clearance_Ball_Use: toNumberOrNull(r["Clearance_Ball_Use"] ?? r["Clearance Ball Use"]),
              Aerial: toNumberOrNull(r["Aerial"]),
              Ground: toNumberOrNull(r["Ground"]),
              Run_Carry: toNumberOrNull(r["Run_Carry"] ?? r["Run Carry"]),
              Turnover_Transition_Ball_Winning: toNumberOrNull(
                r["Turnover_Transition_Ball_Winning"] ?? r["Turnover Transition Ball Winning"]
              ),
              Stoppage_Transition_Ball_Winning: toNumberOrNull(
                r["Stoppage_Transition_Ball_Winning"] ?? r["Stoppage Transition Ball Winning"]
              ),
              Pre_Clearance_Ball_Winning: toNumberOrNull(r["Pre_Clearance_Ball_Winning"] ?? r["Pre Clearance Ball Winning"]),
              Spoiling: toNumberOrNull(r["Spoiling"] ?? r["Spoil"] ?? r["Spoils"] ?? r["Spoiling"]),
            };
          }),

          loadApiDataAsObjects<PlayerStatsAggRow>("CD_player_stats_agg.csv", (r) => {
            const seasonN = toNumberOrNull(r["season"] ?? r["Season"] ?? "");
            const playerId = (r["player.id"] ?? r["player_id"] ?? r["playerId"] ?? "").toString().trim();
            const playerName = (r["player.name"] ?? r["player_name"] ?? r["playerName"] ?? "").toString().trim();
            const metricName = (r["metric_name"] ?? r["metric_name "] ?? r["Metric Name"] ?? r["Metric_Name"] ?? "").toString().trim();
            const cat = (r["category"] ?? r["Metric_Category"] ?? r["Metric Category"] ?? "").toString().trim();
            const valN = toNumberOrNull(r["metric_value"] ?? r["metricValue"] ?? r["value"] ?? "");
            if (seasonN === null || !playerId || !metricName || !cat || valN === null) return null;
            return { season: seasonN, player_id: playerId, player_name: playerName, metric_name: metricName, category: cat, metric_value: valN };
          }),

          loadApiDataAsObjects<ComparablePlayerRow>("comparable_players.csv", (r) => {
            const spid = normalizePlayerId(r["SourceproviderId"]);
            const srcSeason = toNumberOrNull(r["SourceSeason"]);
            const simSeason = toNumberOrNull(r["SimilarSeason"]);
            const simScore = toNumberOrNull(r["similarity"]);
            if (!spid || srcSeason === null || !toTrimmedString(r["SimilarPlayer"]) || simSeason === null || simScore === null) return null;

            const n = (k: string) => toNumberOrNull(r[k]);
            return {
              SourceproviderId: spid,
              SourcePlayer: toTrimmedString(r["SourcePlayer"]),
              SourceSeason: srcSeason,
              SourcePosition: toTrimmedString(r["SourcePosition"]),
              SourceClub: normalizeClubName(r["SourceClub"] ?? ""),
              SimilarPlayer: toTrimmedString(r["SimilarPlayer"]),
              SimilarSeason: simSeason,
              similarity: simScore,
              rank: toNumberOrNull(r["rank"]),
              adj_1: n("adj_1"),
              adj_2: n("adj_2"),
              adj_3: n("adj_3"),
              adj_4: n("adj_4"),
              adj_5: n("adj_5"),
              adj_6: n("adj_6"),
              adj_7: n("adj_7"),
              adj_8: n("adj_8"),
              adj_9: n("adj_9"),
              adj_10: n("adj_10"),
            };
          }),

        ]);

        if (!alive) return;

        setRosterPlayers(roster);
        setTeamKpis(kpis);
        setRankSeries(ranks);
        setSkillRadar(radar);
        setAcqBreakdown(acq);
        setPlayerProjections(proj);
        setAflForm(aflFormRows);
        setVflForm(vflFormRows);
        setCareerProjections(careerProjResult.rows);
        setCareerProjectionsLastUpdated(careerProjResult.lastUpdatedLabel);
        setPlayerStatsAgg(playerStatsAggRows);
        setComparablePlayers(comparableRows);

      } catch (e: any) {
        if (!alive) return;
        setLoadErr(e?.message ?? String(e));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // --------
  // Years pills
  // --------
  const years = useMemo(() => {
    const values = new Set<number>();
    for (const r of rosterPlayers) if (r.league === selectedLeague) values.add(r.season);
    for (const r of teamKpis) if (r.league === selectedLeague) values.add(r.season);
    for (const r of playerProjections) if (r.league === selectedLeague) values.add(r.season);
    for (const r of aflForm) if (r.league === selectedLeague) values.add(r.season);
    const out = Array.from(values).sort((a, b) => a - b);
    return out.length ? out : [...UI_SEASONS];
  }, [rosterPlayers, teamKpis, playerProjections, aflForm, selectedLeague]);

  useEffect(() => {
    if (!years.length || years.includes(season)) return;
    const nearest = years.reduce((best, y) => (Math.abs(y - season) < Math.abs(best - season) ? y : best), years[0]);
    if (nearest !== season) setSeason(nearest);
  }, [years, season]);



  // --------
  // Roster panel
  // --------
  const rosterForSeason = useMemo(() => {
    const clubRows = rosterPlayers.filter(
      (r) =>
        normalizeTeamId(r.team_id) === normalizeTeamId(team) &&
        r.league === selectedLeague
    );
    const seasons = Array.from(new Set(clubRows.map((r) => r.season))).sort((a, b) => a - b);
    if (seasons.length === 0) return { players: [] as RosterPlayerRow[], usedSeason: season };

    const usedSeason =
      seasons.includes(season)
        ? season
        : seasons.reduce((best, s) => (Math.abs(s - season) < Math.abs(best - season) ? s : best), seasons[0]);

    const players = clubRows.filter((r) => r.season === usedSeason);
    return { players, usedSeason };
  }, [rosterPlayers, team, season, selectedLeague]);


function getRosterForClubSeason(targetTeamId: string) {
  const clubRows = rosterPlayers.filter(
    (r) =>
      normalizeTeamId(r.team_id) === normalizeTeamId(targetTeamId) &&
      r.league === selectedLeague
  );
  const seasons = Array.from(new Set(clubRows.map((r) => r.season))).sort((a, b) => a - b);
  if (seasons.length === 0) return { players: [] as RosterPlayerRow[], usedSeason: season };

  const usedSeason =
    seasons.includes(season)
      ? season
      : seasons.reduce((best, s) => (Math.abs(s - season) < Math.abs(best - season) ? s : best), seasons[0]);

  const players = clubRows.filter((r) => r.season === usedSeason);
  return { players, usedSeason };
}

const rosterTurnoverByTeamSeason = useMemo(() => {
  const idsByKey = new Map<string, Set<string>>();

  for (const r of rosterPlayers) {
    const teamName = normalizeTeamId(r.team_id);
    const pid = normalizePlayerId(r.providerId);
    const league = normalizeLeague(r.league);
    if (!teamName || !pid || !league || !Number.isFinite(r.season)) continue;

    const key = `${league}|${teamName}|${r.season}`;
    let set = idsByKey.get(key);
    if (!set) {
      set = new Set<string>();
      idsByKey.set(key, set);
    }
    set.add(pid);
  }

  const countNew = (league: LeagueCode, teamName: string, yr: number): number | null => {
    const cur = idsByKey.get(`${league}|${teamName}|${yr}`);
    const prev = idsByKey.get(`${league}|${teamName}|${yr - 1}`);
    if (!cur || !prev) return null;
    let n = 0;
    for (const pid of cur) if (!prev.has(pid)) n += 1;
    return n;
  };

  const clubCurrent = countNew(selectedLeague, team, season);
  const clubPrev = countNew(selectedLeague, team, season - 1);
  const clubYoY =
    clubCurrent !== null && clubPrev !== null ? clubCurrent - clubPrev : null;

  const teams = Array.from(
    new Set(
      rosterPlayers
        .filter((r) => r.league === selectedLeague)
        .map((r) => normalizeTeamId(r.team_id))
        .filter(Boolean)
    )
  );
  const leagueVals = teams
    .map((t) => countNew(selectedLeague, t, season))
    .filter((v): v is number => v !== null && Number.isFinite(v));

  return { clubCurrent, clubYoY, leagueVals };
}, [rosterPlayers, selectedLeague, team, season]);


  const ageHist = useMemo(() => makeAgeHistogram(rosterForSeason.players), [rosterForSeason.players]);
const AGE_CAT_ORDER = ["Rising Stars", "Established Youth", "Prime", "Veterans", "Old Timers"];

function calcAgeCatShare(ps: RosterPlayerRow[]) {
  if (!ps.length) return [] as { age_cat: string; points: number; pct: number }[];

  const totals = new Map<string, number>();
  let grandTotal = 0;

  for (const p of ps) {
    const cat = toTrimmedString(p.age_cat);
    if (!cat) continue;

    const v = Number(p.ratings ?? 0);
    if (!Number.isFinite(v)) continue;

    totals.set(cat, (totals.get(cat) ?? 0) + v);
    grandTotal += v;
  }

  grandTotal = grandTotal || 1;

  const rows = Array.from(totals.entries()).map(([age_cat, points]) => ({
    age_cat,
    points,
    pct: (points / grandTotal) * 100,
  }));

  // keep your preferred order
  rows.sort((a, b) => {
    const ia = AGE_CAT_ORDER.indexOf(a.age_cat);
    const ib = AGE_CAT_ORDER.indexOf(b.age_cat);
    if (ia === -1 && ib === -1) return b.pct - a.pct;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return rows;
}

const ageCatShare = useMemo(() => calcAgeCatShare(rosterForSeason.players), [rosterForSeason.players]);



const usedSeason = rosterForSeason.usedSeason;

// team average age (selected club, usedSeason)
const teamAvgAge = useMemo(() => {
  const ps = rosterForSeason.players;
  if (!ps.length) return null;
  const avg = ps.reduce((a, p) => a + p.age, 0) / ps.length;
  return avg;
}, [rosterForSeason.players]);

// league average age (all clubs, same usedSeason)
const leagueAvgAge = useMemo(() => {
  const ps = rosterPlayers.filter((p) => p.season === usedSeason && p.league === selectedLeague);
  if (!ps.length) return null;
  const avg = ps.reduce((a, p) => a + p.age, 0) / ps.length;
  return avg;
}, [rosterPlayers, selectedLeague, usedSeason]);

// helper: convert numeric age to the X-axis label (your histogram uses String(age))
const toAgeLabel = (x: number) => String(Math.round(x));



  // --------
  // Club KPI row from team_kpis
  // --------
  const clubKpiSelection = useMemo(() => {
    const rows = teamKpis.filter(
      (r) =>
        normalizeTeamId(r.team_id) === normalizeTeamId(team) &&
        r.league === selectedLeague
    );
    return pickSeasonRow(rows, season);
  }, [teamKpis, team, season, selectedLeague]);
  const clubKpi = clubKpiSelection.row;

  // --------
  // AFL + VFL KPI selections
  // --------
  const aflFormPick = useMemo(() => {
    const rows = aflForm
      .filter(
        (r) =>
          normalizeTeamId(r.team_id) === normalizeTeamId(team) &&
          r.league === selectedLeague &&
          r.season === season
      )
      .sort((a, b) => b.weighted_avg - a.weighted_avg);
    return rows[0] ?? null;
  }, [aflForm, team, season, selectedLeague]);
const rankTrendMeta = useMemo(() => {
  const clubRows = rankSeries
    .filter((r) => r.league === selectedLeague && normalizeClubName(r.Club) === clubKey)
    .sort((a, b) => a.year - b.year);

  if (clubRows.length === 0) {
    return { rows: [] as any[], missingActualYears: [] as number[] };
  }

  const missingActualYears = clubRows
    .filter((r) => r.year <= DEFAULT_SEASON - 1 && r.actual_rank == null)
    .map((r) => r.year);

  // Forecast rows are anchored on the latest year where an actual rank exists.
  // This prevents future-placeholder rows (with NA actuals) from shifting forecast years too far out.
  const latestActual = [...clubRows].reverse().find((r) => r.actual_rank != null) ?? clubRows[clubRows.length - 1];
  const latestYear = latestActual.year;

  // Prefer explicit future forecast rows (e.g. 2026 row after a 2025 actual),
  // then fall back to the latest-actual row for legacy files.
  const hasForecastSignal = (r: RankRow) =>
    r.forecast_a_rank != null ||
    r.forecast_b_rank != null ||
    r.finish_1_p25 != null ||
    r.finish_1_p75 != null ||
    r.finish_2_p25 != null ||
    r.finish_2_p75 != null;

  const futureForecastRows = clubRows
    .filter((r) => r.year > latestYear && hasForecastSignal(r))
    .sort((a, b) => a.year - b.year);

  const forecastSource = futureForecastRows[0] ?? latestActual;
  const forecastSourceNext = futureForecastRows[1] ?? null;

  const proj1Forecast = forecastSource.forecast_a_rank ?? latestActual.forecast_a_rank ?? null;
  const proj1P25 = forecastSource.finish_1_p25 ?? latestActual.finish_1_p25 ?? null;
  const proj1P75 = forecastSource.finish_1_p75 ?? latestActual.finish_1_p75 ?? null;

  const proj2Forecast =
    forecastSource.forecast_b_rank ??
    forecastSourceNext?.forecast_a_rank ??
    latestActual.forecast_b_rank ??
    null;
  const proj2P25 =
    forecastSource.finish_2_p25 ??
    forecastSourceNext?.finish_1_p25 ??
    latestActual.finish_2_p25 ??
    null;
  const proj2P75 =
    forecastSource.finish_2_p75 ??
    forecastSourceNext?.finish_1_p75 ??
    latestActual.finish_2_p75 ??
    null;

  const history = clubRows
    .filter((r) => r.year <= latestYear && r.year >= latestYear - 9)
    .map((r) => ({
      year: String(r.year),
      actual: r.actual_rank ?? null,
      fcstA: null as number | null,
      fcstB: null as number | null,
      p25: null as number | null,
      p75: null as number | null,
    }));

  const projYear1 = latestYear + 1;
  const projYear2 = latestYear + 2;

  const streamed = [
    // anchor for forecast connection
    {
      year: String(latestYear),
      actual: latestActual.actual_rank ?? null,
      fcstA: latestActual.actual_rank ?? null,
      fcstB: null,
      p25: null,
      p75: null,
    },
    // +1 season
    {
      year: String(projYear1),
      actual: null,
      fcstA: proj1Forecast,
      fcstB: proj1Forecast,
      p25: proj1P25,
      p75: proj1P75,
    },
    // +2 season
    {
      year: String(projYear2),
      actual: null,
      fcstA: null,
      fcstB: proj2Forecast,
      p25: proj2P25,
      p75: proj2P75,
    },
  ];

  // merge
  const map = new Map<string, any>();
  for (const r of history) map.set(r.year, r);
  for (const r of streamed) map.set(r.year, { ...(map.get(r.year) ?? {}), ...r });

  // ✅ add band fields here, then return once
  const rows = Array.from(map.values())
    .map((r: any) => {
      const p25 = r.p25;
      const p75 = r.p75;
      const ok =
        p25 != null &&
        p75 != null &&
        Number.isFinite(p25) &&
        Number.isFinite(p75);

      return {
        ...r,
        bandLow: ok ? p25 : null,
        bandRange: ok ? Math.max(0, p75 - p25) : null,
      };
    })
    .sort((a, b) => Number(a.year) - Number(b.year));
  return { rows, missingActualYears };
}, [rankSeries, clubKey, selectedLeague]);
const rankTrend = rankTrendMeta.rows;
const rankMissingActualYears = rankTrendMeta.missingActualYears;
const rankSourceFile = selectedLeague === "AFLW" ? "team_rank_timeseries_aflw.csv" : "team_rank_timeseries.csv";
const rankLastActualYear = useMemo(() => {
  for (let i = rankTrend.length - 1; i >= 0; i--) {
    if (rankTrend[i].actual !== null && rankTrend[i].actual !== undefined) return rankTrend[i].year;
  }
  return null;
}, [rankTrend]);

const ordinalRank = (n: number) => {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  const mod10 = v % 10;
  if (mod10 === 1) return `${v}st`;
  if (mod10 === 2) return `${v}nd`;
  if (mod10 === 3) return `${v}rd`;
  return `${v}th`;
};

const rankContextLabel = (rank: number | null | undefined) => {
  if (rank == null || !Number.isFinite(rank)) return "-";
  const rounded = Math.round(rank);
  if (Math.abs(rank - rounded) < 1e-6) return ordinalRank(rounded);
  return `${rank.toFixed(1)} (~${ordinalRank(rounded)})`;
};

const rankBandLabel = (rank: number | null | undefined) => {
  if (rank == null || !Number.isFinite(rank)) return null;
  if (rank <= 4) return "Top 4";
  if (rank <= 8) return "Finals (5-8)";
  if (rank <= 14) return "Mid-table (9-14)";
  return "Bottom 4 (15-18)";
};

function RankTrendTooltip({ active, label, payload }: any) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const toFinite = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const actual = toFinite(row.actual);
  const fcstA = toFinite(row.fcstA);
  const fcstB = toFinite(row.fcstB);
  const lastActualYearN = rankLastActualYear == null ? null : Number(rankLastActualYear);
  const yearN = Number(label ?? row.year);

  const isPlus2 =
    lastActualYearN != null && Number.isFinite(lastActualYearN) && Number.isFinite(yearN) && yearN === lastActualYearN + 2;
  const forecast = isPlus2 ? (fcstB ?? fcstA) : (fcstA ?? fcstB);
  const forecastLabel = isPlus2 ? "Forecast +2" : "Forecast +1";
  const outcomeBand = rankBandLabel(forecast);

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.98)",
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 12,
        padding: "8px 10px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        minWidth: 170,
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(0,0,0,0.55)", marginBottom: 4 }}>Year {label}</div>
      {actual != null ? (
        <div style={{ fontSize: 12, color: "rgba(0,0,0,0.82)" }}>
          Actual rank: <strong>{ordinalRank(actual)}</strong>
        </div>
      ) : null}
      {actual == null && forecast != null ? (
        <>
          <div style={{ fontSize: 12, color: "rgba(0,0,0,0.82)" }}>
            {forecastLabel}: <strong>{rankContextLabel(forecast)}</strong>
          </div>
          {outcomeBand ? (
            <div style={{ fontSize: 12, color: "rgba(0,0,0,0.82)", marginTop: 2 }}>
              Outcome band: <strong>{outcomeBand}</strong>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}


  function ActualEndLabelDot(props: any) {
    const { cx, cy, payload } = props;
    if (!payload) return null;

    if (!rankLastActualYear || payload.year !== rankLastActualYear) return null;

    return (
      <g>
        <circle cx={cx} cy={cy} r={2.5} fill="rgba(0,0,0,0.85)" stroke="white" strokeWidth={1} />
        <text
          x={cx + 8}
          y={cy + 4}
          fontSize={12}
          fill="rgba(0,0,0,0.75)"
          style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.95)", strokeWidth: 3 }}
        >
          {clubName}
        </text>
      </g>
    );
  }

  // --------
  // Acquisition pie
  // --------
  const acquisitionSpider = useMemo(() => {
    const rows = acqBreakdown
      .filter(
        (r) =>
          normalizeTeamId(r.team_id) === normalizeTeamId(team) &&
          r.league === selectedLeague &&
          r.Year === season
      )
      .sort((a, b) => b.value - a.value);

    const total = rows.reduce((a, r) => a + (r.value ?? 0), 0) || 1;
    return rows.map((r) => ({
      metric: r.Draft,
      value: (r.value / total) * 100,
    }));
  }, [acqBreakdown, team, season, selectedLeague]);

  const acquisitionBars = useMemo(
    () =>
      acquisitionSpider
        .filter((r) => Number.isFinite(r.value) && r.value > 0)
        .sort((a, b) => b.value - a.value),
    [acquisitionSpider]
  );

  // --------
  // Team radar
  // --------
  function buildTeamSkillRadar(targetTeamId: string) {
  const clubRows = skillRadar.filter(
    (r) =>
      normalizeTeamId(r.team_id) === normalizeTeamId(targetTeamId) &&
      r.league === selectedLeague
  );
  if (clubRows.length === 0) return [];

  const exact =
    clubRows.find((r) => String(r.season).trim() === String(season).trim()) ??
    clubRows.find((r) => toNumberOrNull(String(r.season)) === season) ??
    clubRows[0];

  const toPct = (v: number) => clamp(v * 100, 0, 100);

  return [
    { metric: "K-H Ratio", value: toPct(exact.KH_Ratio) },
    { metric: "GB/MK Ratio", value: toPct(exact.GB_MK_Ratio) },
    { metric: "Fwd Half", value: toPct(exact.Fwd_Half) },
    { metric: "Scores", value: toPct(exact.Scores) },
    { metric: "PP Chain", value: toPct(exact.PPchain) },
    { metric: "Pts / i50", value: toPct(exact.Points_per_I50) },
    { metric: "Repeat i50s", value: toPct(exact.Repeat_I50s) },
    { metric: "Ball Use", value: toPct(exact.Rating_Ball_Use) },
    { metric: "Ball Win", value: toPct(exact.Rating_Ball_Win) },
    { metric: "Chain Metres", value: toPct(exact.Chain_Metres) },
    { metric: "Time in Poss", value: toPct(exact.Time_in_Poss_Pct) },
  ];
}

const teamSkillRadar = useMemo(() => buildTeamSkillRadar(team), [skillRadar, team, season, selectedLeague]);

const compareTeamOption = useMemo(() => getTeamOptionById(compareTeam), [compareTeam]);
const compareClubName = useMemo(() => compareTeamOption?.name ?? "", [compareTeamOption]);
const compareClubLabel = useMemo(() => compareTeamOption?.label ?? compareTeamOption?.name ?? "", [compareTeamOption]);
const compareClubKey = useMemo(() => (compareClubName ? normalizeClubName(compareClubName) : ""), [compareClubName]);
const compareColor = useMemo(() => (compareClubKey ? (TEAM_PRIMARY_COLOR[compareClubKey] ?? "#111111") : "#111111"), [compareClubKey]);

const compareSkillRadar = useMemo(
  () => (compareTeam ? buildTeamSkillRadar(compareTeam) : []),
  [skillRadar, compareTeam, season, selectedLeague]
);


const compareRosterForSeason = useMemo(
  () => (compareTeam ? getRosterForClubSeason(compareTeam) : { players: [] as RosterPlayerRow[], usedSeason: season }),
  [rosterPlayers, compareTeam, season, selectedLeague]
);

const compareAgeCatShare = useMemo(
  () => (compareTeam ? calcAgeCatShare(compareRosterForSeason.players) : []),
  [compareTeam, compareRosterForSeason.players]
);

const compareClubKpi = useMemo(() => {
  if (!compareTeam) return null;
  const rows = teamKpis.filter(
    (r) =>
      normalizeTeamId(r.team_id) === normalizeTeamId(compareTeam) &&
      r.league === selectedLeague
  );
  return pickSeasonRow(rows, season).row;
}, [teamKpis, compareTeam, season, selectedLeague]);

const compareAcquisitionShare = useMemo(() => {
  if (!compareTeam) return [] as { metric: string; value: number }[];
  const rows = acqBreakdown
    .filter(
      (r) =>
        normalizeTeamId(r.team_id) === normalizeTeamId(compareTeam) &&
        r.league === selectedLeague &&
        r.Year === season
    )
    .sort((a, b) => a.Draft.localeCompare(b.Draft));

  const total = rows.reduce((a, r) => a + (r.value ?? 0), 0) || 1;
  return rows.map((r) => ({
    metric: r.Draft,
    value: (r.value / total) * 100,
  }));
}, [acqBreakdown, compareTeam, season, selectedLeague]);

const comparisonTables = useMemo(() => {
  if (!compareTeam) return null;

  const num = (x: any) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  const pctByKey = (rows: any[], keyField: string, valField: string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r[keyField]), Number(r[valField] ?? 0));
    return m;
  };

  // Scalars
  const baseAge = num(clubKpi?.squad_age_avg);
  const compAge = num(compareClubKpi?.squad_age_avg);

  const baseExp = num(clubKpi?.squad_experience_avg_games);
  const compExp = num(compareClubKpi?.squad_experience_avg_games);

  const baseTurn = num(clubKpi?.squad_turnover_players);
  const compTurn = num(compareClubKpi?.squad_turnover_players);

  const scalars = [
    { metric: "Age", a: baseAge, b: compAge, fmt: (v: number) => v.toFixed(1) },
    { metric: "Experience", a: baseExp, b: compExp, fmt: (v: number) => Math.round(v).toLocaleString() },
    { metric: "Turnover", a: baseTurn, b: compTurn, fmt: (v: number) => Math.round(v).toLocaleString() },
  ].map((r) => ({
    ...r,
    diff: r.a == null || r.b == null ? null : r.a - r.b,
  }));

  // Age drivers (percent)
  const baseAgeMap = pctByKey(ageCatShare, "age_cat", "pct");
  const compAgeMap = pctByKey(compareAgeCatShare, "age_cat", "pct");
  const ageCats = Array.from(new Set([...baseAgeMap.keys(), ...compAgeMap.keys(), ...AGE_CAT_ORDER]))
    .filter(Boolean)
    .sort((x, y) => {
      const ix = AGE_CAT_ORDER.indexOf(x);
      const iy = AGE_CAT_ORDER.indexOf(y);
      if (ix === -1 && iy === -1) return x.localeCompare(y);
      if (ix === -1) return 1;
      if (iy === -1) return -1;
      return ix - iy;
    });

  const ageDrivers = ageCats.map((k) => {
    const a = baseAgeMap.get(k) ?? 0;
    const b = compAgeMap.get(k) ?? 0;
    return { metric: k, a, b, diff: a - b };
  });

  // Acquisition (percent)
  const baseAcqMap = pctByKey(acquisitionSpider, "metric", "value");
  const compAcqMap = pctByKey(compareAcquisitionShare, "metric", "value");
  const acqCats = Array.from(new Set([...baseAcqMap.keys(), ...compAcqMap.keys()])).sort((a, b) => a.localeCompare(b));
  const acquisition = acqCats.map((k) => {
    const a = baseAcqMap.get(k) ?? 0;
    const b = compAcqMap.get(k) ?? 0;
    return { metric: k, a, b, diff: a - b };
  });

  // Radar (0-100)
  const baseRadarMap = new Map(teamSkillRadar.map((d: any) => [d.metric, d.value]));
  const compRadarMap = new Map(compareSkillRadar.map((d: any) => [d.metric, d.value]));
  const radarCats = Array.from(new Set([...baseRadarMap.keys(), ...compRadarMap.keys()]));
  const radar = radarCats.map((k) => {
    const a = baseRadarMap.get(k) ?? 0;
    const b = compRadarMap.get(k) ?? 0;
    return { metric: k, a, b, diff: a - b };
  });

  return { scalars, ageDrivers, acquisition, radar };
}, [
  compareTeam,
  clubKpi,
  compareClubKpi,
  ageCatShare,
  compareAgeCatShare,
  acquisitionSpider,
  compareAcquisitionShare,
  teamSkillRadar,
  compareSkillRadar,
]);


const mergedSkillRadar = useMemo(() => {
  if (!compareSkillRadar.length) return teamSkillRadar;
  const m = new Map(compareSkillRadar.map((d: any) => [d.metric, d.value]));
  return teamSkillRadar.map((d: any) => ({
    ...d,
    compare: m.get(d.metric) ?? null,
  }));
}, [teamSkillRadar, compareSkillRadar]);


  // --------
  // Player projections table
  // --------
  const playerTable = useMemo<PlayerTableRow[]>(() => {
    const rows = playerProjections
      .filter(
        (r) =>
          normalizeTeamId(r.team_id) === normalizeTeamId(team) &&
          r.league === selectedLeague &&
          r.season === season
      )
      .map((r) => ({ name: r.player_name, rating: r.rating, salary: r.salary, AA: r.AA, Games: r.Games }))
      .sort((a, b) => b.rating - a.rating);

    return rows.slice(0, 12);
  }, [playerProjections, team, season, selectedLeague]);





// --------
// KPI row (AFL + VFL are club-aware)
// --------
  const kpis = useMemo(() => {
    // Use the season actually being shown for KPI + ranks (falls back to selected season)
    const rankSeason = clubKpiSelection.usedSeason ?? season;

  // League rows for that season (used for ranks)
  const leagueRows = teamKpis
    .filter((r) => r.season === rankSeason && r.league === selectedLeague);

    const nTeams = Math.max(selectedLeague === "AFL" ? 18 : 18, new Set(leagueRows.map((r) => normalizeTeamId(r.team_id))).size);

    const denseRank = (vals: number[], target: number, direction: "asc" | "desc") => {
      const cleaned = vals.filter((v) => Number.isFinite(v));
      if (!cleaned.length || !Number.isFinite(target)) return null;

    const uniq = Array.from(new Set(cleaned)).sort((a, b) => (direction === "asc" ? a - b : b - a));
      const idx = uniq.findIndex((v) => v === target);
      return idx === -1 ? null : idx + 1;
    };

    const ordinalRankByMetric = (
      rows: TeamKpiRow[],
      metric: (r: TeamKpiRow) => number,
      direction: "asc" | "desc",
      targetTeamId: string
    ) => {
      const ranked = rows
        .filter((r) => Number.isFinite(metric(r)) && !!r.team_id)
        .sort((a, b) => {
          const av = metric(a);
          const bv = metric(b);
          if (av === bv) return String(a.team_id).localeCompare(String(b.team_id));
          return direction === "asc" ? av - bv : bv - av;
        });

      const idx = ranked.findIndex((r) => normalizeTeamId(r.team_id) === normalizeTeamId(targetTeamId));
      return idx === -1 ? null : idx + 1;
    };

  const ageValue = clubKpi ? clubKpi.squad_age_avg.toFixed(1) : "—";
  const ageYoY   = clubKpi ? safeYoY(clubKpi.squad_age_yoy, 1) : "YoY: —";

  const expValue = clubKpi ? Math.round(clubKpi.squad_experience_avg_games).toLocaleString() : "—";
  const expYoY   = clubKpi ? safeYoY(clubKpi.squad_experience_yoy, 1) : "YoY: —";

  // Prefer roster-derived turnover for the selected season to avoid stale KPI feeds.
  const effectiveTurnover =
    rosterTurnoverByTeamSeason.clubCurrent ??
    (clubKpi ? clubKpi.squad_turnover_players : null);
  const effectiveTurnoverYoY =
    rosterTurnoverByTeamSeason.clubYoY ??
    (clubKpi ? clubKpi.squad_turnover_yoy : null);

  const toValue  = effectiveTurnover != null ? `${Math.round(effectiveTurnover)} players` : "—";
  const toYoY    = safeYoY(effectiveTurnoverYoY, 1);

  // Ranks
    // Age: oldest = #1 (descending)
    const ageRank =
      clubKpi && Number.isFinite(clubKpi.squad_age_avg)
        ? ordinalRankByMetric(leagueRows, (r) => r.squad_age_avg, "desc", team)
        : null;

    // Experience: most experienced = #1 (descending)
    const expRank =
      clubKpi && Number.isFinite(clubKpi.squad_experience_avg_games)
        ? ordinalRankByMetric(leagueRows, (r) => r.squad_experience_avg_games, "desc", team)
        : null;

  // Turnover: highest turnover = #1 (descending)
  const turnoverLeagueVals =
    rosterTurnoverByTeamSeason.leagueVals.length > 0
      ? rosterTurnoverByTeamSeason.leagueVals
      : leagueRows.map((r) => r.squad_turnover_players);
  const toRank =
    effectiveTurnover != null && Number.isFinite(effectiveTurnover)
      ? denseRank(turnoverLeagueVals, effectiveTurnover, "desc")
      : null;

  const ageSub = `${ageYoY} • Rank: ${ageRank ?? "—"}/${nTeams}`;
  const expSub = `${expYoY} • Rank: ${expRank ?? "—"}/${nTeams}`;
  const kpiSeasonSuffix =
    clubKpiSelection.usedSeason != null && clubKpiSelection.usedSeason !== season
      ? ` • Data: ${clubKpiSelection.usedSeason}`
      : "";
  const toSub  = `${toYoY} • Rank: ${toRank ?? "—"}/${nTeams}${kpiSeasonSuffix}`;

  // AFL form: top AFL rating from career projections for selected team + season.
  const aflValue = aflFormPick ? aflFormPick.weighted_avg.toFixed(1) : "—";
  const aflSub   = aflFormPick ? `Player: ${aflFormPick.player_name}` : "Player: —";
  const aflImg   = aflFormPick ? getPlayerImgUrl(aflFormPick.playerId) : null;

  // ✅ VFL pick (MAKE IT CLUB-AWARE HERE)
  const vflRowsForClubSeason = selectedLeague !== "AFL"
    ? []
    : vflForm
        .filter((r) => r.season === season)
        .filter((r) => normalizeClubName(r.team) === clubKey)
        .filter((r) => toTrimmedString(r.team).toLowerCase() !== "multiple"); // safety

  const vflPick =
    vflRowsForClubSeason.length === 0
      ? null
      : vflRowsForClubSeason.reduce((best, r) => (r.weighted_avg > best.weighted_avg ? r : best), vflRowsForClubSeason[0]);

  const vflValue = vflPick ? vflPick.weighted_avg.toFixed(1) : "—";
  const vflSub   = vflPick ? `Player: ${vflPick.player_name}` : "Player: —";
  const vflImg   = vflPick ? getPlayerImgUrl(vflPick.playerId) : null;

  return [
    { label: "Squad Age",        value: ageValue, sub: ageSub, icon: BarChart3, imgSrc: null as string | null },
    { label: "Squad Experience", value: expValue, sub: expSub, icon: Gauge,    imgSrc: null as string | null },
    { label: "Squad Turnover",   value: toValue,  sub: toSub,  icon: RotateCcw,imgSrc: null as string | null },
    { label: `${selectedLeague} Form`, value: aflValue, sub: aflSub, icon: Users, imgSrc: aflImg },
    { label: "VFL Form",         value: vflValue, sub: vflSub, icon: Home,     imgSrc: vflImg },
  ];
}, [clubKpi, clubKpiSelection.usedSeason, teamKpis, aflFormPick, vflForm, clubKey, season, rosterTurnoverByTeamSeason, team, selectedLeague]);

  const isTeamPage = page === "team";

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f6", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}>
      <style>
        {`
          .layoutGrid { display: grid; grid-template-columns: 1fr; gap: 14px; padding: 14px; min-height: 100vh; }
          .mainWrap { display: flex; flex-direction: column; gap: 14px; max-width: 1440px; width: 100%; margin: 0 auto; }
          .kpiGrid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
          .midGrid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 14px; }
          .botGrid { display: grid; grid-template-columns: 1fr 1fr 0.9fr; gap: 14px; }

          @media (max-width: 1200px) {
            .kpiGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .botGrid { grid-template-columns: 1fr 1fr; }
          }
          @media (max-width: 900px) {
            .layoutGrid { grid-template-columns: 1fr; }
            .midGrid { grid-template-columns: 1fr; }
            .botGrid { grid-template-columns: 1fr; }
          }
        
.compareToggleBtn {
  position: fixed;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 50;
  border-radius: 999px;
  padding: 10px 14px;
  border: 1px solid rgba(0,0,0,0.14);
  background: rgba(255,255,255,0.92);
  box-shadow: 0 10px 30px rgba(0,0,0,0.10);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  color: rgba(0,0,0,0.75);
}

.comparePanel {
  position: fixed;
  right: 14px;
  top: 14px;
  bottom: 14px;
  width: 560px;
  max-width: calc(100vw - 28px);
  z-index: 60;
  background: rgba(255,255,255,0.96);
  border: 1px solid rgba(0,0,0,0.10);
  border-radius: 22px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.14);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.comparePanelHeader {
  padding: 12px 12px 10px 12px;
  border-bottom: 1px solid rgba(0,0,0,0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.comparePanelBody {
  padding: 12px;
  overflow: auto;
}

.miniTable {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}
.miniTable th:first-child, .miniTable td:first-child { width: 52%; }
.miniTable th:nth-child(n+2), .miniTable td:nth-child(n+2) { width: 16%; text-align: right; font-variant-numeric: tabular-nums; }
.miniTable th, .miniTable td {
  padding: 8px 6px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  vertical-align: middle;
}
.miniTable th {
  text-align: left;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: rgba(0,0,0,0.55);
  font-weight: 800;
}
.miniTable td {
  color: rgba(0,0,0,0.75);
}

@media (max-width: 900px) {
  .comparePanel { width: 100%; right: 0; left: 0; top: 0; bottom: 0; border-radius: 0; }
  .compareToggleBtn { right: 10px; }
}`}
      </style>

      <div className="layoutGrid">

        <div className="mainWrap">
          {/* Header */}
          <div
            style={{
              borderRadius: 26,
              padding: "12px 16px",
              background: "linear-gradient(90deg, #f1f2f4 0%, #e5e7eb 55%, #f1f2f4 100%)",
              border: "1px solid rgba(0,0,0,0.08)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontSize: 28, fontWeight: 950, color: "#111", letterSpacing: -0.6, lineHeight: 1.05 }}>{clubLabel}</div>
                    {logoSrc ? (
                      <img
                        src={logoSrc}
                        alt={`${clubLabel} logo`}
                        style={{
                          height: 34,
                          width: 34,
                          objectFit: "contain",
                          borderRadius: 10,
                          background: "rgba(255,255,255,0.7)",
                          border: "1px solid rgba(0,0,0,0.08)",
                          padding: 4,
                        }}
                      />
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
                    {page === "team" ? `${selectedLeague} Team Profile | Season ${season}` : `${selectedLeague} career projection dashboard`}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 12 }}>
                  <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>View</div>
                  <Pill active={page === "team"} onClick={() => setPage("team")}>Team</Pill>
                  <Pill active={page === "career"} onClick={() => setPage("career")}>Career</Pill>
                </div>

                <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", marginRight: 4 }}>Year</div>

                {years.map((y) => (
                  <Pill
                    key={y}
                    active={y === season}
                    onClick={() => {
                      setSeason(y);
                    }}
                  >
                    {y}
                  </Pill>
                ))}

                <Pill
                  onClick={() => {
                    setTeam(DEFAULT_TEAM_ID);
                    setSeason(DEFAULT_SEASON);
                  }}
                >

                  <RotateCcw size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Reset
                </Pill>

                <Pill onClick={() => navigator.clipboard.writeText(window.location.href)}>
                  <RefreshCcw size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Copy link
                </Pill>

                <Pill onClick={onExportPng} disabled={exporting !== null}>
                  {exporting === "png" ? "Exporting PNG..." : "Export PNG"}
                </Pill>

                <Pill onClick={onExportPdf} disabled={exporting !== null}>
                  {exporting === "pdf" ? "Exporting PDF..." : "Export PDF"}
                </Pill>
              </div>
            </div>

            {/* Team-only KPI tiles (hide on player/career view) */}
            {page === "team" ? (
              <div className="kpiGrid" style={{ marginTop: 14 }}>
                {kpis.map((k) => (
                  <Kpi
                    key={k.label}
                    label={k.label}
                    value={k.value}
                    sub={k.sub}
                    Icon={k.icon}
                    imgSrc={(k as any).imgSrc}
                  />
                ))}
              </div>
            ) : null}

            {loading && (
              <div style={{ marginTop: 10, fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
                Loading data from <code>/api/data</code>…
              </div>
            )}
            {loadErr && (
              <div style={{ marginTop: 10, fontSize: 12, color: "rgba(200,0,0,0.75)" }}>
                Data load error: {loadErr}
                <div style={{ marginTop: 6, color: "rgba(0,0,0,0.55)" }}>
                  Tip: this build is configured to load JSON from the Azure SWA API (<code>/api/data</code>) which reads private CSVs from Blob Storage. If it fails, confirm the API deployed and your SWA Environment Variables are set (AZURE_STORAGE_CONNECTION_STRING, DATA_CONTAINER, DATA_API_KEY).
                </div>
              </div>
            )}
          </div>

          {isTeamPage ? (
            <>
              {/* Middle row */}
          <div className="midGrid">
            <Card style={{ minHeight: 380, display: "flex", flexDirection: "column" }}>
              <SectionTitle title="Season Finishing Position & Forecast" right={<span style={{ fontSize: 11, color: "rgba(0,0,0,0.55)" }}></span>} />

              <div style={{ marginTop: 8, height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rankTrend} margin={{ top: 10, right: 26, left: 0, bottom: 0 }}>



                    <ReferenceArea y1={1} y2={4} fill="rgba(34, 197, 94, 0.10)" strokeOpacity={0} />
                    <ReferenceArea y1={4} y2={14} fill="rgba(245, 158, 11, 0.10)" strokeOpacity={0} />
                    <ReferenceArea y1={14} y2={18} fill="rgba(239, 68, 68, 0.10)" strokeOpacity={0} />

                    <CartesianGrid stroke="rgba(0,0,0,0.08)" strokeDasharray="0 0" />
                    <XAxis dataKey="year" tick={{ fontSize: 12, fill: "rgba(0,0,0,0.6)" }} axisLine={{ stroke: "rgba(0,0,0,0.2)" }} tickLine={{ stroke: "rgba(0,0,0,0.2)" }} interval={1} />
                    <YAxis reversed tick={{ fontSize: 12, fill: "rgba(0,0,0,0.6)" }} axisLine={{ stroke: "rgba(0,0,0,0.2)" }} tickLine={{ stroke: "rgba(0,0,0,0.2)" }} width={40} domain={[1, 18]} ticks={[1, 4, 8, 12, 14, 18]} allowDecimals={false} />

                    {rankTrend.length > 0 && (
                      <ReferenceLine
                        x={rankLastActualYear ?? undefined}
                        stroke="rgba(0,0,0,0.18)"
                        strokeDasharray="4 4"
                      />
                    )}

                    <Tooltip content={<RankTrendTooltip />} />
{/* Invisible base up to p25 */}
<Area
  type="monotone"
  dataKey="bandLow"
  stackId="band"
  stroke="none"
  fill="rgba(0,0,0,0)"
  isAnimationActive={false}
  connectNulls={false}
/>

{/* Visible band from p25 to p75 */}
<Area
  type="monotone"
  dataKey="bandRange"
  stackId="band"
  stroke="none"
  fill="rgba(0,0,0,0.18)"
  isAnimationActive={false}
  connectNulls={false}
/>


                    <Line type="monotone" dataKey="actual" name="Actual" stroke="rgba(0,0,0,0.85)" strokeWidth={2.4} dot={<ActualEndLabelDot />} activeDot={{ r: 3 }} isAnimationActive={false} connectNulls={false} />
                    <Line type="monotone" dataKey="fcstA" name="Forecast +1" stroke="rgba(0,0,0,0.35)" strokeWidth={2} dot={false} strokeDasharray="4 3" isAnimationActive={false} connectNulls={false} />
                    <Line type="monotone" dataKey="fcstB" name="Forecast +2" stroke="rgba(0,0,0,0.25)" strokeWidth={2} dot={false} strokeDasharray="4 3" isAnimationActive={false} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div style={{ marginTop: 10, fontSize: 14, color: "rgba(0,0,0,0.55)" }}>Black = actual. Grey dashed = forecast scenarios (only from the most recent season).</div>
              {rankMissingActualYears.length > 0 ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "rgba(0,0,0,0.5)" }}>
                  Actual ladder rank is unavailable in <code>{rankSourceFile}</code> for: {rankMissingActualYears.join(", ")}.
                </div>
              ) : null}
            </Card>

            <Card style={{ minHeight: 420, display: "flex", flexDirection: "column" }}>
              <SectionTitle title="Playing Profile: Age Distribution" />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 0.95fr", gridTemplateRows: "auto 260px", gap: 16, alignItems: "start" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                  Age (count)
                  {rosterForSeason.usedSeason !== season ? (
                    <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(0,0,0,0.55)" }}> — showing {rosterForSeason.usedSeason}</span>
                  ) : null}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>Age Performance Drivers</div>

                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ageHist} margin={{ top: 18, right: 10, left: 0, bottom: 0 }}>
  <CartesianGrid strokeDasharray="3 3" />
  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={1} />
  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
  <Tooltip
    formatter={(val: any) => [val, "Players"]}
    labelFormatter={(label: any) => `Age: ${label}`}
  />

  {/* ✅ Team average age (team colour, dashed) */}
  {teamAvgAge !== null && (
    <ReferenceLine
      x={toAgeLabel(teamAvgAge)}
      stroke={teamColor}
      strokeDasharray="6 4"
      strokeWidth={2}
      ifOverflow="extendDomain"
      label={{
        value: `Team Avg ${teamAvgAge.toFixed(1)}`,
        position: "insideTop",
        fill: teamColor,
        fontSize: 11,
      }}
    />
  )}

  {/* ✅ League average age (red, dashed) */}
  {leagueAvgAge !== null && (
    <ReferenceLine
      x={toAgeLabel(leagueAvgAge)}
      stroke="#EF4444"
      strokeDasharray="6 4"
      strokeWidth={2}
      ifOverflow="extendDomain"
      label={{
        value: `League Avg ${leagueAvgAge.toFixed(1)}`,
        position: "top",
        fill: "#EF4444",
        fontSize: 11,
      }}
    />
  )}

  <Bar dataKey="count" fill={teamColor} fillOpacity={0.85}>
    <LabelList dataKey="count" content={<ColumnTopLabel />} />
  </Bar>
</BarChart>

                  </ResponsiveContainer>
                </div>

                <div style={{ height: 260, overflow: "hidden", paddingTop: 18 }}>
                  <HorizontalBarRows
  rows={ageCatShare.map(r => ({ ...r, pctLabel: `${r.pct.toFixed(0)}%` }))}
  labelKey="age_cat"
  valueKey="pct"
   labelCol={{ min: 0, ideal: 140, max: 140 }}
  barHeight={18}
  rowGap={18}
  valueColWidth={52}
  colGap={8}
/>


                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 14, color: "rgba(0,0,0,0.5)" }}>Ages are based on the player's age at the end of the selected season.</div>
            </Card>
          </div>

          {/* Bottom row */}
          <div className="botGrid">
            <Card>
              <SectionTitle title="How the list was built..." right={<span style={{ fontSize: 11, color: "rgba(0,0,0,0.55)" }}>share of list (%)</span>} />
              <div style={{ minHeight: 280 }}>
                {acquisitionBars.length === 0 ? (
                  <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(0,0,0,0.55)", fontSize: 14 }}>
                    No list build data available for this season.
                  </div>
                ) : (
                  <div style={{ paddingTop: 2, paddingRight: 6 }}>
                    <HorizontalBarRows
                      rows={acquisitionBars}
                      labelKey="metric"
                      valueKey="value"
                      getColor={(label) => stableColorForKey(label)}
                      labelCol={{ min: 0, ideal: 150, max: 210 }}
                      barHeight={14}
                      rowGap={14}
                      valueColWidth={50}
                      colGap={10}
                    />
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <SectionTitle title="Player Projection Table" right={<span style={{ fontSize: 11, color: "rgba(0,0,0,0.55)" }}>{season}</span>} />
              <PlayerProjectionTable rows={playerTable} />
              <div style={{ marginTop: 10, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>From <code></code> (AA % shown as probability of making a future AA side).</div>
            </Card>

            <Card>
              <SectionTitle
  title="Team Profile (Radar)"
  right={
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <select
        value={compareTeam}
        onChange={(e) => setCompareTeam(e.target.value)}
        style={{
          fontSize: 12,
          padding: "6px 10px",
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.14)",
          background: "rgba(255,255,255,0.85)",
          color: "rgba(0,0,0,0.8)",
          cursor: "pointer",
        }}
      >
        <option value="">No comparison</option>
        {teamOptionsForLeague.filter((t) => t.id !== team).map((t) => (
          <option key={t.id} value={t.id}>
            {t.label ?? t.name}
          </option>
        ))}
      </select>

      <span style={{ fontSize: 11, color: "rgba(0,0,0,0.55)" }}>0–100</span>
    </div>
  }
/>

              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={mergedSkillRadar} outerRadius="70%">
  <PolarGrid />
  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 11 }} />

  {/* Main team */}
  <Radar
    name={clubLabel}
    dataKey="value"
    stroke={teamColor}
    fill={teamColor}
    strokeWidth={2}
    fillOpacity={0.18}
    isAnimationActive={false}
  />

  {/* Comparison team (overlay) */}
  {compareSkillRadar.length > 0 && (
    <Radar
      name={compareClubLabel}
      dataKey="compare"
      stroke={compareColor}
      fill={compareColor}
      strokeWidth={2}
      fillOpacity={0.10}
      strokeDasharray="6 4"
      isAnimationActive={false}
      connectNulls
    />
  )}

  <Tooltip formatter={(v: any, n: any) => [Number(v).toFixed(1), n]} />
</RadarChart>

                </ResponsiveContainer>
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: "rgba(0,0,0,0.55)" }}>*All metrics are normalised using the last 10 seasons of AFL data<code></code>.</div>
            </Card>
          </div>

          <div style={{ height: 8 }} />
{/* Right compare sidebar */}
{!comparePanelOpen && (
  <button className="compareToggleBtn" onClick={() => setComparePanelOpen(true)}>
    Compare
  </button>
)}

{comparePanelOpen && (
  <div className="comparePanel">
    <div className="comparePanelHeader">
      <div>
        <div style={{ fontSize: 13, fontWeight: 950, color: "rgba(0,0,0,0.55)", letterSpacing: -0.2 }}>Compare</div>
        <div style={{ fontSize: 11, color: "rgba(0,0,0,0.50)" }}>Overlay + side-by-side metrics</div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {compareTeam ? (
          <button
            onClick={() => setCompareTeam("")}
            style={{
              borderRadius: 999,
              padding: "7px 10px",
              border: "1px solid rgba(0,0,0,0.14)",
              background: "rgba(255,255,255,0.85)",
              fontSize: 12,
              cursor: "pointer",
              color: "rgba(0,0,0,0.72)",
              fontWeight: 800,
            }}
          >
            Clear
          </button>
        ) : null}

        <button
          onClick={() => setComparePanelOpen(false)}
          style={{
            borderRadius: 999,
            padding: "7px 10px",
            border: "1px solid rgba(0,0,0,0.14)",
            background: "rgba(0,0,0,0.06)",
            fontSize: 12,
            cursor: "pointer",
            color: "rgba(0,0,0,0.72)",
            fontWeight: 800,
          }}
        >
          Close
        </button>
      </div>
    </div>

    <div className="comparePanelBody">
      <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.70)", marginBottom: 8 }}>Select a team</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Pill active={!compareTeam} onClick={() => setCompareTeam("")}>
          No comparison
        </Pill>
        {teamOptionsForLeague.filter((t) => t.id !== team).map((t) => (
          <Pill key={t.id} active={compareTeam === t.id} onClick={() => setCompareTeam(t.id)}>
            {t.label ?? t.name}
          </Pill>
        ))}
      </div>

      {!compareTeam ? (
        <div style={{ marginTop: 14, fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
          Pick a team to show a side-by-side breakdown (and it will also overlay the radar).
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>Head-to-head</div>
              <div style={{ fontSize: 11, color: "rgba(0,0,0,0.50)" }}>Diff =  {clubLabel} - {compareClubLabel}</div>
            </div>

            {/* Scalar KPIs */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", marginBottom: 6 }}>Age • Experience • Turnover</div>
              <table className="miniTable">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th style={{ textAlign: "right" }}>{clubLabel}</th>
                    <th style={{ textAlign: "right" }}>{compareClubLabel}</th>
                    <th style={{ textAlign: "right" }}>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {(comparisonTables?.scalars ?? []).map((r: any) => {
                    const fmt = r.fmt as (v: number) => string;
                    const a = r.a == null ? "—" : fmt(r.a);
                    const b = r.b == null ? "—" : fmt(r.b);
                    const d = r.diff == null ? "—" : `${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(1)}`;
                    return (
                      <tr key={r.metric}>
                        <td>{r.metric}</td>
                        <td style={{ textAlign: "right" }}>{a}</td>
                        <td style={{ textAlign: "right" }}>{b}</td>
                        <td
                          style={{
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            color: diffColor(r.diff),
                            fontWeight: 900,
                          }}
                        >
                          {d}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Age drivers */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", marginBottom: 6 }}>Age drivers % (ratings-weighted)</div>
              <table className="miniTable">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ textAlign: "right" }}>{clubLabel}</th>
                    <th style={{ textAlign: "right" }}>{compareClubLabel}</th>
                    <th style={{ textAlign: "right" }}>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {(comparisonTables?.ageDrivers ?? []).map((r: any) => (
                    <tr key={r.metric}>
                      <td>{r.metric}</td>
                      <td style={{ textAlign: "right" }}>{r.a.toFixed(1)}%</td>
                      <td style={{ textAlign: "right" }}>{r.b.toFixed(1)}%</td>
                      <td
                        style={{
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          color: diffColor(r.diff),
                          fontWeight: 900,
                        }}
                      >
                        {(r.diff >= 0 ? "+" : "") + r.diff.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* List acquisition */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", marginBottom: 6 }}>List acquisition %</div>
              <table className="miniTable">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style={{ textAlign: "right" }}>{clubLabel}</th>
                    <th style={{ textAlign: "right" }}>{compareClubLabel}</th>
                    <th style={{ textAlign: "right" }}>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {(comparisonTables?.acquisition ?? []).map((r: any) => (
                    <tr key={r.metric}>
                      <td>{r.metric}</td>
                      <td style={{ textAlign: "right" }}>{r.a.toFixed(1)}%</td>
                      <td style={{ textAlign: "right" }}>{r.b.toFixed(1)}%</td>
                      <td
                        style={{
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          color: diffColor(r.diff),
                          fontWeight: 900,
                        }}
                      >
                        {(r.diff >= 0 ? "+" : "") + r.diff.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Skill radar */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(0,0,0,0.55)", marginBottom: 6 }}>Team skill radar (0–100)</div>
              <table className="miniTable">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th style={{ textAlign: "right" }}>{clubLabel}</th>
                    <th style={{ textAlign: "right" }}>{compareClubLabel}</th>
                    <th style={{ textAlign: "right" }}>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {(comparisonTables?.radar ?? []).map((r: any) => (
                    <tr key={r.metric}>
                      <td>{r.metric}</td>
                      <td style={{ textAlign: "right" }}>{Number(r.a).toFixed(1)}</td>
                      <td style={{ textAlign: "right" }}>{Number(r.b).toFixed(1)}</td>
                      <td
                        style={{
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          color: diffColor(Number(r.diff)),
                          fontWeight: 900,
                        }}
                      >
                        {(r.diff >= 0 ? "+" : "") + Number(r.diff).toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  </div>
)} 

            </>
          ) : (
            <CareerProjectionDashboard defaultTeam={team} careerProjections={careerProjections} careerProjectionsLastUpdated={careerProjectionsLastUpdated} comparablePlayers={comparablePlayers} playerStatsAgg={playerStatsAgg} playerProjections={playerProjections} rosterPlayers={rosterPlayers} selectedSeason={season} initialPlayerId={currentPlayerId || undefined} onPlayerIdChange={(id) => {
                const nextId = normalizePlayerId(id);
                setCurrentPlayerId(nextId);

                // Immediately update teamId too (so the URL becomes /player/:id?team=...&season=... without a stale team).
                const row = rosterPlayers.find(
                  (r) =>
                    normalizePlayerId(r.providerId) === nextId &&
                    r.season === season
                );
                const resolvedTeamId = normalizeTeamId(row?.team_id);
                if (resolvedTeamId) {
                  if (resolvedTeamId !== team) setTeam(resolvedTeamId);
                  if (!playerTeamResolved) setPlayerTeamResolved(true);
                }
              }} />
          )}


        </div>
      </div>
    </div>
  );
}
