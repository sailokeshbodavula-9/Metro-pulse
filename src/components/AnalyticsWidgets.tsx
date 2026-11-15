import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bus,
  Clock,
  Database,
  Download,
  Fuel,
  Gauge,
  Info,
  Pause,
  Play,
  RefreshCw,
  Zap,
} from 'lucide-react';
import type {
  ActiveCityInfo,
  AnomalyRecord,
  FleetMetricsSnapshot,
  MongoAnalyticsSummary,
  TelemetryPoint,
} from '../types/telemetry';

function MiniSparkline({
  values,
  stroke,
}: {
  values: number[];
  stroke: string;
}) {
  const path = useMemo(() => {
    const pts = values.length >= 2 ? values : [0, 0];
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = Math.max(1, max - min);
    const w = 72;
    const h = 26;
    return pts
      .map((v, i) => {
        const x = (i / (pts.length - 1)) * w;
        const y = h - 3 - ((v - min) / span) * (h - 6);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values]);

  return (
    <svg viewBox="0 0 72 26" className="w-[72px] h-[26px] shrink-0 overflow-visible">
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TopKpiCards({
  metrics,
  metricsHistory,
  visibleVehicles,
}: {
  metrics: FleetMetricsSnapshot | null;
  metricsHistory: FleetMetricsSnapshot[];
  visibleVehicles: TelemetryPoint[];
}) {
  const totalVehicles = metrics?.totalFleet ?? visibleVehicles.length ?? 140;
  const avgSpeed = metrics?.avgFleetSpeed ?? 0;
  const activeAnomalies = metrics?.activeAnomalies ?? 0;

  // Derived operational fuel efficiency index based on smooth cruising vs overspeed/idling
  const efficiencyPct = useMemo(() => {
    if (visibleVehicles.length === 0) return 87.5;
    const optimal = visibleVehicles.filter(
      (v) => !v.isAnomaly && v.speed >= 22
    ).length;
    return Number((72 + (optimal / visibleVehicles.length) * 24).toFixed(1));
  }, [visibleVehicles]);

  const fleetSeries = metricsHistory.map((m) => m.totalFleet);
  const speedSeries = metricsHistory.map((m) => m.avgFleetSpeed);
  const anomalySeries = metricsHistory.map((m) => m.activeAnomalies);
  const effSeries = metricsHistory.map((m) =>
    Math.max(65, 96 - m.activeAnomalies * 0.6)
  );

  const prevSpeed =
    metricsHistory.length >= 2
      ? metricsHistory[metricsHistory.length - 2].avgFleetSpeed
      : avgSpeed;
  const speedDiffPct =
    prevSpeed > 0
      ? (((avgSpeed - prevSpeed) / prevSpeed) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {/* Total Vehicles */}
      <div className="bg-[#121720] border border-white/[0.08] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
            <Bus className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-400 truncate">Total Vehicles</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-semibold text-white font-mono">
                {totalVehicles}
              </span>
              <span className="text-xs font-mono text-emerald-400">
                {visibleVehicles.length} visible
              </span>
            </div>
          </div>
        </div>
        <MiniSparkline
          values={fleetSeries.length >= 2 ? fleetSeries : [136, 138, 140, 140]}
          stroke="#22c55e"
        />
      </div>

      {/* Avg Speed */}
      <div className="bg-[#121720] border border-white/[0.08] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
            <Gauge className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-400 truncate">Avg Speed</div>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-xl font-semibold text-white font-mono">
                {avgSpeed.toFixed(1)}
              </span>
              <span className="text-xs text-slate-400 font-mono">km/h</span>
              <span className="text-xs font-mono text-emerald-400 ml-1">
                {Number(speedDiffPct) >= 0 ? '↑' : '↓'}
                {Math.abs(Number(speedDiffPct))}%
              </span>
            </div>
          </div>
        </div>
        <MiniSparkline
          values={speedSeries.length >= 2 ? speedSeries : [44, 46, 47, 48.3]}
          stroke="#22c55e"
        />
      </div>

      {/* Active Anomalies */}
      <div className="bg-[#121720] border border-white/[0.08] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-red-500/15 border border-red-500/25 flex items-center justify-center text-red-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-400 truncate">
              Active Anomalies
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-semibold text-white font-mono">
                {activeAnomalies}
              </span>
              <span className="text-xs font-mono text-red-400">
                Limit {metrics?.speedLimitKmh ?? 68}
              </span>
            </div>
          </div>
        </div>
        <MiniSparkline
          values={anomalySeries.length >= 2 ? anomalySeries : [10, 12, 14, 16]}
          stroke="#ef4444"
        />
      </div>

      {/* Fleet / Fuel Efficiency */}
      <div className="bg-[#121720] border border-white/[0.08] rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-400 shrink-0">
            <Fuel className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-400 truncate">
              Route Efficiency
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-semibold text-white font-mono">
                {efficiencyPct}%
              </span>
              <span className="text-xs font-mono text-emerald-400">↑ 0.3%</span>
            </div>
          </div>
        </div>
        <MiniSparkline
          values={effSeries.length >= 2 ? effSeries : [85, 86, 87, 87.5]}
          stroke="#f59e0b"
        />
      </div>
    </div>
  );
}

export function BottomAnalyticsRow({
  visibleVehicles,
  metrics,
  metricsHistory,
  anomalies,
  onViewAllAlerts,
}: {
  visibleVehicles: TelemetryPoint[];
  metrics: FleetMetricsSnapshot | null;
  metricsHistory: FleetMetricsSnapshot[];
  anomalies: AnomalyRecord[];
  onViewAllAlerts: () => void;
}) {
  const { healthyCount, delayedCount, criticalCount, healthPct } =
    useMemo(() => {
      const total = visibleVehicles.length;
      if (total === 0) {
        return { healthyCount: 0, delayedCount: 0, criticalCount: 0, healthPct: 100 };
      }
      let healthy = 0;
      let delayed = 0;
      let critical = 0;
      for (const v of visibleVehicles) {
        if (v.isAnomaly) critical += 1;
        else if (v.speed < 22) delayed += 1;
        else healthy += 1;
      }
      return {
        healthyCount: healthy,
        delayedCount: delayed,
        criticalCount: critical,
        healthPct: Math.round(((healthy + delayed * 0.5) / total) * 100),
      };
    }, [visibleVehicles]);

  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference - (healthPct / 100) * circumference;

  const speedLimit = metrics?.speedLimitKmh ?? 68;
  const trendData = useMemo(() => {
    if (metricsHistory.length >= 2) return metricsHistory.slice(-24);
    return [];
  }, [metricsHistory]);

  const trendChart = useMemo(() => {
    const w = 280;
    const h = 92;
    const padX = 24;
    const padY = 12;
    const maxY = Math.max(85, speedLimit + 15);
    const plotW = w - padX - 8;
    const plotH = h - padY * 2;

    const toY = (val: number) =>
      padY + plotH - (Math.min(maxY, Math.max(0, val)) / maxY) * plotH;

    const linePath =
      trendData.length >= 2
        ? trendData
            .map((m, i) => {
              const x = padX + (i / (trendData.length - 1)) * plotW;
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${toY(m.avgFleetSpeed).toFixed(1)}`;
            })
            .join(' ')
        : '';

    const areaPath =
      linePath && trendData.length >= 2
        ? `${linePath} L${(padX + plotW).toFixed(1)},${(padY + plotH).toFixed(1)} L${padX},${(padY + plotH).toFixed(1)} Z`
        : '';

    return {
      w,
      h,
      padX,
      padY,
      plotW,
      plotH,
      maxY,
      thresholdY: toY(speedLimit),
      linePath,
      areaPath,
    };
  }, [trendData, speedLimit]);

  const alertCounts = useMemo(() => {
    let critical = 0;
    let sustained = 0;
    let accel = 0;
    for (const a of anomalies) {
      if (a.reason === 'Speeding Threshold') critical += 1;
      else if (a.reason === 'Sustained Overspeed') sustained += 1;
      else accel += 1;
    }
    return { critical, sustained, accel };
  }, [anomalies]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* 1. Fleet Health Donut Ring */}
      <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Fleet Health</h3>
          <span className="text-[11px] text-emerald-400 font-mono">
            {visibleVehicles.length} tracked
          </span>
        </div>

        <div className="flex items-center gap-5 my-2">
          <div className="relative w-24 h-24 shrink-0">
            <svg viewBox="0 0 92 92" className="w-24 h-24 -rotate-90">
              <circle
                cx="46"
                cy="46"
                r={radius}
                fill="none"
                stroke="#1e293b"
                strokeWidth="9"
              />
              <circle
                cx="46"
                cy="46"
                r={radius}
                fill="none"
                stroke="#22c55e"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeOffset}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-bold text-white font-mono">
                {healthPct}%
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Healthy
              </span>
              <span className="font-mono font-semibold text-white">
                {healthyCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Delayed
              </span>
              <span className="font-mono font-semibold text-white">
                {delayedCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-slate-300">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                Critical
              </span>
              <span className="font-mono font-semibold text-white">
                {criticalCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Speed Trend Live Chart */}
      <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Speed Trend</h3>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Avg Speed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 border-t border-dashed border-amber-400" />
              Threshold
            </span>
          </div>
        </div>

        <div className="mt-2">
          <svg
            viewBox={`0 0 ${trendChart.w} ${trendChart.h}`}
            className="w-full h-24 overflow-visible"
          >
            <defs>
              <linearGradient id="speedAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
            </defs>

            {[25, 50, 75].map((tick) => {
              const y =
                trendChart.padY +
                trendChart.plotH -
                (tick / trendChart.maxY) * trendChart.plotH;
              return (
                <g key={tick}>
                  <line
                    x1={trendChart.padX}
                    y1={y}
                    x2={trendChart.padX + trendChart.plotW}
                    y2={y}
                    stroke="#334155"
                    strokeOpacity="0.35"
                    strokeWidth="1"
                  />
                  <text
                    x={trendChart.padX - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-500 text-[9px] font-mono"
                  >
                    {tick}
                  </text>
                </g>
              );
            })}

            <line
              x1={trendChart.padX}
              y1={trendChart.thresholdY}
              x2={trendChart.padX + trendChart.plotW}
              y2={trendChart.thresholdY}
              stroke="#f59e0b"
              strokeWidth="1.2"
              strokeDasharray="4 3"
            />

            {trendChart.areaPath && (
              <path d={trendChart.areaPath} fill="url(#speedAreaGrad)" />
            )}
            {trendChart.linePath && (
              <path
                d={trendChart.linePath}
                fill="none"
                stroke="#22c55e"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </div>
      </div>

      {/* 3. Alerts Summary */}
      <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Alerts Summary</h3>
          <button
            type="button"
            onClick={onViewAllAlerts}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
          >
            View All
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mt-3">
          <button
            type="button"
            onClick={onViewAllAlerts}
            className="bg-[#171E2B] hover:bg-[#1C2434] border border-white/[0.06] rounded-lg p-3 flex flex-col items-center text-center transition-colors cursor-pointer"
          >
            <AlertTriangle className="w-4 h-4 text-red-400 mb-1.5" />
            <span className="text-lg font-bold text-white font-mono">
              {alertCounts.critical}
            </span>
            <span className="text-[11px] text-red-400 mt-0.5">Critical</span>
          </button>

          <button
            type="button"
            onClick={onViewAllAlerts}
            className="bg-[#171E2B] hover:bg-[#1C2434] border border-white/[0.06] rounded-lg p-3 flex flex-col items-center text-center transition-colors cursor-pointer"
          >
            <Clock className="w-4 h-4 text-amber-400 mb-1.5" />
            <span className="text-lg font-bold text-white font-mono">
              {delayedCount}
            </span>
            <span className="text-[11px] text-amber-400 mt-0.5">Delayed</span>
          </button>

          <button
            type="button"
            onClick={onViewAllAlerts}
            className="bg-[#171E2B] hover:bg-[#1C2434] border border-white/[0.06] rounded-lg p-3 flex flex-col items-center text-center transition-colors cursor-pointer"
          >
            <Info className="w-4 h-4 text-sky-400 mb-1.5" />
            <span className="text-lg font-bold text-white font-mono">
              {alertCounts.sustained + alertCounts.accel}
            </span>
            <span className="text-[11px] text-sky-400 mt-0.5">Sliding</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReportsView({
  activeCity,
  visibleVehicles,
  anomalies,
  metrics,
}: {
  activeCity: ActiveCityInfo;
  visibleVehicles: TelemetryPoint[];
  anomalies: AnomalyRecord[];
  metrics: FleetMetricsSnapshot | null;
}) {
  const [mongoSummary, setMongoSummary] = useState<MongoAnalyticsSummary | null>(
    null
  );
  const [loadingSummary, setLoadingSummary] = useState(false);

  const loadMongoSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const res = await fetch('/api/analytics/mongo-summary');
      if (res.ok) {
        const data = (await res.json()) as MongoAnalyticsSummary;
        setMongoSummary(data);
      }
    } catch {
      // Ignore transient network errors
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    void loadMongoSummary();
  }, [loadMongoSummary]);

  const downloadCsv = () => {
    const headers = [
      'timestamp',
      'vehicleId',
      'fleetType',
      'corridor',
      'lat',
      'lng',
      'speedKmh',
      'movingAvgKmh',
      'isAnomaly',
      'anomalyReason',
      'tileRoom',
    ];
    const rows = visibleVehicles.map((v) =>
      [
        v.timestamp,
        v.meta.vehicleId,
        v.meta.fleetType,
        `"${v.meta.corridor.replace(/"/g, '""')}"`,
        v.location.coordinates[1],
        v.location.coordinates[0],
        v.speed,
        v.movingAvgSpeed,
        v.isAnomaly,
        v.anomalyReason ?? '',
        v.tileRoom,
      ].join(',')
    );
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metropulse-${activeCity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      activeCity,
      metrics,
      visibleVehicles,
      recentAnomalies: anomalies,
      mongoSummary,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metropulse-snapshot-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-auto p-6 bg-[#0B0F17] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Fleet Telemetry Reports & Database Persistence
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Export Time Series snapshots, inspect MongoDB collections, and review corridor aggregation pipelines for{' '}
            {activeCity.name}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadMongoSummary()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#121720] border border-white/10 text-slate-200 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loadingSummary ? 'animate-spin' : ''}`}
            />
            Refresh DB Stats
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-emerald-500 text-slate-950 hover:bg-emerald-400 rounded-lg transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Viewport CSV
          </button>
          <button
            type="button"
            onClick={downloadJson}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#121720] border border-white/10 text-slate-200 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON Snapshot
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-slate-400">Active Sector</div>
          <div className="text-base font-semibold text-white mt-1">
            {activeCity.name}
          </div>
          <div className="text-xs text-slate-400 font-mono mt-1">
            {activeCity.lat.toFixed(4)}, {activeCity.lng.toFixed(4)}
          </div>
        </div>
        <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-slate-400">Total Stored Points</div>
          <div className="text-xl font-semibold text-white font-mono mt-1">
            {(metrics?.totalIngested ?? 0).toLocaleString()}
          </div>
          <div className="text-xs text-emerald-400 font-mono mt-1">
            {metrics?.writesPerSec ?? 0} docs/s throughput
          </div>
        </div>
        <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-4">
          <div className="text-xs text-slate-400">Recorded Anomalies</div>
          <div className="text-xl font-semibold text-red-400 font-mono mt-1">
            {anomalies.length}
          </div>
          <div className="text-xs text-slate-400 font-mono mt-1">
            Engine: {mongoSummary?.mongoConnected ? 'MongoDB Atlas / Cluster' : 'In-Memory Mirror (Ready for MONGO_URI)'}
          </div>
        </div>
      </div>

      {mongoSummary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Collections Overview */}
          <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">
                  MongoDB Collections & Indexes
                </h3>
              </div>
              <span className="text-[11px] font-mono text-emerald-400">
                {mongoSummary.collections.length} schemas active
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {mongoSummary.collections.map((col) => (
                <div
                  key={col.name}
                  className="bg-[#171E2B] border border-white/[0.06] rounded-lg p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-semibold text-white">
                      {col.name}
                    </span>
                    <span className="text-xs font-mono text-emerald-400">
                      {col.documents.toLocaleString()} docs
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    {col.purpose}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-1.5 truncate">
                    {col.indexes.join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Corridor Aggregation Pipeline */}
          <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">
                Corridor Speed & Anomaly Aggregation
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                $group by meta.corridor
              </span>
            </div>
            {mongoSummary.corridorHotspots.length === 0 ? (
              <div className="text-xs text-slate-400 py-8 text-center">
                Collecting corridor telemetry samples...
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-slate-400">
                      <th className="pb-2 font-medium">Corridor</th>
                      <th className="pb-2 font-medium text-right">Samples</th>
                      <th className="pb-2 font-medium text-right">Avg Speed</th>
                      <th className="pb-2 font-medium text-right">Anomalies</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {mongoSummary.corridorHotspots.map((row) => (
                      <tr key={row.corridor} className="hover:bg-white/[0.02]">
                        <td className="py-2 pr-2 text-slate-200 truncate max-w-[180px]">
                          {row.corridor}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-slate-300">
                          {row.telemetryCount}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-emerald-400">
                          {row.avgSpeedKmh.toFixed(1)} km/h
                        </td>
                        <td className="py-2 pl-2 text-right font-mono text-red-400">
                          {row.anomalyCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsView({
  fleetCount,
  speedLimitKmh,
  isPaused,
  showSpatialGrid,
  onToggleSpatialGrid,
  onUpdateConfig,
  onInjectAnomaly,
  onSelectCity,
}: {
  fleetCount: number;
  speedLimitKmh: number;
  isPaused: boolean;
  showSpatialGrid: boolean;
  onToggleSpatialGrid: () => void;
  onUpdateConfig: (patch: {
    vehicleCount?: number;
    speedLimitKmh?: number;
    isPaused?: boolean;
  }) => void;
  onInjectAnomaly: () => void;
  onSelectCity: (city: { name: string; lat: number; lng: number }) => void;
}) {
  const presets = [
    { name: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
    { name: 'Visakhapatnam, India', lat: 17.6868, lng: 83.2185 },
    { name: 'New York, NY', lat: 40.758, lng: -73.9855 },
    { name: 'London, UK', lat: 51.5074, lng: -0.1278 },
    { name: 'Tokyo, Japan', lat: 35.6762, lng: 139.765 },
    { name: 'Bengaluru, India', lat: 12.9716, lng: 77.5946 },
  ];

  return (
    <div className="flex-1 overflow-auto p-6 bg-[#0B0F17]">
      <div className="max-w-3xl space-y-6">
        <div className="pb-4 border-b border-white/[0.08]">
          <h2 className="text-lg font-semibold text-white">
            Telemetry Engine & Spatial Grid Settings
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Tune simulation density, anomaly detection sensitivity, and target
            urban region
          </p>
        </div>

        <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-5 space-y-5">
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-slate-200 font-medium">
                Simulated Fleet Size
              </span>
              <span className="font-mono text-emerald-400">
                {fleetCount} vehicles
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={300}
              step={10}
              value={fleetCount}
              onChange={(e) =>
                onUpdateConfig({ vehicleCount: Number(e.target.value) })
              }
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-slate-200 font-medium">
                Anomaly Speed Threshold
              </span>
              <span className="font-mono text-emerald-400">
                {speedLimitKmh} km/h
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={100}
              step={2}
              value={speedLimitKmh}
              onChange={(e) =>
                onUpdateConfig({ speedLimitKmh: Number(e.target.value) })
              }
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={() => onUpdateConfig({ isPaused: !isPaused })}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-emerald-500 text-slate-950 hover:bg-emerald-400 rounded-lg transition-colors cursor-pointer"
            >
              {isPaused ? (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Resume Telemetry
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Pause Telemetry
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onInjectAnomaly}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-amber-500/15 border border-amber-500/35 text-amber-200 hover:bg-amber-500/25 rounded-lg transition-colors cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              Inject Speeding Anomaly
            </button>

            <button
              type="button"
              onClick={onToggleSpatialGrid}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#171E2B] border border-white/10 text-slate-200 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
            >
              {showSpatialGrid
                ? 'Hide Spatial Tile Overlay'
                : 'Show Spatial Tile Overlay'}
            </button>
          </div>
        </div>

        <div className="bg-[#121720] border border-white/[0.08] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">
            Quick City Regions
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {presets.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onSelectCity(c)}
                className="px-3 py-2.5 text-left text-xs bg-[#171E2B] hover:bg-emerald-500/15 border border-white/[0.08] hover:border-emerald-500/35 rounded-lg transition-colors cursor-pointer"
              >
                <div className="font-medium text-white">{c.name}</div>
                <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                  {c.lat.toFixed(2)}, {c.lng.toFixed(2)}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
