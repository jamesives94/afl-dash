const { BlobServiceClient } = require("@azure/storage-blob");
const Papa = require("papaparse");

const CURRENT_SEASON = 2026;
const RECENT_SEASON_WINDOW = 3;
const MIN_RECENT_SEASON = CURRENT_SEASON - (RECENT_SEASON_WINDOW - 1);

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
  "CD_player_stats_agg.csv",
  "comparable_players.csv"
]);

const RECENT_SEASON_FIELDS_BY_FILE = {
  "roster_players.csv": ["season"],
  "roster_players_aflw.csv": ["season"],
  "team_kpis.csv": ["season"],
  "team_kpis_aflw.csv": ["season"],
  "team_rank_timeseries.csv": ["year"],
  "team_rank_timeseries_aflw.csv": ["year"],
  "team_skill_radar.csv": ["season", "season.id"],
  "team_skill_radar_aflw.csv": ["season", "season.id"],
  "player_acquisition_breakdown.csv": ["Year"],
  "player_acquisition_breakdown_aflw.csv": ["Year"],
  "player_projections.csv": ["season"],
  "player_projections_aflw.csv": ["season"],
  "form_player_afl.csv": ["season"],
  "form_player_aflw.csv": ["season"],
  "form_player_vfl.csv": ["season"],
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
    const blobClient = containerClient.getBlobClient(file);

    const download = await blobClient.download();
    const csvText = await streamToString(download.readableStreamBody);

    const parsed = Papa.parse(csvText, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true
    });

    if (parsed.errors && parsed.errors.length) {
      context.res = { status: 500, body: { message: "CSV parse error", errors: parsed.errors } };
      return;
    }

    const rows = filterRecentRows(file, parsed.data);

    context.res = {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      },
      body: rows
    };
  } catch (err) {
    context.res = { status: 500, body: String(err?.stack || err) };
  }
};

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
