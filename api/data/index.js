const { BlobServiceClient } = require("@azure/storage-blob");
const Papa = require("papaparse");

const ALLOWED_FILES = new Set([
  "roster_players.csv",
  "team_kpis.csv",
  "team_rank_timeseries.csv",
  "team_skill_radar.csv",
  "player_acquisition_breakdown.csv",
  "player_projections.csv",
  "form_player_afl.csv",
  "form_player_vfl.csv",
  "career_projections.csv",
  "CD_player_stats_agg.csv"
]);

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

    context.res = {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      },
      body: parsed.data
    };
  } catch (err) {
    context.res = { status: 500, body: String(err?.stack || err) };
  }
};

function streamToString(readable) {
  return new Promise((resolve, reject) => {
    if (!readable) return resolve("");
    const chunks = [];
    readable.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    readable.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    readable.on("error", reject);
  });
}
