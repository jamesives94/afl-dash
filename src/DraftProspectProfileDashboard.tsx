import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RotateCcw } from "lucide-react";
import "./DraftProspectProfileDashboard.css";

type MetricDef = {
  key: string;
  label: string;
  group: string;
};

type PlayerSummary = {
  playerId: string;
  playerName: string;
  team: string;
  position?: string;
  age?: number | null;
  height?: number | null;
  birthYear?: number | null;
  latestSeason?: number | null;
  latestLeague?: string;
  latestLeagueCode?: string;
  latestRating?: number | null;
  best3Rating?: number | null;
  ballUse?: number | null;
  ballUsePerDisposal?: number | null;
  positionGroup?: string;
  positionRatingScaled?: number | null;
  roleTrait?: number | null;
  roleTraitScaled?: number | null;
  levelSignal?: number | null;
  levelSignalScaled?: number | null;
  ratingPerDisposal?: number | null;
  draftRankScore?: number | null;
  games?: number | null;
};

type GameRow = {
  playerId: string;
  playerName: string;
  team: string;
  season: number;
  matchId: string;
  date: string;
  league: string;
  leagueCode: string;
  level: string;
  levelCode: string;
  rating: number;
  ratingActual?: number | null;
  ratingPred?: number | null;
  source: string;
  gameStats?: Record<string, number | null | undefined>;
  gameNo: number;
};

type PlayerStats = {
  season: number;
  league: string;
  leagueCode: string;
  level: string;
  levelCode: string;
  metrics: Record<string, number>;
  percentiles: Record<string, number>;
};

type SecondTierPayload = {
  metricDefs: MetricDef[];
  players: PlayerSummary[];
  gamesByPlayer: Record<string, GameRow[]>;
  statsByPlayer: Record<string, PlayerStats>;
};

type ChampionGameRow = {
  playerId: string;
  season: number;
  matchId: string;
  matchDate: string;
  competition: string;
  team: string;
  opposition: string;
  position: string;
  rating?: number | null;
  ballUse?: number | null;
  ballWinning?: number | null;
  defence?: number | null;
  hitouts?: number | null;
  negative?: number | null;
};

type ChampionSeasonRow = {
  playerId: string;
  season: number;
  games: number;
  latestTeam: string;
  latestCompetition: string;
  latestPosition: string;
  rating?: number | null;
  ballUse?: number | null;
  ballWinning?: number | null;
  defence?: number | null;
  hitouts?: number | null;
  negative?: number | null;
};

type ChampionRatingsPayload = {
  generatedAt?: string;
  source?: string;
  games: ChampionGameRow[];
  seasonByPlayer: Record<string, ChampionSeasonRow>;
};

type StatCandidate = {
  metricKeys: string[];
  gameKeys: string[];
  label: string;
  group: string;
};

type RequestedMetricDef = {
  id: string;
  label: string;
  group: string;
  championKey?: keyof Pick<ChampionSeasonRow, "rating" | "ballUse" | "ballWinning" | "defence">;
  gameKey?: string;
  metricKeys?: string[];
};

type SelectedStat = {
  id: string;
  label: string;
  group: string;
  metricKeys: string[];
  gameKeys: string[];
  metricKey: string;
  percentile: number;
  value: number;
};

type CohortRow = {
  rank: number;
  playerId: string;
  name: string;
  club: string;
  academyClub: string | null;
  position: string;
  positionGroup: string;
  age: number | null;
  games: number;
  rating: number;
  best3Rating: number | null;
  ratingPerDisposal: number | null;
  positionRatingPercentile: number | null;
  roleTraitScore: number | null;
  levelSignal: number | null;
  levelSignalScore: number | null;
  roleMetrics: Record<string, number | null>;
  draftRankScore: number | null;
  best3RatingPercentile: number | null;
  ratingPercentile: number | null;
  ratingPerDisposalPercentile: number | null;
  ballUse: number | null;
  ballUsePerDisposal: number | null;
  ballUsePercentile: number | null;
  ballUsePerDisposalPercentile: number | null;
  hasSeniorSecondTierGames: boolean;
  hasWomensGames: boolean;
};

type CohortRowInput = Omit<CohortRow, "rank">;
type RatingBasis = "AGE_ADJUSTED" | "RAW";
type GenderFilter = typeof ALL_FILTER | "MEN" | "WOMEN";

type AgeAdjustmentContext = {
  adjustments: Map<string, number>;
};

const DATA_FILE = "second_tier_ratings_payload.json";
const MENS_U18_DATA_FILE = "second_tier_ratings_payload_mens_u18.json";
const SECOND_TIER_SENIOR_DATA_FILE = "second_tier_ratings_payload_second_tier_senior.json";
const WOMENS_DATA_FILE = "second_tier_ratings_payload_womens.json";
const CHAMPION_RATINGS_FILE = "tier2_champion_ratings_2026.json";
const DATA_API_KEY = (import.meta as any).env?.VITE_DATA_API_KEY as string | undefined;
const USE_LOCAL_DATA = String((import.meta as any).env?.VITE_USE_LOCAL_DATA ?? "").toLowerCase() === "true";
const LOCAL_DATA_BASE = String((import.meta as any).env?.VITE_LOCAL_DATA_BASE ?? "/local-data").replace(/\/+$/, "") || "/local-data";

async function parseJsonResponse(response: Response, file: string) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(
      `Expected JSON for ${file}, got ${contentType || "unknown content type"}: ${text.slice(0, 120)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${file}: ${message}`);
  }
}

async function fetchJsonFile(file: string, required = true) {
  if (USE_LOCAL_DATA) {
    const response = await fetch(`${LOCAL_DATA_BASE}/${file}`, { cache: "no-store" });
    if (!response.ok) {
      if (!required) return null;
      throw new Error(`Failed to load ${file} from local snapshots (${response.status})`);
    }
    return await parseJsonResponse(response, file);
  }

  const headers: Record<string, string> = {};
  if (DATA_API_KEY) headers["x-data-key"] = DATA_API_KEY;
  const response = await fetch(`/api/data?file=${encodeURIComponent(file)}`, { headers, cache: "no-store" });
  if (!response.ok) {
    if (!required && (response.status === 400 || response.status === 404)) return null;
    const text = await response.text().catch(() => "");
    if (!required) return null;
    throw new Error(
      text
        ? `Failed to load ${file} via API (${response.status}): ${text}`
        : `Failed to load ${file} via API (${response.status})`
    );
  }
  return await parseJsonResponse(response, file);
}

function payloadFileForLeagueScope(scope: string, gender: GenderFilter = "MEN") {
  if (gender === "WOMEN") return WOMENS_DATA_FILE;
  if (gender === "MEN") {
    if (scope === DEFAULT_LEAGUE_SCOPE) return MENS_U18_DATA_FILE;
    if (scope === SECOND_TIER_SENIOR_SCOPE || scope === "VFL" || scope === "SANFL" || scope === "WAFL") {
      return SECOND_TIER_SENIOR_DATA_FILE;
    }
  }
  return DATA_FILE;
}
const ALL_FILTER = "__ALL__";
const DEFAULT_GENDER_FILTER: GenderFilter = "MEN";
const DEFAULT_LEAGUE_SCOPE = "MENS_U18";
const DEFAULT_RATING_BASIS: RatingBasis = "AGE_ADJUSTED";
const SECOND_TIER_SENIOR_SCOPE = "SECOND_TIER_SENIOR";
const MIN_GAMES_FOR_PERCENTILES = 6;
const MAX_RADAR_STATS = 9;
const BEST_GAME_SAMPLE_SIZE = 3;
const AGE_ADJUSTMENT_TOP_AGE_STAGE = 0;
const AGE_ADJUSTMENT_MIN_BUCKET_GAMES = 8;
const AGE_ADJUSTMENT_MAX_POINTS = 6;
const PROSPECT_GLOBAL_RATING_WEIGHT = 0.25;
const PROSPECT_POSITION_RATING_WEIGHT = 0.20;
const PROSPECT_BALL_USE_PER_DISPOSAL_WEIGHT = 0.15;
const PROSPECT_BEST3_WEIGHT = 0.20;
const PROSPECT_ROLE_TRAIT_WEIGHT = 0.10;
const PROSPECT_LEVEL_SIGNAL_WEIGHT = 0.10;
const SENIOR_STATE_RATING_WEIGHT = 0.80;
const SENIOR_STATE_BALL_USE_WEIGHT = 0.20;
const TRIAL_LEAGUE_CODES = new Set(["TRIAL", "TRIALW"]);
const WOMENS_LEAGUE_CODES = new Set(["AFLW", "AFLWPRE", "VFLW", "WAFLW", "SANFLW", "TLG", "U18WC", "U16WC", "TRIALW"]);
const WOMENS_U18_LEAGUE_CODES = new Set(["TLG", "U18WC"]);
const MENS_U18_LEAGUE_CODES = new Set(["TLB", "U18C", "AFLAISA", "CD"]);
const UNDER_16_CHAMPIONSHIP_LEAGUE_CODES = new Set(["U16C", "U16WC"]);

const LEAGUE_SCOPE_OPTIONS = [
  { value: DEFAULT_LEAGUE_SCOPE, label: "Under 18" },
  { value: SECOND_TIER_SENIOR_SCOPE, label: "2nd Tier" },
  { value: "VFL", label: "VFL" },
  { value: "SANFL", label: "SANFL" },
  { value: "WAFL", label: "WAFL" },
  { value: ALL_FILTER, label: "All Leagues" },
];

const GENDER_FILTER_OPTIONS: Array<{ value: GenderFilter; label: string }> = [
  { value: DEFAULT_GENDER_FILTER, label: "Men" },
  { value: "WOMEN", label: "Women" },
  { value: ALL_FILTER, label: "All" },
];

const LEAGUE_SCOPE_CODE_SETS: Record<string, Set<string>> = {
  SANFL: new Set(["SANFL"]),
  VFL: new Set(["VFL"]),
  WAFL: new Set(["WAFL"]),
};
const SECOND_TIER_SENIOR_LEAGUE_CODES = new Set(["VFL", "SANFL", "WAFL"]);
const WOMENS_LEAGUE_SCOPE_CODE_SETS: Record<string, Set<string>> = {
  SANFL: new Set(["SANFLW"]),
  VFL: new Set(["VFLW"]),
  WAFL: new Set(["WAFLW"]),
};
const WOMENS_SECOND_TIER_SENIOR_LEAGUE_CODES = new Set(["VFLW", "SANFLW", "WAFLW"]);

const MIN_GAME_OPTIONS = [
  { value: ALL_FILTER, label: "All" },
  { value: "1", label: "1+" },
  { value: "3", label: "3+" },
  { value: "5", label: "5+" },
  { value: "10", label: "10+" },
  { value: "15", label: "15+" },
];

const SEASON_BAND_COLORS = ["#2563eb", "#f97316", "#16a34a", "#7c3aed", "#0891b2", "#db2777"];
const DEFAULT_LEAGUE_RATING_WEIGHT = 1;
const LEAGUE_POINT_COLORS: Record<string, string> = {
  AFLAISA: "#111827",
  AFLPRE: "#2563eb",
  CD: "#0f766e",
  SANFL: "#ea580c",
  SANFLR: "#f59e0b",
  SANFLU18: "#fb923c",
  TLB: "#2563eb",
  TLG: "#db2777",
  U16C: "#f97316",
  U16WC: "#ec4899",
  U18C: "#7c3aed",
  U18WC: "#a855f7",
  VFL: "#16a34a",
  WAFL: "#0ea5e9",
  WAFLU19: "#0284c7",
};

const POSITION_GROUP_LABELS: Record<string, string> = {
  MID: "Midfielders",
  WING: "Wings",
  MID_FWD: "Mid/Fwds",
  FWD_SMALL: "General Fwds",
  FWD_KEY: "Key Fwds",
  DEF_KEY: "Key Defs",
  DEF_GEN: "General Defs",
  RUCK: "Rucks",
  GENERAL: "General",
};

const REQUESTED_PROFILE_METRICS: RequestedMetricDef[] = [
  { id: "rating", label: "Rating", group: "Impact", championKey: "rating" },
  { id: "ballUsePerDisposal", label: "Ball Use / Disposal", group: "Ball Use" },
  { id: "ballWinning", label: "Ball Winning", group: "Ball Winning", championKey: "ballWinning" },
  { id: "defence", label: "Defence", group: "Defence", championKey: "defence" },
  { id: "metersGained", label: "Meters Gained", group: "Ball Use", gameKey: "metresGained", metricKeys: ["MetresGained", "NetMetresGained"] },
  { id: "pressureActs", label: "Pressure Acts", group: "Defence", metricKeys: ["PressureActs"] },
  { id: "scoreInvolvements", label: "Score Inv.", group: "Scoring", gameKey: "scoreInvolvements", metricKeys: ["ScoreInvolvements", "SCORE_INVOLVEMENT_GOAL"] },
  { id: "intercepts", label: "Intercepts", group: "Defence", gameKey: "intercepts", metricKeys: ["Intercepts"] },
  { id: "contestedMarks", label: "Contested Marks", group: "Aerial", metricKeys: ["ContestedMarks", "POSSESSION_CONTESTED_GP_AIR"] },
];

const WOMENS_PROFILE_METRICS: RequestedMetricDef[] = [
  { id: "rating", label: "Rating", group: "Impact", metricKeys: ["EquityRating"] },
  {
    id: "retainedDisposals",
    label: "Retained Disp.",
    group: "Ball Use",
    gameKey: "retainedDisposals",
    metricKeys: ["RetainedDisposals", "Retained_Disposals", "DisposalsRetained"],
  },
  { id: "groundBalls", label: "Ground Balls", group: "Ball Winning", gameKey: "groundBalls", metricKeys: ["GroundBallGets"] },
  { id: "intercepts", label: "Intercepts", group: "Defence", gameKey: "intercepts", metricKeys: ["Intercepts"] },
  { id: "marks", label: "Marks", group: "Aerial", gameKey: "marks", metricKeys: ["Marks"] },
  {
    id: "scoreInvolvements",
    label: "Score Inv.",
    group: "Scoring",
    gameKey: "scoreInvolvements",
    metricKeys: ["ScoreInvolvements", "SCORE_INVOLVEMENT_GOAL"],
  },
  { id: "metersGained", label: "Meters Gained", group: "Ball Use", gameKey: "metresGained", metricKeys: ["MetresGained", "NetMetresGained"] },
  { id: "inside50s", label: "Inside 50s", group: "Ball Use", gameKey: "inside50s", metricKeys: ["Inside50s", "KicksIntoF50"] },
  { id: "rebound50s", label: "Rebound 50s", group: "Ball Use", gameKey: "rebound50s", metricKeys: ["Rebound50s"] },
];

const POSITION_STAT_REGISTRY: Record<string, StatCandidate[]> = {
  MID: [
    { metricKeys: ["EquityRating"], gameKeys: [], label: "Equity Rating", group: "Impact" },
    { metricKeys: ["ContestedPossessions"], gameKeys: ["contestedPossessions", "groundBalls"], label: "Contest", group: "Ball Winning" },
    { metricKeys: ["TotalClearances", "CentreClearances"], gameKeys: ["clearances"], label: "Clearance", group: "Ball Winning" },
    { metricKeys: ["Disposals"], gameKeys: ["disposals"], label: "Disposals", group: "Ball Use" },
    { metricKeys: ["MetresGained", "NetMetresGained"], gameKeys: ["metresGained"], label: "Meters Gained", group: "Ball Use" },
    { metricKeys: ["ScoreInvolvements"], gameKeys: ["scoreInvolvements"], label: "Score Inv.", group: "Scoring" },
    { metricKeys: ["GroundBallGets"], gameKeys: ["groundBalls"], label: "Ground Ball", group: "Ball Winning" },
    { metricKeys: ["Tackles", "PressureActs"], gameKeys: [], label: "Pressure", group: "Defence" },
  ],
  WING: [
    { metricKeys: ["EquityRating"], gameKeys: [], label: "Equity Rating", group: "Impact" },
    { metricKeys: ["MetresGained", "NetMetresGained"], gameKeys: ["metresGained"], label: "Meters Gained", group: "Ball Use" },
    { metricKeys: ["Disposals"], gameKeys: ["disposals"], label: "Disposals", group: "Ball Use" },
    { metricKeys: ["KicksIntoF50", "Inside50s"], gameKeys: ["inside50s"], label: "Forward Entry", group: "Ball Use" },
    { metricKeys: ["Marks"], gameKeys: ["marks"], label: "Marks", group: "Aerial" },
    { metricKeys: ["ScoreInvolvements"], gameKeys: ["scoreInvolvements"], label: "Score Inv.", group: "Scoring" },
    { metricKeys: ["GroundBallGets"], gameKeys: ["groundBalls"], label: "Ground Ball", group: "Ball Winning" },
  ],
  MID_FWD: [
    { metricKeys: ["EquityRating"], gameKeys: [], label: "Equity Rating", group: "Impact" },
    { metricKeys: ["ScoreInvolvements"], gameKeys: ["scoreInvolvements"], label: "Score Inv.", group: "Scoring" },
    { metricKeys: ["Goals_Avg", "ShotsAtGoal"], gameKeys: ["goals"], label: "Goals", group: "Scoring" },
    { metricKeys: ["Disposals"], gameKeys: ["disposals"], label: "Disposals", group: "Ball Use" },
    { metricKeys: ["ContestedPossessions"], gameKeys: ["groundBalls"], label: "Contest", group: "Ball Winning" },
    { metricKeys: ["KicksIntoF50", "Inside50s"], gameKeys: ["inside50s"], label: "Forward Entry", group: "Ball Use" },
    { metricKeys: ["Tackles", "PressureActs"], gameKeys: [], label: "Pressure", group: "Defence" },
  ],
  FWD_SMALL: [
    { metricKeys: ["EquityRating"], gameKeys: [], label: "Equity Rating", group: "Impact" },
    { metricKeys: ["ScoreInvolvements"], gameKeys: ["scoreInvolvements"], label: "Score Inv.", group: "Scoring" },
    { metricKeys: ["Goals_Avg", "ShotsAtGoal"], gameKeys: ["goals"], label: "Goals", group: "Scoring" },
    { metricKeys: ["SCORE_INVOLVEMENT_GOAL"], gameKeys: ["scoreInvolvements"], label: "Goal Chains", group: "Scoring" },
    { metricKeys: ["KicksIntoF50", "Inside50s"], gameKeys: ["inside50s"], label: "Forward Entry", group: "Ball Use" },
    { metricKeys: ["GroundBallGets"], gameKeys: ["groundBalls"], label: "Ground Ball", group: "Ball Winning" },
    { metricKeys: ["Tackles", "PressureActs"], gameKeys: [], label: "Pressure", group: "Defence" },
    { metricKeys: ["Disposals"], gameKeys: ["disposals"], label: "Disposals", group: "Ball Use" },
  ],
  FWD_KEY: [
    { metricKeys: ["EquityRating"], gameKeys: [], label: "Equity Rating", group: "Impact" },
    { metricKeys: ["Goals_Avg", "ShotsAtGoal"], gameKeys: ["goals"], label: "Goals", group: "Scoring" },
    { metricKeys: ["ScoreInvolvements"], gameKeys: ["scoreInvolvements"], label: "Score Inv.", group: "Scoring" },
    { metricKeys: ["ContestedMarks", "POSSESSION_CONTESTED_GP_AIR"], gameKeys: ["marks"], label: "Aerial Contest", group: "Aerial" },
    { metricKeys: ["Marks"], gameKeys: ["marks"], label: "Marks", group: "Aerial" },
    { metricKeys: ["KicksIntoF50", "Inside50s"], gameKeys: ["inside50s"], label: "Forward Entry", group: "Ball Use" },
    { metricKeys: ["GroundBallGets"], gameKeys: ["groundBalls"], label: "Ground Ball", group: "Ball Winning" },
  ],
  DEF_KEY: [
    { metricKeys: ["EquityRating"], gameKeys: [], label: "Equity Rating", group: "Impact" },
    { metricKeys: ["Intercepts"], gameKeys: ["intercepts"], label: "Intercepts", group: "Defence" },
    { metricKeys: ["Spoils"], gameKeys: [], label: "Spoils", group: "Defence" },
    { metricKeys: ["ContestedMarks", "POSSESSION_CONTESTED_GP_AIR"], gameKeys: ["marks"], label: "Aerial Contest", group: "Aerial" },
    { metricKeys: ["InterceptMarks", "INTERCEPT_MARK_UNCONTESTED"], gameKeys: ["intercepts"], label: "Intercept Marks", group: "Aerial" },
    { metricKeys: ["Disposals"], gameKeys: ["disposals"], label: "Disposals", group: "Ball Use" },
    { metricKeys: ["MetresGained", "NetMetresGained"], gameKeys: ["metresGained"], label: "Meters Gained", group: "Ball Use" },
  ],
  DEF_GEN: [
    { metricKeys: ["EquityRating"], gameKeys: [], label: "Equity Rating", group: "Impact" },
    { metricKeys: ["Intercepts"], gameKeys: ["intercepts"], label: "Intercepts", group: "Defence" },
    { metricKeys: ["Disposals"], gameKeys: ["disposals"], label: "Disposals", group: "Ball Use" },
    { metricKeys: ["MetresGained", "NetMetresGained"], gameKeys: ["metresGained"], label: "Meters Gained", group: "Ball Use" },
    { metricKeys: ["Marks"], gameKeys: ["marks"], label: "Marks", group: "Aerial" },
    { metricKeys: ["GroundBallGets"], gameKeys: ["groundBalls"], label: "Ground Ball", group: "Ball Winning" },
    { metricKeys: ["Spoils"], gameKeys: [], label: "Spoils", group: "Defence" },
  ],
  RUCK: [
    { metricKeys: ["EquityRating"], gameKeys: [], label: "Equity Rating", group: "Impact" },
    { metricKeys: ["HitoutsToAdvantage", "Hitouts"], gameKeys: ["hitouts"], label: "Ruck Craft", group: "Ruck" },
    { metricKeys: ["TotalClearances", "CentreClearances"], gameKeys: ["clearances"], label: "Clearance", group: "Ball Winning" },
    { metricKeys: ["ContestedPossessions"], gameKeys: ["groundBalls"], label: "Contest", group: "Ball Winning" },
    { metricKeys: ["ContestedMarks", "POSSESSION_CONTESTED_GP_AIR"], gameKeys: ["marks"], label: "Aerial Contest", group: "Aerial" },
    { metricKeys: ["ScoreInvolvements"], gameKeys: ["scoreInvolvements"], label: "Score Inv.", group: "Scoring" },
    { metricKeys: ["GroundBallGets"], gameKeys: ["groundBalls"], label: "Ground Ball", group: "Ball Winning" },
  ],
  GENERAL: [
    { metricKeys: ["EquityRating"], gameKeys: [], label: "Equity Rating", group: "Impact" },
    { metricKeys: ["Disposals"], gameKeys: ["disposals"], label: "Disposals", group: "Ball Use" },
    { metricKeys: ["MetresGained", "NetMetresGained"], gameKeys: ["metresGained"], label: "Meters Gained", group: "Ball Use" },
    { metricKeys: ["ContestedPossessions"], gameKeys: ["groundBalls"], label: "Contest", group: "Ball Winning" },
    { metricKeys: ["ScoreInvolvements"], gameKeys: ["scoreInvolvements"], label: "Score Inv.", group: "Scoring" },
    { metricKeys: ["Marks"], gameKeys: ["marks"], label: "Marks", group: "Aerial" },
    { metricKeys: ["Intercepts"], gameKeys: ["intercepts"], label: "Intercepts", group: "Defence" },
  ],
};

function toNumber(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProspectPlayerId(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const cdMatch = raw.match(/CD[_-]?I?(\d+)/i);
  if (cdMatch?.[1]) return cdMatch[1];
  const trailingDigits = raw.match(/(\d+)$/);
  return trailingDigits?.[1] ?? raw;
}

function formatNumber(value: number | null | undefined, digits = 1) {
  const n = toNumber(value);
  if (n == null) return "-";
  return n.toFixed(digits);
}

function ordinal(value: number | null | undefined) {
  const n = Math.round(toNumber(value) ?? 0);
  if (!n) return "-";
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function percentileColor(value: number) {
  if (value >= 80) return "#35a853";
  if (value >= 60) return "#8fbe70";
  if (value >= 45) return "#e5d574";
  if (value >= 30) return "#f2ae72";
  return "#dc6b68";
}

function ratingPercentileStyle(value: number | null | undefined) {
  const percentile = toNumber(value);
  if (percentile == null) return undefined;
  const clamped = Math.max(0, Math.min(100, percentile));
  const hue = clamped <= 50 ? (clamped / 50) * 38 : 38 + ((clamped - 50) / 50) * 102;
  return {
    backgroundColor: `hsl(${hue} 82% 95%)`,
    color: `hsl(${hue} 72% 32%)`,
  };
}

function normalizePositionGroup(position: string | null | undefined) {
  const normalized = String(position ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return "GENERAL";
  if (normalized.includes("ruck")) return "RUCK";
  if (normalized.includes("wing")) return "WING";
  if (normalized.includes("mid") && normalized.includes("fwd")) return "MID_FWD";
  if (normalized.includes("mid")) return "MID";
  if (normalized.includes("key") && normalized.includes("def")) return "DEF_KEY";
  if (normalized.includes("key") && normalized.includes("fwd")) return "FWD_KEY";
  if (normalized.includes("def")) return "DEF_GEN";
  if (normalized.includes("fwd") || normalized.includes("forward")) return "FWD_SMALL";
  return "GENERAL";
}

function isTrialGame(game: GameRow) {
  return TRIAL_LEAGUE_CODES.has(String(game.leagueCode ?? "").toUpperCase()) || String(game.levelCode ?? "").toUpperCase() === "TRIAL";
}

function isWomensGame(game: GameRow) {
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const leagueText = `${game.league ?? ""} ${game.level ?? ""}`.toLowerCase();
  return WOMENS_LEAGUE_CODES.has(leagueCode) || leagueText.includes("womens") || leagueText.includes("women") || leagueText.includes("girls");
}

function isMensUnder18Game(game: GameRow) {
  if (isWomensGame(game)) return false;
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const levelText = String(game.level ?? "").toLowerCase();
  return MENS_U18_LEAGUE_CODES.has(leagueCode) || levelText.includes("under-18") || levelText.includes("under-19");
}

function isWomensUnder18Game(game: GameRow) {
  if (!isWomensGame(game)) return false;
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const levelText = String(game.level ?? "").toLowerCase();
  return WOMENS_U18_LEAGUE_CODES.has(leagueCode) || levelText.includes("under-18") || levelText.includes("under-19");
}

function isMensSeniorSecondTierGame(game: GameRow) {
  if (isWomensGame(game)) return false;
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const levelCode = String(game.levelCode ?? "").toUpperCase();
  const levelText = String(game.level ?? "").toLowerCase();
  return SECOND_TIER_SENIOR_LEAGUE_CODES.has(leagueCode) && (levelCode === "SEN" || levelText === "seniors");
}

function isWomensSeniorSecondTierGame(game: GameRow) {
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const levelCode = String(game.levelCode ?? "").toUpperCase();
  const levelText = String(game.level ?? "").toLowerCase();
  return WOMENS_SECOND_TIER_SENIOR_LEAGUE_CODES.has(leagueCode) && (levelCode === "SEN" || levelText === "seniors");
}

function isSeniorSecondTierGame(game: GameRow) {
  return isMensSeniorSecondTierGame(game) || isWomensSeniorSecondTierGame(game);
}

function isUnder16NonChampionshipGame(game: GameRow) {
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const levelCode = String(game.levelCode ?? "").toUpperCase();
  const levelText = String(game.level ?? "").toLowerCase();
  const teamText = String(game.team ?? "").toLowerCase();
  const leagueText = String(game.league ?? "").toLowerCase();
  const isUnder16 =
    levelCode === "U16" ||
    levelText.includes("under-16") ||
    levelText.includes("under 16") ||
    teamText.includes("(u16)");
  const isChampionship =
    UNDER_16_CHAMPIONSHIP_LEAGUE_CODES.has(leagueCode) ||
    leagueText.includes("under 16 championship") ||
    leagueText.includes("under-16 championship");
  return isUnder16 && !isChampionship;
}

function isRatedDraftProfileGame(game: GameRow) {
  return !isTrialGame(game) && !isUnder16NonChampionshipGame(game) && validRating(game) != null;
}

function genderMatchesGame(game: GameRow, selectedGender: GenderFilter) {
  if (selectedGender === ALL_FILTER) return true;
  const womensGame = isWomensGame(game);
  return selectedGender === "WOMEN" ? womensGame : !womensGame;
}

function under18ScopeMatchesGame(game: GameRow, selectedGender: GenderFilter) {
  if (selectedGender === "WOMEN") return isWomensUnder18Game(game);
  if (selectedGender === "MEN") return isMensUnder18Game(game);
  return isMensUnder18Game(game) || isWomensUnder18Game(game);
}

function seniorSecondTierScopeMatchesGame(game: GameRow, selectedGender: GenderFilter) {
  if (selectedGender === "WOMEN") return isWomensSeniorSecondTierGame(game);
  if (selectedGender === "MEN") return isMensSeniorSecondTierGame(game);
  return isSeniorSecondTierGame(game);
}

function namedSeniorLeagueScopeMatchesGame(game: GameRow, selectedLeagueScope: string, selectedGender: GenderFilter) {
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const mensLeagueCodes = LEAGUE_SCOPE_CODE_SETS[selectedLeagueScope];
  const womensLeagueCodes = WOMENS_LEAGUE_SCOPE_CODE_SETS[selectedLeagueScope];
  const mensMatch = Boolean(mensLeagueCodes?.has(leagueCode) && isMensSeniorSecondTierGame(game));
  const womensMatch = Boolean(womensLeagueCodes?.has(leagueCode) && isWomensSeniorSecondTierGame(game));
  if (selectedGender === "WOMEN") return womensMatch;
  if (selectedGender === "MEN") return mensMatch;
  return mensMatch || womensMatch;
}

function leagueScopeMatchesGame(game: GameRow, selectedLeagueScope: string, selectedGender: GenderFilter) {
  if (!genderMatchesGame(game, selectedGender)) return false;
  if (selectedLeagueScope === ALL_FILTER) return true;
  if (selectedLeagueScope === DEFAULT_LEAGUE_SCOPE) return under18ScopeMatchesGame(game, selectedGender);
  if (selectedLeagueScope === SECOND_TIER_SENIOR_SCOPE) return seniorSecondTierScopeMatchesGame(game, selectedGender);
  if (LEAGUE_SCOPE_CODE_SETS[selectedLeagueScope] || WOMENS_LEAGUE_SCOPE_CODE_SETS[selectedLeagueScope]) {
    return namedSeniorLeagueScopeMatchesGame(game, selectedLeagueScope, selectedGender);
  }
  return under18ScopeMatchesGame(game, selectedGender);
}

function seasonMatchesGame(game: GameRow, selectedSeason: string) {
  return selectedSeason === ALL_FILTER || String(game.season) === selectedSeason;
}

function teamMatchesGame(game: GameRow, selectedTeam: string) {
  return selectedTeam === ALL_FILTER || game.team === selectedTeam;
}

function filteredGamesForPlayer(
  payload: SecondTierPayload,
  player: PlayerSummary,
  selectedSeason: string,
  selectedLeagueScope: string,
  selectedGender: GenderFilter,
  selectedTeam: string
) {
  return (payload.gamesByPlayer[player.playerId] ?? []).filter((game) => {
    return (
      isRatedDraftProfileGame(game) &&
      seasonMatchesGame(game, selectedSeason) &&
      teamMatchesGame(game, selectedTeam) &&
      leagueScopeMatchesGame(game, selectedLeagueScope, selectedGender)
    );
  });
}

function allLoadedGamesForPlayer(payload: SecondTierPayload, player: PlayerSummary) {
  return (payload.gamesByPlayer[player.playerId] ?? []).filter(isRatedDraftProfileGame);
}

function leaguePointColor(leagueCode: string | undefined) {
  const normalized = String(leagueCode ?? "").toUpperCase();
  if (LEAGUE_POINT_COLORS[normalized]) return LEAGUE_POINT_COLORS[normalized];
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) % SEASON_BAND_COLORS.length;
  }
  return SEASON_BAND_COLORS[Math.abs(hash) % SEASON_BAND_COLORS.length];
}

function positionMatchesPlayer(player: PlayerSummary, selectedPositionGroup: string) {
  return selectedPositionGroup === ALL_FILTER || normalizePositionGroup(player.position) === selectedPositionGroup;
}

function positionGroupLabel(positionGroup: string) {
  return POSITION_GROUP_LABELS[positionGroup] ?? positionGroup;
}

function validRating(game: GameRow) {
  return toNumber(game.ratingPred) ?? toNumber(game.ratingActual) ?? toNumber(game.rating);
}

function timeOnGroundShare(game: GameRow) {
  const stats = game.gameStats ?? {};
  const share = toNumber(stats.timeOnGroundShare);
  if (share != null && share > 0) return share;

  const pct = toNumber(stats.timeOnGroundPct);
  if (pct != null && pct > 0) return pct > 1 ? pct / 100 : pct;

  const rawTog = toNumber(stats.timeOnGround);
  if (rawTog != null && rawTog > 0 && rawTog <= 1.25) return rawTog;
  return null;
}

function perFullTog(value: number | null | undefined, game: GameRow) {
  const number = toNumber(value);
  if (number == null) return null;
  const share = timeOnGroundShare(game);
  if (share == null || share <= 0) return number;
  return number / share;
}

function leagueRatingWeight(game: Pick<GameRow, "team" | "leagueCode" | "league" | "level" | "levelCode">) {
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const levelCode = String(game.levelCode ?? "").toUpperCase();
  const teamText = String(game.team ?? "").toLowerCase();
  const levelText = String(game.level ?? "").toLowerCase();
  const leagueText = String(game.league ?? "").toLowerCase();

  if ((leagueCode === "WAFL" || leagueCode === "WAFLW") && (levelCode === "U19" || levelText.includes("under-19"))) return 0.7;
  if ((leagueCode === "SANFL" || leagueCode === "SANFLW") && (levelCode === "U18" || levelText.includes("under-18"))) return 0.75;
  if (leagueCode === "VFL" || leagueCode === "WAFL" || leagueCode === "SANFL") return 1.3;
  if (leagueCode === "AFLAISA" || teamText === "australia" || teamText.startsWith("australia ")) return 1.2;
  if (leagueCode === "TLB" || leagueCode === "TLG" || leagueText.includes("talent league")) return 0.9;
  if (leagueCode === "U18C" || leagueCode === "U18WC" || leagueCode === "CD" || leagueText.includes("under 18 championship")) {
    return 1.1;
  }
  return DEFAULT_LEAGUE_RATING_WEIGHT;
}

function weightedRating(game: GameRow, championGame?: ChampionGameRow) {
  const rating = toNumber(championGame?.rating) ?? validRating(game);
  if (rating == null) return null;
  return Number(perFullTog(rating, game)) * leagueRatingWeight(game);
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function ageStageForGame(player: PlayerSummary, game: GameRow) {
  const draftYear = inferDraftYear(player);
  const season = toNumber(game.season);
  if (draftYear == null || season == null) return null;
  return Math.round(draftYear - season);
}

function ageAdjustmentBucketKey(positionGroup: string, leagueCode: string, stage: number) {
  return `${positionGroup}|${leagueCode}|${stage}`;
}

function addAgeAdjustmentBucket(
  buckets: Map<string, Map<number, number[]>>,
  positionGroup: string,
  leagueCode: string,
  stage: number,
  rating: number
) {
  const groups = [`${positionGroup}|${leagueCode}`, `${positionGroup}|ALL`, `ALL|${leagueCode}`, "ALL|ALL"];
  groups.forEach((group) => {
    const valuesByStage = buckets.get(group) ?? new Map<number, number[]>();
    const values = valuesByStage.get(stage) ?? [];
    values.push(rating);
    valuesByStage.set(stage, values);
    buckets.set(group, valuesByStage);
  });
}

function capAgeAdjustment(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(AGE_ADJUSTMENT_MAX_POINTS, value));
}

function buildAgeAdjustmentContext(
  players: PlayerSummary[],
  payload: SecondTierPayload,
  selectedSeason: string,
  selectedLeagueScope: string,
  selectedGender: GenderFilter,
  championGamesByKey: Map<string, ChampionGameRow>
): AgeAdjustmentContext {
  const buckets = new Map<string, Map<number, number[]>>();

  players.forEach((player) => {
    filteredGamesForPlayer(payload, player, selectedSeason, selectedLeagueScope, selectedGender, ALL_FILTER).forEach((game) => {
      const stage = ageStageForGame(player, game);
      if (stage == null || stage < AGE_ADJUSTMENT_TOP_AGE_STAGE || stage > 3) return;
      const rating = weightedRating(game, getChampionGame(game, championGamesByKey));
      if (rating == null || !Number.isFinite(rating)) return;
      addAgeAdjustmentBucket(
        buckets,
        normalizePositionGroup(player.position),
        String(game.leagueCode ?? "ALL").toUpperCase(),
        stage,
        rating
      );
    });
  });

  const adjustments = new Map<string, number>();
  buckets.forEach((valuesByStage, group) => {
    const topAgeValues = valuesByStage.get(AGE_ADJUSTMENT_TOP_AGE_STAGE) ?? [];
    if (topAgeValues.length < AGE_ADJUSTMENT_MIN_BUCKET_GAMES) return;
    const topAgeAverage = average(topAgeValues);
    if (topAgeAverage == null) return;
    valuesByStage.forEach((values, stage) => {
      if (stage <= AGE_ADJUSTMENT_TOP_AGE_STAGE || values.length < AGE_ADJUSTMENT_MIN_BUCKET_GAMES) return;
      const stageAverage = average(values);
      const adjustment = capAgeAdjustment(stageAverage == null ? null : topAgeAverage - stageAverage);
      if (adjustment != null && adjustment > 0) adjustments.set(`${group}|${stage}`, adjustment);
    });
  });

  return { adjustments };
}

function ageAdjustmentForGame(player: PlayerSummary, game: GameRow, context?: AgeAdjustmentContext | null) {
  if (!context) return 0;
  const stage = ageStageForGame(player, game);
  if (stage == null || stage <= AGE_ADJUSTMENT_TOP_AGE_STAGE || stage > 3) return 0;
  const positionGroup = normalizePositionGroup(player.position);
  const leagueCode = String(game.leagueCode ?? "ALL").toUpperCase();
  const lookupKeys = [
    ageAdjustmentBucketKey(positionGroup, leagueCode, stage),
    ageAdjustmentBucketKey(positionGroup, "ALL", stage),
    ageAdjustmentBucketKey("ALL", leagueCode, stage),
    ageAdjustmentBucketKey("ALL", "ALL", stage),
  ];
  for (const key of lookupKeys) {
    const adjustment = context.adjustments.get(key);
    if (adjustment != null) return adjustment;
  }
  return 0;
}

function ratingForBasis(
  game: GameRow,
  player?: PlayerSummary | null,
  championGame?: ChampionGameRow,
  ageAdjustmentContext?: AgeAdjustmentContext | null,
  ratingBasis: RatingBasis = "RAW"
) {
  const rating = weightedRating(game, championGame);
  if (rating == null || ratingBasis === "RAW" || !player) return rating;
  return rating + ageAdjustmentForGame(player, game, ageAdjustmentContext);
}

function resolveProfileSeason(player: PlayerSummary | null | undefined, selectedSeason: string) {
  if (selectedSeason !== ALL_FILTER) return Number(selectedSeason);
  return toNumber(player?.latestSeason);
}

function championGameKey(playerId: string, matchId: string | number | null | undefined) {
  return `${playerId}_${String(matchId ?? "")}`;
}

function getChampionGame(game: GameRow, championGamesByKey: Map<string, ChampionGameRow>) {
  return championGamesByKey.get(championGameKey(game.playerId, game.matchId));
}

function championGamesForPlayer(championPayload: ChampionRatingsPayload | null, player: PlayerSummary, selectedSeason: string) {
  const season = resolveProfileSeason(player, selectedSeason);
  if (season == null) return [];
  return (championPayload?.games ?? []).filter((game) => {
    return String(game.playerId) === String(player.playerId) && Number(game.season) === season;
  });
}

function seasonGamesForPlayer(payload: SecondTierPayload, player: PlayerSummary, selectedSeason: string) {
  const season = resolveProfileSeason(player, selectedSeason);
  return (payload.gamesByPlayer[player.playerId] ?? []).filter((game) => {
    if (season == null || Number(game.season) !== season) return false;
    return isRatedDraftProfileGame(game);
  });
}

function averageGameStat(games: GameRow[], key: string) {
  const values = games.map((game) => perFullTog(game.gameStats?.[key], game)).filter((item): item is number => item != null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function safeDivide(numerator: number | null | undefined, denominator: number | null | undefined) {
  const top = toNumber(numerator);
  const bottom = toNumber(denominator);
  if (top == null || bottom == null || bottom === 0) return null;
  return top / bottom;
}

function validChampionBallUse(value: number | null | undefined) {
  const ballUse = toNumber(value);
  if (ballUse == null || ballUse === 0) return null;
  return ballUse;
}

function averageWeightedRating(
  games: GameRow[],
  championGamesByMatchId?: Map<string, ChampionGameRow>,
  player?: PlayerSummary | null,
  ageAdjustmentContext?: AgeAdjustmentContext | null,
  ratingBasis: RatingBasis = "RAW"
) {
  const ratings = games
    .map((game) => {
      const championGame =
        championGamesByMatchId?.get(championGameKey(game.playerId, game.matchId)) ?? championGamesByMatchId?.get(String(game.matchId));
      return ratingForBasis(
        game,
        player,
        championGame,
        ageAdjustmentContext,
        ratingBasis
      );
    })
    .filter((item): item is number => item != null);
  if (!ratings.length) return null;
  return ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
}

function bestRatedGamesAverage(
  games: GameRow[],
  championGamesByMatchId?: Map<string, ChampionGameRow>,
  sampleSize = BEST_GAME_SAMPLE_SIZE,
  player?: PlayerSummary | null,
  ageAdjustmentContext?: AgeAdjustmentContext | null,
  ratingBasis: RatingBasis = "RAW"
) {
  const ratings = games
    .map((game) => {
      const championGame =
        championGamesByMatchId?.get(championGameKey(game.playerId, game.matchId)) ?? championGamesByMatchId?.get(String(game.matchId));
      return ratingForBasis(
        game,
        player,
        championGame,
        ageAdjustmentContext,
        ratingBasis
      );
    })
    .filter((item): item is number => item != null)
    .sort((a, b) => b - a);
  if (ratings.length < sampleSize) return null;
  const selected = ratings.slice(0, sampleSize);
  return selected.reduce((sum, value) => sum + value, 0) / selected.length;
}

function ballUsePerDisposalValue(games: GameRow[], championGames: ChampionGameRow[]) {
  const gameByMatchId = new Map(games.map((game) => [String(game.matchId), game]));
  let ballUseTotal = 0;
  let disposalTotal = 0;
  let includedGames = 0;

  championGames.forEach((championGame) => {
    const ballUse = validChampionBallUse(championGame.ballUse);
    if (ballUse == null) return;

    const sourceGame = gameByMatchId.get(String(championGame.matchId));
    if (!sourceGame) return;
    const disposals = toNumber(sourceGame.gameStats?.disposals);
    if (disposals == null || disposals <= 0) return;

    ballUseTotal += Number(perFullTog(ballUse, sourceGame));
    disposalTotal += Number(perFullTog(disposals, sourceGame));
    includedGames += 1;
  });

  return { gameCount: includedGames, value: safeDivide(ballUseTotal, disposalTotal) };
}

function ratingPerDisposalValue(
  games: GameRow[],
  championGamesByMatchId?: Map<string, ChampionGameRow>,
  player?: PlayerSummary | null,
  ageAdjustmentContext?: AgeAdjustmentContext | null,
  ratingBasis: RatingBasis = "RAW"
) {
  let ratingTotal = 0;
  let disposalTotal = 0;
  let includedGames = 0;

  games.forEach((game) => {
    const championGame =
      championGamesByMatchId?.get(championGameKey(game.playerId, game.matchId)) ?? championGamesByMatchId?.get(String(game.matchId));
    const rating = ratingForBasis(
      game,
      player,
      championGame,
      ageAdjustmentContext,
      ratingBasis
    );
    const disposals = perFullTog(game.gameStats?.disposals, game);
    if (rating == null || disposals == null || disposals <= 0) return;
    ratingTotal += rating;
    disposalTotal += disposals;
    includedGames += 1;
  });

  return { gameCount: includedGames, value: safeDivide(ratingTotal, disposalTotal) };
}

function averageChampionBallUseForGames(games: GameRow[], championGames: ChampionGameRow[]) {
  const sourceGameByMatchId = new Map(games.map((game) => [String(game.matchId), game]));
  const values = championGames
    .map((game) => {
      const sourceGame = sourceGameByMatchId.get(String(game.matchId));
      if (!sourceGame) return null;
      return perFullTog(validChampionBallUse(game.ballUse), sourceGame);
    })
    .filter((item): item is number => item != null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function statsMetricValue(payload: SecondTierPayload, player: PlayerSummary, keys: string[] | undefined) {
  if (!keys?.length) return null;
  const stats = payload.statsByPlayer[player.playerId];
  for (const key of keys) {
    const value = toNumber(stats?.metrics?.[key]);
    if (value != null) return value;
  }
  return null;
}

function requestedMetricValue(
  metric: RequestedMetricDef,
  player: PlayerSummary,
  payload: SecondTierPayload,
  championPayload: ChampionRatingsPayload | null,
  selectedSeason: string,
  ageAdjustmentContext?: AgeAdjustmentContext | null,
  ratingBasis: RatingBasis = "RAW"
) {
  const games = seasonGamesForPlayer(payload, player, selectedSeason);

  if (metric.id === "ballUsePerDisposal") {
    const result = ballUsePerDisposalValue(games, championGamesForPlayer(championPayload, player, selectedSeason));
    if (result.gameCount < MIN_GAMES_FOR_PERCENTILES) return null;
    return result.value;
  }

  const sampleSize = games.length;
  if (sampleSize < MIN_GAMES_FOR_PERCENTILES) return null;

  if (metric.id === "rating") {
    const championGamesByMatchId = new Map(
      championGamesForPlayer(championPayload, player, selectedSeason).map((game) => [String(game.matchId), game])
    );
    return averageWeightedRating(games, championGamesByMatchId, player, ageAdjustmentContext, ratingBasis);
  }

  if (metric.championKey) {
    const sourceGameByMatchId = new Map(games.map((game) => [String(game.matchId), game]));
    const values = championGamesForPlayer(championPayload, player, selectedSeason)
      .map((game) => {
        const sourceGame = sourceGameByMatchId.get(String(game.matchId));
        if (!sourceGame) return null;
        return perFullTog(toNumber(game[metric.championKey!]), sourceGame);
      })
      .filter((item): item is number => item != null);
    if (values.length) return values.reduce((sum, value) => sum + value, 0) / values.length;
    return null;
  }

  if (metric.gameKey) {
    const value = averageGameStat(games, metric.gameKey);
    if (value != null) return value;
  }

  return statsMetricValue(payload, player, metric.metricKeys);
}

function playerLabel(player: PlayerSummary) {
  const team = player.team ? ` (${player.team})` : "";
  return `${player.playerName}${team}`;
}

function compactPlayerName(name: string) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0][0]}.${parts[parts.length - 1]}`;
}

function inferBirthYear(player: PlayerSummary | null) {
  const explicitBirthYear = toNumber(player?.birthYear);
  if (explicitBirthYear != null) return Math.round(explicitBirthYear);
  const season = toNumber(player?.latestSeason);
  const age = toNumber(player?.age);
  if (season == null || age == null) return null;
  return Math.round(season - Math.floor(age));
}

function inferDraftYear(player: PlayerSummary | null) {
  const birthYear = inferBirthYear(player);
  return birthYear == null ? null : birthYear + 18;
}

function draftYearMatches(player: PlayerSummary, selectedDraftYear: string) {
  if (selectedDraftYear === ALL_FILTER) return true;
  const draftYear = inferDraftYear(player);
  return draftYear != null && String(draftYear) === selectedDraftYear;
}

function minimumGamesMatches(gameCount: number, selectedMinimumGames: string) {
  if (selectedMinimumGames === ALL_FILTER) return true;
  const minimumGames = Number(selectedMinimumGames);
  return Number.isFinite(minimumGames) && gameCount >= minimumGames;
}

function academyClassForClub(club: string | null | undefined) {
  const normalized = String(club ?? "").toLowerCase();
  if (normalized.includes("gws") || normalized.includes("giants")) return "isAcademyGws";
  if (normalized.includes("sydney") || normalized.includes("swans")) return "isAcademySydney";
  if (normalized.includes("brisbane") || normalized.includes("lions")) return "isAcademyBrisbane";
  if (normalized.includes("gold coast") || normalized.includes("suns")) return "isAcademyGoldCoast";
  return "";
}

function academyClubForGames(games: GameRow[], fallbackClub: string | null | undefined) {
  const teamTexts = [...games.map((game) => game.team), fallbackClub].map((team) => String(team ?? "").toLowerCase());
  if (teamTexts.some((team) => team.includes("gws") || team.includes("giants"))) return "GWS";
  if (teamTexts.some((team) => team.includes("sydney") || team.includes("swans"))) return "Sydney";
  if (teamTexts.some((team) => team.includes("brisbane") || team.includes("lions"))) return "Brisbane";
  if (teamTexts.some((team) => team.includes("gold coast") || team.includes("suns"))) return "Gold Coast";
  return null;
}

function percentileFromCohort(value: number, values: number[]) {
  const valid = values.filter((item) => Number.isFinite(item)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const belowOrEqual = valid.filter((item) => item <= value).length;
  return Math.round((belowOrEqual / valid.length) * 100);
}

function scaledScoreFromCohort(value: number | null | undefined, values: number[]) {
  const number = toNumber(value);
  const valid = values.filter((item) => Number.isFinite(item));
  if (number == null || !valid.length) return null;
  const lower = Math.min(...valid);
  const upper = Math.max(...valid);
  if (upper === lower) return 50;
  return ((number - lower) / (upper - lower)) * 100;
}

const ROLE_TRAIT_METRIC_KEYS: Record<string, string[]> = {
  MID: ["ballWinning", "ballUse", "ratingPerDisposal", "clearances", "disposals"],
  WING: ["ballUse", "metresGained", "inside50s", "ratingPerDisposal", "scoreInvolvements"],
  MID_FWD: ["goals", "scoreInvolvements", "ballUse", "inside50s", "ratingPerDisposal"],
  FWD_SMALL: ["goals", "scoreInvolvements", "ballUse", "inside50s", "ratingPerDisposal"],
  FWD_KEY: ["goals", "marks", "scoreInvolvements", "ratingPerDisposal", "ballUse"],
  DEF_KEY: ["defence", "intercepts", "marks", "ballUse", "ratingPerDisposal"],
  DEF_GEN: ["defence", "intercepts", "ballUse", "metresGained", "ratingPerDisposal"],
  RUCK: ["hitouts", "clearances", "marks", "ballWinning", "ratingPerDisposal"],
  GENERAL: ["ballUse", "ballWinning", "defence", "ratingPerDisposal", "disposals"],
};

function roleTraitKeys(positionGroup: string) {
  return ROLE_TRAIT_METRIC_KEYS[positionGroup] ?? ROLE_TRAIT_METRIC_KEYS.GENERAL;
}

function averageChampionMetricForGames(
  games: GameRow[],
  championGames: ChampionGameRow[],
  key: keyof Pick<ChampionGameRow, "rating" | "ballUse" | "ballWinning" | "defence" | "hitouts" | "negative">,
  skipZero = false
) {
  const sourceGameByMatchId = new Map(games.map((game) => [String(game.matchId), game]));
  const values = championGames
    .map((game) => {
      const sourceGame = sourceGameByMatchId.get(String(game.matchId));
      if (!sourceGame) return null;
      return perFullTog(toNumber(game[key]), sourceGame);
    })
    .filter((item): item is number => item != null && (!skipZero || item !== 0));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isAustraliaSelectionGame(game: GameRow) {
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const teamText = String(game.team ?? "").toLowerCase();
  const leagueText = String(game.league ?? "").toLowerCase();
  return leagueCode === "AFLAISA" || teamText === "australia" || teamText.startsWith("australia ") || leagueText.includes("academy");
}

function isUnder18ChampionshipGame(game: GameRow) {
  const leagueCode = String(game.leagueCode ?? "").toUpperCase();
  const leagueText = String(game.league ?? "").toLowerCase();
  return leagueCode === "U18C" || leagueCode === "U18WC" || leagueCode === "CD" || leagueText.includes("under 18 championship");
}

function levelSignalValue(games: GameRow[]) {
  if (!games.length) return null;
  const seniorGames = games.filter(isSeniorSecondTierGame).length;
  const australiaGames = games.filter(isAustraliaSelectionGame).length;
  const champsGames = games.filter(isUnder18ChampionshipGame).length;
  const seniorSignal = Math.min(seniorGames, 8) * 3 + (seniorGames > 0 ? 8 : 0);
  const australiaSignal = Math.min(australiaGames, 6) * 3 + (australiaGames > 0 ? 6 : 0);
  const champsSignal = Math.min(champsGames, 10) * 0.8 + (champsGames / games.length) * 4;
  return seniorSignal + australiaSignal + champsSignal;
}

function roleMetricValues(
  games: GameRow[],
  championGames: ChampionGameRow[],
  championGamesByMatchId: Map<string, ChampionGameRow>,
  player?: PlayerSummary | null,
  ageAdjustmentContext?: AgeAdjustmentContext | null,
  ratingBasis: RatingBasis = "RAW"
) {
  return {
    ballUse: averageChampionMetricForGames(games, championGames, "ballUse", true),
    ballUsePerDisposal: ballUsePerDisposalValue(games, championGames).value,
    ballWinning: averageChampionMetricForGames(games, championGames, "ballWinning"),
    defence: averageChampionMetricForGames(games, championGames, "defence"),
    hitoutsCd: averageChampionMetricForGames(games, championGames, "hitouts"),
    ratingPerDisposal: ratingPerDisposalValue(games, championGamesByMatchId, player, ageAdjustmentContext, ratingBasis).value,
    disposals: averageGameStat(games, "disposals"),
    clearances: averageGameStat(games, "clearances"),
    goals: averageGameStat(games, "goals"),
    marks: averageGameStat(games, "marks"),
    metresGained: averageGameStat(games, "metresGained"),
    inside50s: averageGameStat(games, "inside50s"),
    intercepts: averageGameStat(games, "intercepts"),
    scoreInvolvements: averageGameStat(games, "scoreInvolvements"),
    hitouts: averageGameStat(games, "hitouts"),
  };
}

function weightedProspectScore(components: Array<{ score: number | null | undefined; weight: number }>) {
  const active = components.filter((item) => item.score != null && Number.isFinite(item.score) && item.weight > 0);
  if (!active.length) return null;
  const weightTotal = active.reduce((sum, item) => sum + item.weight, 0);
  if (weightTotal <= 0) return null;
  return active.reduce((sum, item) => sum + Number(item.score) * item.weight, 0) / weightTotal;
}

function resolveMetric(candidate: StatCandidate, stats: PlayerStats | undefined) {
  if (!stats) return null;
  return candidate.metricKeys.find((key) => toNumber(stats.metrics?.[key]) != null) ?? null;
}

function resolvePercentile(metricKey: string, stats: PlayerStats | undefined, cohortStats: PlayerStats[]) {
  const precomputed = toNumber(stats?.percentiles?.[metricKey]);
  if (precomputed != null) return precomputed;
  const value = toNumber(stats?.metrics?.[metricKey]);
  if (value == null) return null;
  return percentileFromCohort(
    value,
    cohortStats.map((item) => toNumber(item.metrics?.[metricKey])).filter((item): item is number => item != null)
  );
}

function selectProfileStats(
  player: PlayerSummary | null,
  payload: SecondTierPayload | null,
  championPayload: ChampionRatingsPayload | null,
  allProspects: PlayerSummary[],
  selectedSeason: string,
  ageAdjustmentContext?: AgeAdjustmentContext | null,
  ratingBasis: RatingBasis = "RAW",
  selectedGender: GenderFilter = DEFAULT_GENDER_FILTER
) {
  if (!player || !payload) return [];
  const metricSet = selectedGender === "WOMEN" ? WOMENS_PROFILE_METRICS : REQUESTED_PROFILE_METRICS;
  const requestedStats = metricSet.map((metric) => {
    const value = requestedMetricValue(metric, player, payload, championPayload, selectedSeason, ageAdjustmentContext, ratingBasis);
    if (value == null) return null;
    const cohortValues = allProspects
      .map((candidate) => requestedMetricValue(metric, candidate, payload, championPayload, selectedSeason, ageAdjustmentContext, ratingBasis))
      .filter((item): item is number => item != null);
    const percentile = percentileFromCohort(value, cohortValues);
    if (percentile == null) return null;
    return {
      id: metric.id,
      label: metric.label,
      group: metric.group,
      metricKeys: metric.metricKeys ?? [],
      gameKeys: metric.gameKey ? [metric.gameKey] : [],
      metricKey: metric.id,
      percentile,
      value,
    };
  }).filter((item): item is SelectedStat => item != null);

  if (requestedStats.length) return requestedStats.slice(0, MAX_RADAR_STATS);

  const stats = payload.statsByPlayer[player.playerId];
  const currentSeasonGames = seasonGamesForPlayer(payload, player, selectedSeason);
  if (!stats || currentSeasonGames.length < MIN_GAMES_FOR_PERCENTILES) return [];
  const positionGroup = normalizePositionGroup(player.position);
  const registry = POSITION_STAT_REGISTRY[positionGroup] ?? POSITION_STAT_REGISTRY.GENERAL;
  const cohortStats = allProspects
    .filter((candidate) => normalizePositionGroup(candidate.position) === positionGroup)
    .map((candidate) => payload.statsByPlayer[candidate.playerId])
    .filter((item): item is PlayerStats => item != null);
  const usedMetricKeys = new Set<string>();
  const selected = registry
    .map((candidate) => {
      const metricKey = resolveMetric(candidate, stats);
      if (!metricKey || usedMetricKeys.has(metricKey)) return null;
      const value = toNumber(stats.metrics?.[metricKey]);
      const percentile = resolvePercentile(metricKey, stats, cohortStats);
      if (value == null || percentile == null) return null;
      usedMetricKeys.add(metricKey);
      return { ...candidate, id: metricKey, metricKey, percentile, value };
    })
    .filter((item): item is SelectedStat => item != null);

  return selected
    .sort((a, b) => Math.abs(b.percentile - 50) - Math.abs(a.percentile - 50))
    .slice(0, MAX_RADAR_STATS);
}

function buildCohortRows(
  players: PlayerSummary[],
  payload: SecondTierPayload,
  selectedSeason: string,
  selectedLeagueScope: string,
  selectedGender: GenderFilter,
  selectedTeam: string,
  positionGroup?: string,
  championPayload?: ChampionRatingsPayload | null,
  ageAdjustmentContext?: AgeAdjustmentContext | null,
  ratingBasis: RatingBasis = "RAW"
): CohortRow[] {
  const rows = players
    .filter((player) => !positionGroup || normalizePositionGroup(player.position) === positionGroup)
    .map((player): CohortRowInput | null => {
      const games = filteredGamesForPlayer(payload, player, selectedSeason, selectedLeagueScope, selectedGender, selectedTeam);
      const championGames = championGamesForPlayer(championPayload ?? null, player, selectedSeason);
      const championGamesByMatchId = new Map(championGames.map((game) => [String(game.matchId), game]));
      const playerPositionGroup = normalizePositionGroup(player.position);
      const rating =
        averageWeightedRating(games, championGamesByMatchId, player, ageAdjustmentContext, ratingBasis) ??
        requestedMetricValue(REQUESTED_PROFILE_METRICS[0], player, payload, championPayload ?? null, selectedSeason, ageAdjustmentContext, ratingBasis) ??
        toNumber(payload.statsByPlayer[player.playerId]?.metrics?.EquityRating) ??
        toNumber(player.latestRating);
      if (rating == null) return null;
      const ballUsePerDisposal = ballUsePerDisposalValue(games, championGames).value;
      const best3Rating = bestRatedGamesAverage(games, championGamesByMatchId, BEST_GAME_SAMPLE_SIZE, player, ageAdjustmentContext, ratingBasis);
      const ratingPerDisposal = ratingPerDisposalValue(games, championGamesByMatchId, player, ageAdjustmentContext, ratingBasis).value;
      const roleMetrics = roleMetricValues(games, championGames, championGamesByMatchId, player, ageAdjustmentContext, ratingBasis);
      return {
        playerId: player.playerId,
        name: player.playerName,
        club: player.team,
        academyClub: academyClubForGames(games, player.team),
        position: player.position || "Unknown",
        positionGroup: playerPositionGroup,
        age: toNumber(player.age),
        games: games.length || Math.round(toNumber(player.games) ?? 0),
        rating,
        best3Rating,
        ratingPerDisposal,
        positionRatingPercentile: null,
        roleTraitScore: null,
        levelSignal: levelSignalValue(games),
        levelSignalScore: null,
        roleMetrics,
        draftRankScore: null,
        best3RatingPercentile: null,
        ratingPercentile: null,
        ratingPerDisposalPercentile: null,
        ballUse: averageChampionBallUseForGames(games, championGames),
        ballUsePerDisposal,
        ballUsePercentile: null,
        ballUsePerDisposalPercentile: null,
        hasSeniorSecondTierGames: games.some(isSeniorSecondTierGame),
        hasWomensGames: games.some(isWomensGame),
      };
    })
    .filter((row): row is CohortRowInput => row != null);

  const best3RatingValues = rows
    .map((row) => row.best3Rating)
    .filter((item): item is number => item != null && Number.isFinite(item));
  const ratingValues = rows.map((row) => row.rating).filter((item): item is number => Number.isFinite(item));
  const ratingPerDisposalValues = rows
    .map((row) => row.ratingPerDisposal)
    .filter((item): item is number => item != null && Number.isFinite(item));
  const ballUseValues = rows
    .map((row) => row.ballUse)
    .filter((item): item is number => item != null && Number.isFinite(item));
  const ballUsePerDisposalValues = rows
    .map((row) => row.ballUsePerDisposal)
    .filter((item): item is number => item != null && Number.isFinite(item));
  const levelSignalValues = rows
    .map((row) => row.levelSignal)
    .filter((item): item is number => item != null && Number.isFinite(item));
  const ratingValuesByPosition = new Map<string, number[]>();
  const roleMetricValuesByPosition = new Map<string, Map<string, number[]>>();
  rows.forEach((row) => {
    const positionValues = ratingValuesByPosition.get(row.positionGroup) ?? [];
    positionValues.push(row.rating);
    ratingValuesByPosition.set(row.positionGroup, positionValues);

    const metricMap = roleMetricValuesByPosition.get(row.positionGroup) ?? new Map<string, number[]>();
    Object.entries(row.roleMetrics).forEach(([metric, value]) => {
      const number = toNumber(value);
      if (number == null) return;
      const metricValues = metricMap.get(metric) ?? [];
      metricValues.push(number);
      metricMap.set(metric, metricValues);
    });
    roleMetricValuesByPosition.set(row.positionGroup, metricMap);
  });

  return rows
    .map((row) => {
      const best3RatingPercentile = row.best3Rating == null ? null : percentileFromCohort(row.best3Rating, best3RatingValues);
      const ratingPercentile = percentileFromCohort(row.rating, ratingValues);
      const positionRatingValues = ratingValuesByPosition.get(row.positionGroup) ?? [];
      const positionRatingPercentile = percentileFromCohort(row.rating, positionRatingValues);
      const ratingPerDisposalPercentile =
        row.ratingPerDisposal == null ? null : percentileFromCohort(row.ratingPerDisposal, ratingPerDisposalValues);
      const ballUsePercentile = row.ballUse == null ? null : percentileFromCohort(row.ballUse, ballUseValues);
      const ballUsePerDisposalPercentile =
        row.ballUsePerDisposal == null ? null : percentileFromCohort(row.ballUsePerDisposal, ballUsePerDisposalValues);
      const best3RatingScore = scaledScoreFromCohort(row.best3Rating, best3RatingValues);
      const ratingScore = scaledScoreFromCohort(row.rating, ratingValues);
      const positionRatingScore = scaledScoreFromCohort(row.rating, positionRatingValues);
      const ballUseScore = scaledScoreFromCohort(row.ballUse, ballUseValues);
      const ballUsePerDisposalScore = scaledScoreFromCohort(row.ballUsePerDisposal, ballUsePerDisposalValues);
      const roleMetricMap = roleMetricValuesByPosition.get(row.positionGroup) ?? new Map<string, number[]>();
      const roleTraitComponentScores = roleTraitKeys(row.positionGroup)
        .map((metric) => scaledScoreFromCohort(row.roleMetrics[metric], roleMetricMap.get(metric) ?? []))
        .filter((item): item is number => item != null);
      const roleTraitScore = roleTraitComponentScores.length
        ? roleTraitComponentScores.reduce((sum, value) => sum + value, 0) / roleTraitComponentScores.length
        : null;
      const levelSignalScore = scaledScoreFromCohort(row.levelSignal, levelSignalValues);
      let rankingComponents = [
        { score: ratingScore, weight: SENIOR_STATE_RATING_WEIGHT },
        { score: ballUseScore, weight: SENIOR_STATE_BALL_USE_WEIGHT },
      ];
      if (!row.hasSeniorSecondTierGames) {
        rankingComponents = [
          { score: ratingScore, weight: PROSPECT_GLOBAL_RATING_WEIGHT },
          { score: positionRatingScore, weight: PROSPECT_POSITION_RATING_WEIGHT },
          { score: roleTraitScore, weight: PROSPECT_ROLE_TRAIT_WEIGHT },
          { score: levelSignalScore, weight: PROSPECT_LEVEL_SIGNAL_WEIGHT },
        ];
        if (!row.hasWomensGames) {
          rankingComponents.splice(2, 0, { score: ballUsePerDisposalScore, weight: PROSPECT_BALL_USE_PER_DISPOSAL_WEIGHT });
        }
        rankingComponents.splice(3, 0, { score: best3RatingScore, weight: PROSPECT_BEST3_WEIGHT });
      }
      const draftRankScore = weightedProspectScore(rankingComponents);
      return {
        ...row,
        draftRankScore,
        best3RatingPercentile,
        ratingPercentile,
        positionRatingPercentile,
        roleTraitScore,
        levelSignalScore,
        ratingPerDisposalPercentile,
        ballUsePercentile,
        ballUsePerDisposalPercentile,
      };
    })
    .sort((a, b) => {
      const aScore = a.draftRankScore;
      const bScore = b.draftRankScore;
      if (aScore != null || bScore != null) return (bScore ?? -1) - (aScore ?? -1);
      return b.rating - a.rating;
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function gameIndexTicks(rowCount: number) {
  if (rowCount <= 0) return [];
  if (rowCount <= 10) return Array.from({ length: rowCount }, (_, index) => index + 1);
  const step = Math.ceil(rowCount / 8);
  const ticks = new Set<number>([1, rowCount]);
  for (let value = step; value < rowCount; value += step) ticks.add(value);
  return [...ticks].sort((a, b) => a - b);
}

type DraftProspectProfileDashboardProps = {
  initialPlayerId?: string | number | null;
  initialSeason?: string | number | null;
};

export default function DraftProspectProfileDashboard({
  initialPlayerId = null,
  initialSeason = null,
}: DraftProspectProfileDashboardProps = {}) {
  const requestedPlayerId = normalizeProspectPlayerId(initialPlayerId);
  const requestedSeason = String(initialSeason ?? "").trim();
  const [payload, setPayload] = useState<SecondTierPayload | null>(null);
  const [championPayload, setChampionPayload] = useState<ChampionRatingsPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [selectedLeagueScope, setSelectedLeagueScope] = useState(DEFAULT_LEAGUE_SCOPE);
  const [selectedGender, setSelectedGender] = useState<GenderFilter>(DEFAULT_GENDER_FILTER);
  const [selectedPositionGroup, setSelectedPositionGroup] = useState(ALL_FILTER);
  const [selectedTeam, setSelectedTeam] = useState(ALL_FILTER);
  const [selectedSeason, setSelectedSeason] = useState(
    requestedSeason && requestedSeason !== ALL_FILTER ? requestedSeason : ALL_FILTER
  );
  const [selectedDraftYear, setSelectedDraftYear] = useState(ALL_FILTER);
  const [selectedMinimumGames, setSelectedMinimumGames] = useState(ALL_FILTER);
  const [selectedRatingBasis, setSelectedRatingBasis] = useState<RatingBasis>(DEFAULT_RATING_BASIS);
  const cohortWrapRef = useRef<HTMLDivElement | null>(null);
  const draftYearAutoDefaultRef = useRef(true);
  const payloadCacheRef = useRef<Map<string, SecondTierPayload>>(new Map());
  const championPayloadCacheRef = useRef<ChampionRatingsPayload | null | undefined>(undefined);

  useEffect(() => {
    if (!requestedSeason || requestedSeason === ALL_FILTER) return;
    setSelectedSeason((prev) => (prev === requestedSeason ? prev : requestedSeason));
  }, [requestedSeason]);

  useEffect(() => {
    if (!requestedPlayerId || !payload) return;
    const requestedProspect = payload.players.find((player) => normalizeProspectPlayerId(player.playerId) === requestedPlayerId);
    if (!requestedProspect) return;
    setSelectedPlayerId((prev) => (prev === requestedProspect.playerId ? prev : requestedProspect.playerId));
    setPlayerSearch(playerLabel(requestedProspect));
  }, [payload, requestedPlayerId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPayloadForFile(file: string) {
      const cached = payloadCacheRef.current.get(file);
      if (cached) return cached;
      const json = (await fetchJsonFile(file, true)) as SecondTierPayload;
      payloadCacheRef.current.set(file, json);
      return json;
    }

    async function loadChampionPayload() {
      if (championPayloadCacheRef.current !== undefined) return championPayloadCacheRef.current;
      const json = ((await fetchJsonFile(CHAMPION_RATINGS_FILE, false).catch(() => null)) ??
        null) as ChampionRatingsPayload | null;
      championPayloadCacheRef.current = json;
      return json;
    }

    async function loadPayloadForScope() {
      const primaryFile = payloadFileForLeagueScope(selectedLeagueScope, selectedGender);
      const primaryPayload = await loadPayloadForFile(primaryFile);
      const requestedProspect = requestedPlayerId
        ? primaryPayload.players.find((player) => normalizeProspectPlayerId(player.playerId) === requestedPlayerId)
        : undefined;
      if (requestedProspect || !requestedPlayerId || selectedLeagueScope !== DEFAULT_LEAGUE_SCOPE) {
        return { payload: primaryPayload, resolvedScope: selectedLeagueScope, resolvedGender: selectedGender };
      }

      const fallbackScopes = [SECOND_TIER_SENIOR_SCOPE, ALL_FILTER];
      const fallbackGenders: GenderFilter[] =
        selectedGender === ALL_FILTER ? [ALL_FILTER] : [selectedGender, ALL_FILTER, selectedGender === "WOMEN" ? "MEN" : "WOMEN"];
      for (const fallbackScope of fallbackScopes) {
        for (const fallbackGender of fallbackGenders) {
          const fallbackPayload = await loadPayloadForFile(payloadFileForLeagueScope(fallbackScope, fallbackGender));
          const fallbackProspect = fallbackPayload.players.find(
            (player) => normalizeProspectPlayerId(player.playerId) === requestedPlayerId
          );
          if (fallbackProspect) return { payload: fallbackPayload, resolvedScope: fallbackScope, resolvedGender: fallbackGender };
        }
      }
      return { payload: primaryPayload, resolvedScope: selectedLeagueScope, resolvedGender: selectedGender };
    }

    Promise.all([loadPayloadForScope(), loadChampionPayload()])
      .then(([payloadResult, championJson]) => {
        if (cancelled) return;
        const nextPayload = payloadResult.payload;
        const activeLeagueScope = payloadResult.resolvedScope;
        const activeGender = payloadResult.resolvedGender ?? selectedGender;
        if (activeLeagueScope !== selectedLeagueScope) setSelectedLeagueScope(activeLeagueScope);
        if (activeGender !== selectedGender) setSelectedGender(activeGender);
        const defaultProspects = nextPayload.players.filter(
          (player) => filteredGamesForPlayer(nextPayload, player, ALL_FILTER, activeLeagueScope, activeGender, ALL_FILTER).length > 0
        );
        const championGamesByDefaultKey = new Map<string, ChampionGameRow>();
        ((championJson as ChampionRatingsPayload | null)?.games ?? []).forEach((game) => {
          championGamesByDefaultKey.set(championGameKey(game.playerId, game.matchId), game);
        });
        const defaultAgeAdjustmentContext = buildAgeAdjustmentContext(
          nextPayload.players,
          nextPayload,
          ALL_FILTER,
          activeLeagueScope,
          activeGender,
          championGamesByDefaultKey
        );
        const defaultCohort = buildCohortRows(
          defaultProspects,
          nextPayload,
          ALL_FILTER,
          activeLeagueScope,
          activeGender,
          ALL_FILTER,
          undefined,
          championJson as ChampionRatingsPayload | null,
          defaultAgeAdjustmentContext,
          DEFAULT_RATING_BASIS
        );
        const requestedProspect = requestedPlayerId
          ? nextPayload.players.find((player) => normalizeProspectPlayerId(player.playerId) === requestedPlayerId)
          : undefined;
        const firstProspect =
          requestedProspect ??
          defaultProspects.find((player) => player.playerId === defaultCohort[0]?.playerId) ??
          defaultProspects.sort((a, b) => (toNumber(b.latestRating) ?? 0) - (toNumber(a.latestRating) ?? 0))[0];
        setPayload(nextPayload);
        setChampionPayload(championJson as ChampionRatingsPayload | null);
        setSelectedPlayerId(firstProspect?.playerId ?? "");
        setPlayerSearch(firstProspect ? playerLabel(firstProspect) : "");
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [requestedPlayerId, selectedGender, selectedLeagueScope]);

  const seasonOptions = useMemo(() => {
    if (!payload) return [];
    const seasons = new Set<number>();
    Object.values(payload.gamesByPlayer ?? {}).forEach((games) => {
      games.forEach((game) => {
        if (Number.isFinite(Number(game.season))) seasons.add(Number(game.season));
      });
    });
    return [...seasons].sort((a, b) => b - a);
  }, [payload]);

  const championGamesByKey = useMemo(() => {
    const map = new Map<string, ChampionGameRow>();
    (championPayload?.games ?? []).forEach((game) => {
      map.set(championGameKey(game.playerId, game.matchId), game);
    });
    return map;
  }, [championPayload]);

  const ageAdjustmentContext = useMemo(
    () => (payload ? buildAgeAdjustmentContext(payload.players, payload, selectedSeason, selectedLeagueScope, selectedGender, championGamesByKey) : null),
    [championGamesByKey, payload, selectedGender, selectedLeagueScope, selectedSeason]
  );

  const prospects = useMemo(() => {
    if (!payload) return [];
    const filteredPlayers = payload.players
      .filter((player) => draftYearMatches(player, selectedDraftYear))
      .filter((player) => positionMatchesPlayer(player, selectedPositionGroup))
      .filter((player) => {
        const gameCount = filteredGamesForPlayer(payload, player, selectedSeason, selectedLeagueScope, selectedGender, selectedTeam).length;
        return gameCount > 0 && minimumGamesMatches(gameCount, selectedMinimumGames);
      });
    const rankedRows = buildCohortRows(
      filteredPlayers,
      payload,
      selectedSeason,
      selectedLeagueScope,
      selectedGender,
      selectedTeam,
      undefined,
      championPayload,
      ageAdjustmentContext,
      selectedRatingBasis
    );
    const rankByPlayerId = new Map(rankedRows.map((row) => [row.playerId, row.rank]));
    return filteredPlayers.sort((a, b) => {
      const aRank = rankByPlayerId.get(a.playerId);
      const bRank = rankByPlayerId.get(b.playerId);
      if (aRank != null || bRank != null) return (aRank ?? Number.POSITIVE_INFINITY) - (bRank ?? Number.POSITIVE_INFINITY);
      return (toNumber(b.latestRating) ?? 0) - (toNumber(a.latestRating) ?? 0);
    });
  }, [
    ageAdjustmentContext,
    championPayload,
    payload,
    selectedDraftYear,
    selectedGender,
    selectedLeagueScope,
    selectedMinimumGames,
    selectedPositionGroup,
    selectedRatingBasis,
    selectedSeason,
    selectedTeam,
  ]);

  const draftYearOptions = useMemo(() => {
    if (!payload) return [];
    const years = new Set<number>();
    payload.players
      .filter((player) => positionMatchesPlayer(player, selectedPositionGroup))
      .filter((player) => {
        const gameCount = filteredGamesForPlayer(payload, player, selectedSeason, selectedLeagueScope, selectedGender, selectedTeam).length;
        return gameCount > 0 && minimumGamesMatches(gameCount, selectedMinimumGames);
      })
      .forEach((player) => {
        const draftYear = inferDraftYear(player);
        if (draftYear != null) years.add(draftYear);
      });
    return [...years].sort((a, b) => b - a);
  }, [payload, selectedGender, selectedLeagueScope, selectedMinimumGames, selectedPositionGroup, selectedSeason, selectedTeam]);

  const positionOptions = useMemo(() => {
    if (!payload) return [];
    const groups = new Set<string>();
    payload.players
      .filter((player) => draftYearMatches(player, selectedDraftYear))
      .filter((player) => {
        const gameCount = filteredGamesForPlayer(payload, player, selectedSeason, selectedLeagueScope, selectedGender, selectedTeam).length;
        return gameCount > 0 && minimumGamesMatches(gameCount, selectedMinimumGames);
      })
      .forEach((player) => {
        groups.add(normalizePositionGroup(player.position));
      });
    return [...groups].sort((a, b) => positionGroupLabel(a).localeCompare(positionGroupLabel(b)));
  }, [payload, selectedDraftYear, selectedGender, selectedLeagueScope, selectedMinimumGames, selectedSeason, selectedTeam]);

  const teamOptions = useMemo(() => {
    if (!payload) return [];
    const teams = new Set<string>();
    payload.players
      .filter((player) => draftYearMatches(player, selectedDraftYear))
      .filter((player) => positionMatchesPlayer(player, selectedPositionGroup))
      .filter((player) =>
        minimumGamesMatches(
          filteredGamesForPlayer(payload, player, selectedSeason, selectedLeagueScope, selectedGender, ALL_FILTER).length,
          selectedMinimumGames
        )
      )
      .forEach((player) => {
        filteredGamesForPlayer(payload, player, selectedSeason, selectedLeagueScope, selectedGender, ALL_FILTER).forEach((game) => {
          if (game.team) teams.add(game.team);
        });
    });
    return [...teams].sort((a, b) => a.localeCompare(b));
  }, [payload, selectedDraftYear, selectedGender, selectedLeagueScope, selectedMinimumGames, selectedPositionGroup, selectedSeason]);

  useEffect(() => {
    if (selectedDraftYear !== ALL_FILTER && !draftYearOptions.includes(Number(selectedDraftYear))) {
      setSelectedDraftYear(ALL_FILTER);
      draftYearAutoDefaultRef.current = true;
    }
  }, [draftYearOptions, selectedDraftYear]);

  useEffect(() => {
    if (selectedPositionGroup !== ALL_FILTER && !positionOptions.includes(selectedPositionGroup)) {
      setSelectedPositionGroup(ALL_FILTER);
    }
  }, [positionOptions, selectedPositionGroup]);

  useEffect(() => {
    if (selectedTeam !== ALL_FILTER && !teamOptions.includes(selectedTeam)) {
      setSelectedTeam(ALL_FILTER);
    }
  }, [selectedTeam, teamOptions]);

  useEffect(() => {
    if (!payload || !prospects.length) return;
    if (!prospects.some((item) => item.playerId === selectedPlayerId)) {
      setSelectedPlayerId(prospects[0].playerId);
      setPlayerSearch(playerLabel(prospects[0]));
    }
  }, [payload, prospects, selectedPlayerId]);

  const player = useMemo(
    () => prospects.find((item) => item.playerId === selectedPlayerId) ?? prospects[0] ?? null,
    [prospects, selectedPlayerId]
  );

  useEffect(() => {
    if (!player || !draftYearAutoDefaultRef.current) return;
    const playerDraftYear = inferDraftYear(player);
    if (playerDraftYear == null) return;
    setSelectedDraftYear((prev) => (prev === String(playerDraftYear) ? prev : String(playerDraftYear)));
  }, [player]);

  useEffect(() => {
    if (player) setPlayerSearch(playerLabel(player));
  }, [player]);

  const positionGroup = normalizePositionGroup(player?.position);
  const allProspects = useMemo(
    () => prospects,
    [prospects]
  );
  const playerGames = useMemo(
    () =>
      player && payload
        ? filteredGamesForPlayer(payload, player, selectedSeason, selectedLeagueScope, selectedGender, selectedTeam).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
        : [],
    [payload, player, selectedGender, selectedLeagueScope, selectedSeason, selectedTeam]
  );
  const careerGames = useMemo(
    () => (player && payload ? allLoadedGamesForPlayer(payload, player).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)) : []),
    [payload, player]
  );
  const currentSeason = selectedSeason === ALL_FILTER ? toNumber(player?.latestSeason) : Number(selectedSeason);
  const currentSeasonGames = useMemo(
    () => playerGames.filter((game) => currentSeason != null && Number(game.season) === currentSeason),
    [currentSeason, playerGames]
  );
  const tableGames = useMemo(
    () => [...careerGames].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    [careerGames]
  );
  const selectedStats = useMemo(
    () => selectProfileStats(player, payload, championPayload, allProspects, selectedSeason, ageAdjustmentContext, selectedRatingBasis, selectedGender),
    [ageAdjustmentContext, allProspects, championPayload, payload, player, selectedGender, selectedRatingBasis, selectedSeason]
  );
  const topTraitStats = useMemo(
    () => [...selectedStats].sort((a, b) => b.percentile - a.percentile).slice(0, 4),
    [selectedStats]
  );
  const trendRows = useMemo(
    () =>
      careerGames.map((game, index) => {
        const championGame = getChampionGame(game, championGamesByKey);
        return {
          gameNo: index + 1,
          date: game.date,
          season: Number(game.season),
          league: game.league,
          leagueCode: game.leagueCode,
          leagueColor: leaguePointColor(game.leagueCode),
          rating: ratingForBasis(game, player, championGame, ageAdjustmentContext, selectedRatingBasis) ?? 0,
        };
      }),
    [ageAdjustmentContext, careerGames, championGamesByKey, player, selectedRatingBasis]
  );
  const leagueLegendItems = useMemo(() => {
    const seen = new Map<string, { code: string; label: string; color: string }>();
    trendRows.forEach((row) => {
      const code = String(row.leagueCode || row.league || "League");
      if (!seen.has(code)) {
        seen.set(code, {
          code,
          label: String(row.leagueCode || row.league || "League"),
          color: row.leagueColor,
        });
      }
    });
    return [...seen.values()];
  }, [trendRows]);
  const seasonBands = useMemo(() => {
    if (!trendRows.length) return [];
    const bands: Array<{ season: number; start: number; end: number }> = [];
    trendRows.forEach((row) => {
      const season = Number(row.season);
      const lastBand = bands[bands.length - 1];
      if (lastBand && lastBand.season === season) {
        lastBand.end = row.gameNo;
      } else {
        bands.push({
          season,
          start: row.gameNo,
          end: row.gameNo,
        });
      }
    });
    const latestSeason = Math.max(...bands.map((band) => band.season).filter(Number.isFinite));
    return bands.map((band) => {
      const seasonsBack = Number.isFinite(latestSeason) ? Math.max(0, latestSeason - band.season) : 0;
      const opacity = seasonsBack === 0 ? 0.8 : seasonsBack === 1 ? 0.5 : seasonsBack === 2 ? 0.3 : Math.max(0.12, 0.3 - (seasonsBack - 2) * 0.08);
      return { ...band, opacity };
    });
  }, [trendRows]);
  const careerAverageRating = useMemo(() => {
    const ratings = trendRows.map((row) => toNumber(row.rating)).filter((item): item is number => item != null);
    if (!ratings.length) return null;
    return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  }, [trendRows]);
  const avgRating = useMemo(() => {
    if (!player || !payload) return null;
    const ratingMetric = selectedGender === "WOMEN" ? WOMENS_PROFILE_METRICS[0] : REQUESTED_PROFILE_METRICS[0];
    return (
      averageWeightedRating(currentSeasonGames, championGamesByKey, player, ageAdjustmentContext, selectedRatingBasis) ??
      requestedMetricValue(ratingMetric, player, payload, championPayload, selectedSeason, ageAdjustmentContext, selectedRatingBasis)
    );
  }, [ageAdjustmentContext, championGamesByKey, championPayload, currentSeasonGames, payload, player, selectedGender, selectedRatingBasis, selectedSeason]);
  const filteredCohort = useMemo(
    () =>
      payload
        ? buildCohortRows(
            allProspects,
            payload,
            selectedSeason,
            selectedLeagueScope,
            selectedGender,
            selectedTeam,
            undefined,
            championPayload,
            ageAdjustmentContext,
            selectedRatingBasis
          )
        : [],
    [ageAdjustmentContext, allProspects, championPayload, payload, selectedGender, selectedLeagueScope, selectedRatingBasis, selectedSeason, selectedTeam]
  );
  const positionCohort = useMemo(
    () =>
      payload
        ? buildCohortRows(
            allProspects,
            payload,
            selectedSeason,
            selectedLeagueScope,
            selectedGender,
            selectedTeam,
            positionGroup,
            championPayload,
            ageAdjustmentContext,
            selectedRatingBasis
          )
        : [],
    [ageAdjustmentContext, allProspects, championPayload, payload, positionGroup, selectedGender, selectedLeagueScope, selectedRatingBasis, selectedSeason, selectedTeam]
  );
  const filteredRank = filteredCohort.find((row) => row.playerId === player?.playerId)?.rank ?? null;
  const positionRank = positionCohort.find((row) => row.playerId === player?.playerId)?.rank ?? null;
  const cohortRows = filteredCohort;
  const gameRatingCohortValues = useMemo(() => {
    if (!payload) return [];
    const values: number[] = [];
    allProspects.forEach((candidate) => {
      filteredGamesForPlayer(payload, candidate, selectedSeason, selectedLeagueScope, selectedGender, selectedTeam).forEach((game) => {
        const rating = ratingForBasis(game, candidate, getChampionGame(game, championGamesByKey), ageAdjustmentContext, selectedRatingBasis);
        if (rating != null && Number.isFinite(rating)) values.push(rating);
      });
    });
    return values;
  }, [ageAdjustmentContext, allProspects, championGamesByKey, payload, selectedGender, selectedLeagueScope, selectedRatingBasis, selectedSeason, selectedTeam]);

  useEffect(() => {
    const container = cohortWrapRef.current;
    if (!container || !player?.playerId || !cohortRows.length) return;
    window.requestAnimationFrame(() => {
      const selectedRow = Array.from(container.querySelectorAll<HTMLTableRowElement>("tr[data-player-id]")).find(
        (row) => row.dataset.playerId === player.playerId
      );
      if (!selectedRow) return;
      const nextScrollTop = selectedRow.offsetTop - container.clientHeight / 2 + selectedRow.clientHeight / 2;
      container.scrollTop = Math.max(0, nextScrollTop);
    });
  }, [cohortRows, player?.playerId]);

  const latestGame = tableGames[0] ?? null;
  const radarRows = selectedStats.map((stat) => ({
    stat: stat.label,
    percentile: Math.max(0, Math.min(100, stat.percentile)),
    fullMark: 100,
  }));
  const cohortLabel = selectedPositionGroup === ALL_FILTER ? "All filtered players" : `${positionGroupLabel(selectedPositionGroup)} only`;

  if (loadError) {
    return (
      <main className="draftProspectShell">
        <div className="draftProspectStatus">{loadError}</div>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="draftProspectShell">
        <div className="draftProspectStatus">Loading draft prospect profile...</div>
      </main>
    );
  }

  const goTo = (path: string) => {
    window.location.assign(path);
  };

  const resetFilters = () => {
    draftYearAutoDefaultRef.current = true;
    setSelectedLeagueScope(DEFAULT_LEAGUE_SCOPE);
    setSelectedGender(DEFAULT_GENDER_FILTER);
    setSelectedPositionGroup(ALL_FILTER);
    setSelectedTeam(ALL_FILTER);
    setSelectedSeason(ALL_FILTER);
    setSelectedDraftYear(ALL_FILTER);
    setSelectedMinimumGames(ALL_FILTER);
    setSelectedRatingBasis(DEFAULT_RATING_BASIS);
    setSelectedPlayerId(prospects[0]?.playerId ?? "");
    setPlayerSearch(prospects[0] ? playerLabel(prospects[0]) : "");
  };

  return (
    <main className="draftProspectShell">
      <header className="draftProspectTopbar">
        <div className="draftProspectTopIntro">
          <div className="draftProspectBrandBlock">
            <div className="draftProspectTitle">Draft Prospect Profile</div>
          </div>
          <div className="draftProspectViewCluster">
            <span className="draftProspectInlineLabel">View</span>
            <button className="draftProspectPill" type="button" onClick={() => goTo("/team/40")}>Team</button>
            <button className="draftProspectPill" type="button" onClick={() => goTo("/")}>Career</button>
            <button className="draftProspectPill" type="button" onClick={() => goTo("/league-trends")}>League Trends</button>
            <button className="draftProspectPill" type="button" onClick={() => goTo("/second-tier-ratings")}>2nd Tier Ratings</button>
            <button className="draftProspectPill isActive" type="button">Draft Prospects</button>
          </div>
          <div className="draftProspectHeaderActions">
            <button className="draftProspectPill" type="button" onClick={resetFilters}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </div>

        <div className="draftProspectFilterDeck">
          <div className="draftProspectFilterGrid">
            <div className="draftProspectControlGroup">
              <label className="draftProspectControlLabel" htmlFor="draft-gender-select">Gender</label>
              <select
                className="draftProspectSelect draftProspectGenderSelect"
                id="draft-gender-select"
                value={selectedGender}
                onChange={(event) => {
                  setSelectedGender(event.target.value as GenderFilter);
                  setSelectedTeam(ALL_FILTER);
                }}
              >
                {GENDER_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="draftProspectControlGroup">
              <label className="draftProspectControlLabel" htmlFor="draft-league-scope-select">League</label>
              <select
                className="draftProspectSelect draftProspectLeagueSelect"
                id="draft-league-scope-select"
                value={selectedLeagueScope}
                onChange={(event) => setSelectedLeagueScope(event.target.value)}
              >
                {LEAGUE_SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="draftProspectControlGroup">
              <label className="draftProspectControlLabel" htmlFor="draft-position-select">Position</label>
              <select
                className="draftProspectSelect draftProspectPositionSelect"
                id="draft-position-select"
                value={selectedPositionGroup}
                onChange={(event) => setSelectedPositionGroup(event.target.value)}
              >
                <option value={ALL_FILTER}>All</option>
                {positionOptions.map((positionGroupOption) => (
                  <option key={positionGroupOption} value={positionGroupOption}>
                    {positionGroupLabel(positionGroupOption)}
                  </option>
                ))}
              </select>
            </div>
            <div className="draftProspectControlGroup">
              <label className="draftProspectControlLabel" htmlFor="draft-season-select">Season</label>
              <select
                className="draftProspectSelect draftProspectSeasonSelect"
                id="draft-season-select"
                value={selectedSeason}
                onChange={(event) => setSelectedSeason(event.target.value)}
              >
                <option value={ALL_FILTER}>All</option>
                {seasonOptions.map((season) => (
                  <option key={season} value={String(season)}>
                    {season}
                  </option>
                ))}
              </select>
            </div>
            <div className="draftProspectControlGroup">
              <label className="draftProspectControlLabel" htmlFor="draft-year-select">Draft Year</label>
              <select
                className="draftProspectSelect draftProspectBirthYearSelect"
                id="draft-year-select"
                value={selectedDraftYear}
                onChange={(event) => {
                  draftYearAutoDefaultRef.current = false;
                  setSelectedDraftYear(event.target.value);
                }}
              >
                <option value={ALL_FILTER}>All</option>
                {draftYearOptions.map((draftYear) => (
                  <option key={draftYear} value={String(draftYear)}>
                    {draftYear}
                  </option>
                ))}
              </select>
            </div>
            <div className="draftProspectControlGroup">
              <label className="draftProspectControlLabel" htmlFor="draft-min-games-select">Min Gm</label>
              <select
                className="draftProspectSelect draftProspectMinGamesSelect"
                id="draft-min-games-select"
                value={selectedMinimumGames}
                onChange={(event) => setSelectedMinimumGames(event.target.value)}
              >
                {MIN_GAME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="draftProspectControlGroup">
              <label className="draftProspectControlLabel" htmlFor="draft-rating-basis-select">Rating</label>
              <select
                className="draftProspectSelect draftProspectRatingBasisSelect"
                id="draft-rating-basis-select"
                value={selectedRatingBasis}
                onChange={(event) => setSelectedRatingBasis(event.target.value as RatingBasis)}
              >
                <option value="AGE_ADJUSTED">Age-adjusted</option>
                <option value="RAW">Raw</option>
              </select>
            </div>
            <div className="draftProspectControlGroup draftProspectPlayerControlGroup">
              <label className="draftProspectControlLabel" htmlFor="draft-player-search">Player</label>
              <input
                className="draftProspectSelect draftProspectPlayerSelect"
                id="draft-player-search"
                list="draft-prospect-player-options"
                placeholder="Search player..."
                value={playerSearch}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setPlayerSearch(nextValue);
                  const exactMatch = prospects.find((option) => playerLabel(option) === nextValue);
                  if (exactMatch) {
                    if (draftYearAutoDefaultRef.current) {
                      const draftYear = inferDraftYear(exactMatch);
                      if (draftYear != null) setSelectedDraftYear(String(draftYear));
                    }
                    setSelectedPlayerId(exactMatch.playerId);
                  }
                }}
                onBlur={() => {
                  if (player) setPlayerSearch(playerLabel(player));
                }}
              />
              <datalist id="draft-prospect-player-options">
                {prospects.map((option) => (
                  <option key={option.playerId} value={playerLabel(option)} />
                ))}
              </datalist>
            </div>
          </div>
        </div>
      </header>

      {!player ? (
        <section className="draftProspectStatus">No players found for the selected filters.</section>
      ) : (
        <>
          <section className="draftProspectHero">
            <div className="draftProspectPhoto" aria-label={`${player.playerName} photo placeholder`}>
              {player.playerName.slice(0, 1)}
            </div>
            <div className="draftProspectHeroText">
              <h1>{player.playerName}</h1>
              <p>
                {player.position || "Position unknown"} | {player.team || "Team unknown"} | {latestGame?.leagueCode || player.latestLeagueCode || "League"}{" "}
                {currentSeason || player.latestSeason || ""}
              </p>
              <span>
                Height {player.height ? `${Math.round(player.height)}cm` : "-"} | Team {player.team || "-"} | Age {formatNumber(player.age, 1)} | Position{" "}
                {player.position || "Unknown"} | Season Games {currentSeasonGames.length}
              </span>
            </div>
            <div className="draftProspectRatingDial">
              <div className="draftProspectDial" style={{ "--score": `${Math.max(0, Math.min(100, (avgRating ?? player.latestRating ?? 0) * 4))}%` } as any}>
                <span>{formatNumber(avgRating ?? player.latestRating, 1)}</span>
              </div>
              <div>
                <strong>Overall Rating</strong>
                <span>{filteredRank ? `${ordinal(filteredRank)} of ${filteredCohort.length} filtered` : "Filtered rank unavailable"}</span>
                <span>{positionRank ? `${ordinal(positionRank)} position` : "Position rank unavailable"}</span>
              </div>
            </div>
          </section>

          <section className="draftProspectGrid">
            <aside className="draftProspectPanel draftProspectRadarPanel">
              <div className="draftProspectPanelHeader">
                <h2>Radar Profile</h2>
                <span>Percentiles</span>
              </div>
              {radarRows.length ? (
                <>
                  <div className="draftProspectRadar">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarRows} outerRadius="72%">
                        <PolarGrid stroke="rgba(0,0,0,0.12)" />
                        <PolarAngleAxis dataKey="stat" tick={{ fontSize: 11, fill: "rgba(0,0,0,0.68)", fontWeight: 750 }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar dataKey="percentile" name="Percentile" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.22} strokeWidth={2.2} />
                        <Tooltip formatter={(value: any) => [`${Math.round(Number(value))}th`, "Percentile"]} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="draftProspectTraitList">
                    {topTraitStats.map((stat) => (
                      <div className="draftProspectTraitRow" key={stat.metricKey}>
                        <span>{stat.label}</span>
                        <strong>{ordinal(stat.percentile)}</strong>
                        <i style={{ background: percentileColor(stat.percentile), width: `${Math.max(0, Math.min(100, stat.percentile))}%` }} />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="draftProspectEmpty">No valid position profile yet. A minimum of {MIN_GAMES_FOR_PERCENTILES} current-season games is required.</div>
              )}
            </aside>

            <section className="draftProspectPanel draftProspectTrendPanel">
              <div className="draftProspectPanelHeader">
                <h2>Ratings Trend</h2>
              </div>
              {trendRows.length >= 4 ? (
                <div className="draftProspectTrend">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendRows} margin={{ top: 20, right: 22, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(0,0,0,0.08)" strokeDasharray="4 4" />
                      {seasonBands.map((band) => (
                        <ReferenceArea
                          key={`${band.season}-${band.start}-${band.end}`}
                          x1={band.start - 0.5}
                          x2={band.end + 0.5}
                          fill="#f3f4f6"
                          fillOpacity={band.opacity}
                          strokeOpacity={0}
                          ifOverflow="hidden"
                          label={{
                            value: String(band.season),
                            position: "insideBottom",
                            fill: "rgba(17,24,39,0.42)",
                            fontSize: 11,
                            dy: -2,
                          }}
                        />
                      ))}
                      {seasonBands.slice(1).map((band) => (
                        <ReferenceLine
                          key={`season-boundary-${band.season}-${band.start}`}
                          x={band.start - 0.5}
                          stroke="rgba(17,24,39,0.25)"
                          strokeDasharray="3 4"
                          strokeWidth={1}
                          ifOverflow="extendDomain"
                        />
                      ))}
                      <XAxis
                        dataKey="gameNo"
                        type="number"
                        allowDecimals={false}
                        domain={[0.5, Math.max(1, trendRows.length) + 0.5]}
                        ticks={gameIndexTicks(trendRows.length)}
                        tick={{ fontSize: 11, fill: "rgba(0,0,0,0.58)" }}
                        axisLine={{ stroke: "rgba(0,0,0,0.22)" }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "rgba(0,0,0,0.58)" }}
                        axisLine={{ stroke: "rgba(0,0,0,0.22)" }}
                        tickLine={false}
                        width={38}
                      />
                      {careerAverageRating != null ? (
                        <ReferenceLine
                          y={careerAverageRating}
                          stroke="rgba(0,0,0,0.42)"
                          strokeDasharray="5 5"
                          label={{ value: "Career avg", position: "insideTopLeft", fill: "rgba(0,0,0,0.55)", fontSize: 11 }}
                        />
                      ) : null}
                      <Line
                        type="monotone"
                        dataKey="rating"
                        stroke="rgba(17,24,39,0.68)"
                        strokeWidth={2.5}
                        dot={(props: any) => (
                          <circle
                            cx={props.cx}
                            cy={props.cy}
                            r={5}
                            fill={props.payload?.leagueColor ?? "#7c3aed"}
                            stroke="#ffffff"
                            strokeWidth={1.4}
                          />
                        )}
                        activeDot={(props: any) => (
                          <circle
                            cx={props.cx}
                            cy={props.cy}
                            r={7}
                            fill={props.payload?.leagueColor ?? "#7c3aed"}
                            stroke="#ffffff"
                            strokeWidth={1.8}
                          />
                        )}
                        isAnimationActive={false}
                      />
                      <Tooltip
                        formatter={(value: any) => [formatNumber(Number(value), 2), "Rating"]}
                        labelFormatter={(_, rows) => {
                          const row = rows?.[0]?.payload;
                          return row ? `Game ${row.gameNo} | ${formatDate(row.date)} | ${row.leagueCode || row.league || "League"}` : "";
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  {leagueLegendItems.length > 1 ? (
                    <div className="draftProspectTrendLegend">
                      {leagueLegendItems.map((item) => (
                        <span key={item.code}>
                          <i style={{ background: item.color }} />
                          {item.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="draftProspectEmpty">Not enough career games for a trend line.</div>
              )}
            </section>

            <aside className="draftProspectPanel draftProspectCohortPanel">
              <div className="draftProspectPanelHeader">
                <h2>Full Cohort</h2>
                <span>{cohortLabel}</span>
              </div>
              {cohortRows.length ? (
                <div className="draftProspectCohortWrap" ref={cohortWrapRef}>
                  <table className="draftProspectCohortTable">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Player</th>
                        <th>Pos</th>
                        <th>Age</th>
                        <th>Rating</th>
                        <th>Eq / Disp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cohortRows.map((row) => (
                        <tr
                          className={[row.playerId === player.playerId ? "isSelected" : "", academyClassForClub(row.academyClub ?? row.club)]
                            .filter(Boolean)
                            .join(" ")}
                          data-player-id={row.playerId}
                          key={row.playerId}
                        >
                          <td>{row.rank}</td>
                          <td title={row.name ?? ""}>{compactPlayerName(row.name ?? "")}</td>
                          <td>{row.position}</td>
                          <td>{formatNumber(row.age, 1)}</td>
                          <td>{formatNumber(row.rating, 2)}</td>
                          <td>{formatNumber(row.ratingPerDisposal, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="draftProspectEmpty">Position cohort data is unavailable for this player.</div>
              )}
            </aside>

            <section className="draftProspectPanel draftProspectGamesPanel">
              <div className="draftProspectPanelHeader">
                <h2>Career Games</h2>
                <span>*Excludes Trial Matches</span>
              </div>
              <div className="draftProspectGamesWrap">
                <table className="draftProspectGamesTable">
                  <thead>
                    <tr>
                      <th>Match Date</th>
                      <th>Team</th>
                      <th>Rating</th>
                      <th>Disposals</th>
                      <th>Kicks</th>
                      <th>Handballs</th>
                      <th>Marks</th>
                      <th>Goals</th>
                      <th>Behinds</th>
                      <th>Eq / Disp</th>
                      <th>Ball Winning</th>
                      <th>Defence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableGames.length ? (
                      tableGames.map((game) => {
                        const championGame = getChampionGame(game, championGamesByKey);
                        const rating = ratingForBasis(game, player, championGame, ageAdjustmentContext, selectedRatingBasis);
                        const ratingPerDisposal = safeDivide(rating, perFullTog(game.gameStats?.disposals, game));
                        const ratingPercentile = rating == null ? null : percentileFromCohort(rating, gameRatingCohortValues);
                        return (
                          <tr key={`${game.matchId}-${game.leagueCode}-${game.levelCode}`}>
                            <td>{formatDate(game.date)}</td>
                            <td>{game.team || "-"}</td>
                            <td
                              className="draftProspectRatingCell"
                              style={ratingPercentileStyle(ratingPercentile)}
                              title={ratingPercentile == null ? undefined : `${ordinal(ratingPercentile)} percentile rating`}
                            >
                              {formatNumber(rating, 2)}
                            </td>
                            <td>{formatNumber(game.gameStats?.disposals, 0)}</td>
                            <td>{formatNumber(game.gameStats?.kicks, 0)}</td>
                            <td>{formatNumber(game.gameStats?.handballs, 0)}</td>
                            <td>{formatNumber(game.gameStats?.marks, 0)}</td>
                            <td>{formatNumber(game.gameStats?.goals, 0)}</td>
                            <td>{formatNumber(game.gameStats?.behinds, 0)}</td>
                            <td>{formatNumber(ratingPerDisposal, 2)}</td>
                            <td>{formatNumber(championGame?.ballWinning, 1)}</td>
                            <td>{formatNumber(championGame?.defence, 1)}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={12}>No loaded career game rows found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        </>
      )}
    </main>
  );
}
