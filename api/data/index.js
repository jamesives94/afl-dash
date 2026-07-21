const { BlobServiceClient } = require("@azure/storage-blob");
const Papa = require("papaparse");

const CURRENT_SEASON = 2026;
const RECENT_SEASON_WINDOW = 3;
const MIN_RECENT_SEASON = CURRENT_SEASON - (RECENT_SEASON_WINDOW - 1);
const RESPONSE_CACHE_SECONDS = Number(process.env.DATA_RESPONSE_CACHE_SECONDS || 300);
const MEMORY_CACHE_MAX_ITEMS = Number(process.env.DATA_MEMORY_CACHE_MAX_ITEMS || 24);

const memoryCache = global.__DATA_API_MEMORY_CACHE__ || new Map();
global.__DATA_API_MEMORY_CACHE__ = memoryCache;

const ALLOWED_FILES = new Set([
  "roster_players.csv",
  "team_kpis.csv",
  "team_rank_timeseries.csv",
  "team_rank_timeseries_aflw.csv",
  "team_skill_radar.csv",
  "team_skill_radar_aflw.csv",
  "player_acquisition_breakdown.csv",
  "player_acquisition_breakdown_aflw.csv",
  "player_projections.csv",
  "player_projections_aflw.csv",
  "form_player_afl.csv",
  "form_player_aflw.csv",
  "form_player_vfl.csv",
  "roster_players_aflw.csv",
  "team_kpis_aflw.csv",
  "career_projections.csv",
  "career_projections_aflw.csv",
  "player_stats_wide_avg_aflw_sen_league3_level1_2019_to_2026.csv",
  "CD_player_stats_agg.csv",
  "comparable_players.csv",
  "team_dashboard_2026.json",
  "career_dashboard_2026.json",
  "league_trends.json",
  "second_tier_ratings_payload.json",
  "tier2_champion_ratings_2026.json"
]);

const RECENT_SEASON_FIELDS_BY_FILE = {
  "roster_players.csv": ["season"],
  "roster_players_aflw.csv": ["season"],
  "team_kpis.csv": ["season"],
  "team_kpis_aflw.csv": ["season"],
  // rank timeseries: no server-side filter — the chart needs full history
  // (10-year window is applied client-side after load)
  "team_skill_radar.csv": ["season", "season.id"],
  "team_skill_radar_aflw.csv": ["season", "season.id"],
  "player_acquisition_breakdown.csv": ["Year"],
  "player_acquisition_breakdown_aflw.csv": ["Year"],
  "player_projections.csv": ["season"],
  "player_projections_aflw.csv": ["season"],
  "form_player_afl.csv": ["season"],
  "form_player_aflw.csv": ["season"],
  "form_player_vfl.csv": ["season"],
  "player_stats_wide_avg_aflw_sen_league3_level1_2019_to_2026.csv": ["Season"],
};

module.exports = async function (context, req) {
  try {
    const apiKey = req.headers["x-data-key"];
    const expected = process.env.DATA_API_KEY;

    if (!expected) {
      context.res = { status: 500, body: "Server misconfigured: missing DATA_API_KEY" };
      return;
    }

    if (!apiKey || apiKey !== expected) {
      context.res = { status: 401, body: "Unauthorized" };
      return;
    }

    const file = (req.query.file || "").trim();
    if (!ALLOWED_FILES.has(file)) {
      context.res = { status: 400, body: "Invalid file" };
      return;
    }

    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = process.env.DATA_CONTAINER || "data";

    if (!conn) {
      context.res = { status: 500, body: "Server misconfigured: missing AZURE_STORAGE_CONNECTION_STRING" };
      return;
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(conn);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const league = String(req.query.league || "").trim().toLowerCase();
    const resolvedBlob = await resolveBlobClient(containerClient, file, league);
    const blobClient = resolvedBlob.blobClient;
    const blobName = resolvedBlob.blobName;
    const props = resolvedBlob.props;
    const cacheKey = [
      blobName,
      league,
      props.etag || "",
      props.lastModified ? props.lastModified.toISOString() : ""
    ].join("|");
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      cached.hits += 1;
      cached.lastAccessed = Date.now();
      context.res = buildJsonResponse(cached.body, props, "HIT", blobName);
      return;
    }

    const download = await blobClient.download();
    const rawText = await streamToString(download.readableStreamBody);
    let body;

    if (file.endsWith(".json")) {
      body = filterJsonPayload(blobName, rawText, { league });
      setMemoryCache(cacheKey, body);
      context.res = buildJsonResponse(body, props, "MISS", blobName);
      return;
    }

    const parsed = Papa.parse(rawText, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true
    });

    if (parsed.errors && parsed.errors.length) {
      context.res = { status: 500, body: { message: "CSV parse error", errors: parsed.errors } };
      return;
    }

    body = filterRecentRows(file, parsed.data);
    setMemoryCache(cacheKey, body);

    context.res = buildJsonResponse(body, props, "MISS", blobName);
  } catch (err) {
    context.res = { status: 500, body: String(err?.stack || err) };
  }
};

async function resolveBlobClient(containerClient, file, league) {
  if (file === "league_trends.json" && (league === "afl" || league === "aflw")) {
    const splitName = `league_trends_${league}.json`;
    const splitClient = containerClient.getBlobClient(splitName);
    try {
      const splitProps = await splitClient.getProperties();
      return { blobClient: splitClient, blobName: splitName, props: splitProps };
    } catch (err) {
      if (err?.statusCode && err.statusCode !== 404) throw err;
    }
  }

  const blobClient = containerClient.getBlobClient(file);
  const props = await blobClient.getProperties();
  return { blobClient, blobName: file, props };
}

function buildJsonResponse(body, props, cacheStatus, sourceFile) {
  const lastModified = props.lastModified ? props.lastModified.toUTCString() : undefined;
  return {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": `private, max-age=${RESPONSE_CACHE_SECONDS}`,
      "vary": "x-data-key",
      "etag": props.etag || "",
      "last-modified": lastModified || "",
      "x-file-last-modified": lastModified || "",
      "x-data-cache": cacheStatus,
      "x-data-source-file": sourceFile
    },
    body
  };
}

function setMemoryCache(cacheKey, body) {
  memoryCache.set(cacheKey, {
    body,
    hits: 0,
    createdAt: Date.now(),
    lastAccessed: Date.now()
  });

  if (memoryCache.size <= MEMORY_CACHE_MAX_ITEMS) return;

  const entries = Array.from(memoryCache.entries()).sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  while (entries.length && memoryCache.size > MEMORY_CACHE_MAX_ITEMS) {
    const [oldestKey] = entries.shift();
    memoryCache.delete(oldestKey);
  }
}

function filterJsonPayload(file, rawText, options) {
  if (file !== "league_trends.json") return rawText;

  const payload = JSON.parse(rawText);
  const league = options.league;
  if (!league || !payload?.leagues?.[league]) return payload;

  return {
    ...payload.leagues[league],
    selectedLeague: league
  };
}

function filterRecentRows(file, rows) {
  const seasonFields = RECENT_SEASON_FIELDS_BY_FILE[file];
  if (!seasonFields || !Array.isArray(rows)) return rows;

  return rows.filter((row) => {
    const season = extractSeasonValue(row, seasonFields);
    return season != null && season >= MIN_RECENT_SEASON && season <= CURRENT_SEASON;
  });
}

function extractSeasonValue(row, fields) {
  if (!row || typeof row !== "object") return null;
  for (const field of fields) {
    const raw = row[field];
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function streamToString(readable) {
  return new Promise((resolve, reject) => {
    if (!readable) return resolve("");
    const chunks = [];
    readable.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    readable.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    readable.on("error", reject);
  });
}
