// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Activity, Search, SlidersHorizontal } from "lucide-react";
import { loadApiData } from "./lib/loadApiData";
import "./LeagueTrendsDashboard.css";

const FIXED_Y_SCALES = {
  points_from_cb: {
    domain: [0.1, 0.2],
    ticks: [0.1, 0.12, 0.14, 0.16, 0.18, 0.2],
  },
};

const LEAGUE_ROLLING_WINDOW = 54;
const TEAM_ROLLING_WINDOW = 7;
const LEAGUE_LINE_COLOR = "#4169e1";
const POST_2026_LINE_COLOR = "#dc2626";
const LEAGUE_REFERENCE_COLOR = "#6f7680";

const TEAM_PRIMARY_COLORS = {
  ADEL: "#002b5c",
  BL: "#7c003e",
  CARL: "#031a40",
  COLL: "#111111",
  ESS: "#cc2031",
  FREM: "#2a0a5e",
  GCS: "#e21e2b",
  GEEL: "#002b5c",
  GWS: "#f15b22",
  HAW: "#4d2004",
  MELB: "#061a40",
  NM: "#005cab",
  PA: "#00a0b0",
  RICH: "#fdb515",
  STK: "#ed1b2f",
  SYD: "#e1251b",
  WB: "#0057b8",
  WCE: "#003087",
};

function SeasonLineLabel({ viewBox }) {
  if (!viewBox) return null;
  const x = (viewBox.x ?? 0) + 5;
  const y = (viewBox.y ?? 0) + 12;
  return (
    <text x={x} y={y} fill="#9a6b00" fontSize={10} fontWeight={760} textAnchor="start">
      2026
    </text>
  );
}

function formatValue(value, format = "number", fallback = "NA") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return fallback;
  const numeric = Number(value);
  if (format === "percent") return `${(numeric * 100).toFixed(1)}%`;
  if (format === "ratio") return numeric.toFixed(2);
  return numeric.toFixed(1);
}

function formatDiff(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "NA";
  const prefix = Number(value) > 0 ? "+" : "";
  return `${prefix}${Number(value).toFixed(1)}%`;
}

function roundedStep(range) {
  if (range >= 100) return 100;
  if (range >= 10) return 10;
  if (range >= 1) return 1;
  return 0.1;
}

function roundedRollingScale(points, metric) {
  const fixedScale = FIXED_Y_SCALES[metric.id];
  if (fixedScale) return fixedScale;
  const format = metric.format;
  const scale = format === "percent" ? 100 : 1;
  const values = points
    .map((point) => point.rolling)
    .filter((value) => Number.isFinite(Number(value)))
    .map((value) => Number(value) * scale);
  if (!values.length) return { domain: ["auto", "auto"], ticks: undefined };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const pad = spread > 0 ? spread * 0.1 : Math.max(Math.abs(max) * 0.1, 1);
  const rawMin = min - pad;
  const rawMax = max + pad;
  const step = roundedStep(rawMax - rawMin);
  const roundedMin = Math.floor(rawMin / step) * step;
  const roundedMax = Math.ceil(rawMax / step) * step;
  const ticks = [];
  for (let value = roundedMin; value <= roundedMax + step / 2; value += step) {
    ticks.push(Number((value / scale).toFixed(4)));
  }
  return { domain: [roundedMin / scale, roundedMax / scale], ticks };
}

function rollingPoints(points, window) {
  const queue = [];
  let total = 0;
  return points.map((point) => {
    const value = Number(point.value);
    if (!Number.isFinite(value)) {
      return { ...point, rolling: null };
    }
    queue.push(value);
    total += value;
    while (queue.length > window) {
      total -= queue.shift();
    }
    return { ...point, rolling: total / queue.length };
  });
}

function seasonAveragePoints(points) {
  const totals = new Map();
  points.forEach((point) => {
    const value = Number(point.value);
    if (!Number.isFinite(value)) return;
    const current = totals.get(point.season) ?? { total: 0, count: 0 };
    totals.set(point.season, {
      total: current.total + value,
      count: current.count + 1,
    });
  });
  return points.map((point) => {
    const total = totals.get(point.season);
    return {
      ...point,
      rolling: total?.count ? total.total / total.count : null,
    };
  });
}

function trendPoints(points, trendMode, rollingWindow) {
  if (trendMode === "season") return seasonAveragePoints(points);
  return rollingPoints(points, rollingWindow);
}

function TrendTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const primaryPayload = payload.find((item) => item?.payload?.series !== "league") ?? payload[0];
  const point = primaryPayload?.payload;
  const metric = primaryPayload?.payload?.metric;
  if (!point) return null;

  return (
    <div className="tooltip">
      <div className="tooltip-title">{point.matchDate || `Match ${point.matchIndex}`}</div>
      {point.squadName && <div>{point.squadName}</div>}
      <div>{point.round} · {point.season}</div>
      <div>{point.fixture}</div>
      <div>Match value: <strong>{formatValue(point.value, metric?.format)}</strong></div>
      <div>{metric?.rollingLabel}: <strong>{formatValue(point.rolling, metric?.format)}</strong></div>
    </div>
  );
}

function TrendCard({ metric, trendMode, isEmbed = false }) {
  const primaryLineColor = metric.selectedSquadCode
    ? TEAM_PRIMARY_COLORS[metric.selectedSquadCode] ?? LEAGUE_LINE_COLOR
    : LEAGUE_LINE_COLOR;
  const gradientId = `trend-area-${metric.id}`;
  const rollingWindow = metric.selectedSquadCode ? TEAM_ROLLING_WINDOW : LEAGUE_ROLLING_WINDOW;
  const rollingLabel = trendMode === "season"
    ? "Season Avg"
    : metric.selectedSquadCode ? "Last 7 matches" : "Last 6 weeks";
  const metricWithRollingLabel = useMemo(
    () => ({ ...metric, rollingLabel }),
    [metric, rollingLabel],
  );
  const points = useMemo(
    () => trendPoints(metric.points, trendMode, rollingWindow).map((point) => ({
      ...point,
      metric: metricWithRollingLabel,
      series: "primary",
    })),
    [metric.points, metricWithRollingLabel, rollingWindow, trendMode],
  );
  const leaguePoints = useMemo(
    () => trendPoints(metric.leaguePoints ?? [], trendMode, rollingWindow).map((point) => ({
      ...point,
      metric: metricWithRollingLabel,
      series: "league",
    })),
    [metric.leaguePoints, metricWithRollingLabel, rollingWindow, trendMode],
  );
  const leagueChartPoints = useMemo(
    () => trendMode === "season" ? leaguePoints : leaguePoints.slice(rollingWindow - 1),
    [leaguePoints, rollingWindow, trendMode],
  );
  const chartPoints = useMemo(() => {
    const leagueRollingByIndex = new Map(
      leagueChartPoints.map((point) => [point.matchIndex, point.rolling]),
    );
    const visiblePoints = trendMode === "season" ? points : points.slice(rollingWindow - 1);
    return visiblePoints.map((point) => ({
      ...point,
      leagueRolling: leagueRollingByIndex.get(point.matchIndex) ?? null,
    }));
  }, [points, leagueChartPoints, rollingWindow, trendMode]);
  const seasonTicks = useMemo(() => {
    const firstIndexBySeason = new Map();
    chartPoints.forEach((point) => {
      if (!firstIndexBySeason.has(point.season)) {
        firstIndexBySeason.set(point.season, point.matchIndex);
      }
    });
    return Array.from(firstIndexBySeason.values());
  }, [chartPoints]);
  const seasonByTick = useMemo(() => {
    const lookup = new Map();
    chartPoints.forEach((point) => {
      if (!lookup.has(point.season)) {
        lookup.set(point.matchIndex, String(point.season).slice(-2));
      }
    });
    return lookup;
  }, [chartPoints]);
  const start2026 = useMemo(
    () => chartPoints.find((point) => point.season === 2026)?.matchIndex,
    [chartPoints],
  );
  const yScale = useMemo(
    () => roundedRollingScale([...chartPoints, ...leagueChartPoints], metric),
    [chartPoints, leagueChartPoints, metric],
  );
  const latest = chartPoints[chartPoints.length - 1];

  return (
    <section className="trend-card">
      <div className="chart-wrap">
        <div className="card-title-row">
          <h2>{metric.label}</h2>
        </div>
        <ResponsiveContainer width="100%" height={isEmbed ? 220 : 250}>
          <ComposedChart data={chartPoints} margin={{ top: 8, right: 8, bottom: 18, left: 4 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={primaryLineColor} stopOpacity={0.18} />
                <stop offset="70%" stopColor={primaryLineColor} stopOpacity={0.04} />
                <stop offset="100%" stopColor={primaryLineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#ececec" vertical={false} />
            <XAxis
              dataKey="matchIndex"
              type="number"
              domain={["dataMin", "dataMax"]}
              ticks={seasonTicks}
              tick={{ fill: "#777", fontSize: 10 }}
              axisLine={{ stroke: "#f2f2f2" }}
              tickLine={false}
              interval={0}
              minTickGap={0}
              tickFormatter={(value) => seasonByTick.get(value) ?? ""}
            />
            <YAxis
              dataKey="rolling"
              tick={{ fill: "#777", fontSize: 11 }}
              axisLine={{ stroke: "#f2f2f2" }}
              tickLine={false}
              width={42}
              tickFormatter={(value) => formatValue(value, metric.format).replace("%", "")}
              domain={yScale.domain}
              ticks={yScale.ticks}
              allowDataOverflow={false}
            />
            <Tooltip content={<TrendTooltip />} />
            {start2026 && (
              <ReferenceLine
                x={start2026}
                stroke="#9a6b00"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={<SeasonLineLabel />}
              />
            )}
            {leagueChartPoints.length > 0 && (
              <Line
                type="monotone"
                dataKey="leagueRolling"
                stroke={LEAGUE_REFERENCE_COLOR}
                strokeOpacity={0.5}
                strokeWidth={3}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}
            <Area
              type="monotone"
              dataKey="rolling"
              stroke="none"
              fill={`url(#${gradientId})`}
              fillOpacity={1}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey={(point) => point.season < 2026 ? point.rolling : null}
              stroke={primaryLineColor}
              strokeWidth={3}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey={(point) => point.season >= 2026 ? point.rolling : null}
              stroke={POST_2026_LINE_COLOR}
              strokeWidth={3}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
        {latest && (
          <div className="latest-note">
            {rollingLabel}: <strong>{formatValue(latest.rolling, metric.format)}</strong>
          </div>
        )}
      </div>
      <aside className="stat-panel">
        <div className="metric">
          <span>{metric.previousSeason} Avg</span>
          <strong className="previous-value">{formatValue(metric.previousAverage, metric.format)}</strong>
        </div>
        <div className="metric">
          <span>{metric.currentSeason} Avg</span>
          <strong className="current-value">{formatValue(metric.currentAverage, metric.format)}</strong>
        </div>
        <div className="metric">
          <span>Difference</span>
          <strong className={Number(metric.pctDifference) >= 0 ? "up-value" : "down-value"}>
            {formatDiff(metric.pctDifference)}
          </strong>
        </div>
      </aside>
    </section>
  );
}

export default function LeagueTrendsDashboard() {
  const [leagueFilter, setLeagueFilter] = useState(() => {
    const league = new URLSearchParams(window.location.search).get("league")?.toLowerCase();
    return league === "aflw" ? "aflw" : "afl";
  });
  const [payloadsByLeague, setPayloadsByLeague] = useState({});
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [trendMode, setTrendMode] = useState("rolling");
  const [squadFilter, setSquadFilter] = useState("All squads");
  const isEmbed = useMemo(
    () => new URLSearchParams(window.location.search).get("embed") === "1",
    [],
  );

  useEffect(() => {
    if (payloadsByLeague[leagueFilter]) return;

    let cancelled = false;
    setLoadError(null);
    loadApiData("league_trends.json", { league: leagueFilter })
      .then((payload) => {
        if (cancelled) return;
        setPayloadsByLeague((current) => ({
          ...current,
          [leagueFilter]: payload,
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load league trends", error);
        setLoadError(error);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueFilter, payloadsByLeague]);

  const activePayload = useMemo(
    () => payloadsByLeague[leagueFilter] ?? null,
    [payloadsByLeague, leagueFilter],
  );

  useEffect(() => {
    setSquadFilter("All squads");
  }, [leagueFilter]);

  const cards = useMemo(() => {
    const metrics = activePayload?.metrics ?? [];
    const scopedMetrics = metrics.map((metric) => {
      if (squadFilter === "All squads") return metric;
      const squadMetric = metric.squads?.[squadFilter];
      return {
        ...metric,
        leaguePoints: metric.points,
        selectedSquadCode: squadFilter,
        points: squadMetric?.points ?? [],
        currentSeason: squadMetric?.currentSeason ?? null,
        previousSeason: squadMetric?.previousSeason ?? null,
        currentAverage: squadMetric?.currentAverage ?? null,
        previousAverage: squadMetric?.previousAverage ?? null,
        pctDifference: squadMetric?.pctDifference ?? null,
      };
    });
    return scopedMetrics;
  }, [activePayload, squadFilter]);

  const filtered = cards.filter((card) => {
    const matchesQuery = card.label.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery;
  });

  return (
    <main className={isEmbed ? "leagueTrendsDashboard embed-mode" : "leagueTrendsDashboard"}>
      <header className="app-header">
        <div>
          <h1>AFL League Trends</h1>
        </div>
      </header>

      <section className="filter-bar" aria-label="Trend filters">
        <label className="filter-field search-box">
          <span>Search</span>
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search stat"
          />
        </label>
        <label className="filter-field select-box">
          <span>Trend</span>
          <SlidersHorizontal size={16} />
          <select value={trendMode} onChange={(event) => setTrendMode(event.target.value)}>
            <option value="rolling">
              {squadFilter === "All squads" ? "Last 54 matches" : "Last 7 matches"}
            </option>
            <option value="season">Season average</option>
          </select>
        </label>
        <label className="filter-field select-box league-select">
          <span>League</span>
          <Activity size={16} />
          <select value={leagueFilter} onChange={(event) => setLeagueFilter(event.target.value)}>
            <option value="afl">AFL</option>
            <option value="aflw">AFLW</option>
          </select>
        </label>
        <label className="filter-field select-box squad-select">
          <span>Squad</span>
          <Activity size={16} />
          <select value={squadFilter} onChange={(event) => setSquadFilter(event.target.value)}>
            <option>All squads</option>
            {(activePayload?.teams ?? []).map((team) => (
              <option key={team.code} value={team.code}>{team.name}</option>
            ))}
          </select>
        </label>
      </section>

      {loadError ? (
        <div className="league-trends-status">Unable to load league trends.</div>
      ) : !activePayload ? (
        <div className="league-trends-status">Loading league trends...</div>
      ) : (
        <div className="chart-grid">
          {filtered.map((card) => (
            <TrendCard key={card.id} metric={card} trendMode={trendMode} isEmbed={isEmbed} />
          ))}
        </div>
      )}
    </main>
  );
}
