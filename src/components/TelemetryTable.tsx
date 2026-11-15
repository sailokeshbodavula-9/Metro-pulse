import { useMemo, useState } from 'react';
import { ArrowUpDown, MapPin, Search } from 'lucide-react';
import type { TelemetryPoint } from '../types/telemetry';

interface TelemetryTableProps {
  vehicles: TelemetryPoint[];
  onInspectOnMap: (vehicle: TelemetryPoint) => void;
}

type StatusFilter = 'all' | 'nominal' | 'congested' | 'anomaly';
type SortField = 'vehicleId' | 'speed' | 'movingAvgSpeed' | 'speedDelta';

export function TelemetryTable({
  vehicles,
  onInspectOnMap,
}: TelemetryTableProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('speed');
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles
      .filter((v) => {
        if (statusFilter === 'anomaly' && !v.isAnomaly) return false;
        if (statusFilter === 'congested' && (v.isAnomaly || v.speed >= 22))
          return false;
        if (statusFilter === 'nominal' && (v.isAnomaly || v.speed < 22))
          return false;

        if (!q) return true;
        return (
          v.meta.vehicleId.toLowerCase().includes(q) ||
          v.meta.corridor.toLowerCase().includes(q) ||
          v.tileRoom.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'vehicleId') {
          diff = a.meta.vehicleId.localeCompare(b.meta.vehicleId);
        } else {
          diff = a[sortField] - b[sortField];
        }
        return sortAsc ? diff : -diff;
      });
  }, [vehicles, query, statusFilter, sortField, sortAsc]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0B0F17] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Visible Viewport Telemetry Stream
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Showing {filtered.length} of {vehicles.length} spatially subscribed
            vehicles updated every 500ms
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter vehicle, corridor, or tile..."
              className="pl-9 pr-3 py-1.5 text-xs bg-[#111827] border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60 w-64"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg">
            {(['all', 'nominal', 'congested', 'anomaly'] as StatusFilter[]).map(
              (tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusFilter(tab)}
                  className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === tab
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto mt-4 border border-slate-800 rounded-xl bg-[#111827]">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-[#161E2E] border-b border-slate-800 text-xs text-slate-400">
            <tr>
              <th className="py-2.5 px-4 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort('vehicleId')}
                  className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                >
                  Vehicle ID
                  <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="py-2.5 px-4 font-medium">Corridor</th>
              <th className="py-2.5 px-4 font-medium">State</th>
              <th className="py-2.5 px-4 font-medium text-right">
                <button
                  type="button"
                  onClick={() => toggleSort('speed')}
                  className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                >
                  Speed
                  <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="py-2.5 px-4 font-medium text-right">
                <button
                  type="button"
                  onClick={() => toggleSort('movingAvgSpeed')}
                  className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                >
                  Moving Avg
                  <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="py-2.5 px-4 font-medium text-right">
                <button
                  type="button"
                  onClick={() => toggleSort('speedDelta')}
                  className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                >
                  Delta
                  <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="py-2.5 px-4 font-medium">Spatial Tile Room</th>
              <th className="py-2.5 px-4 font-medium">Coordinates</th>
              <th className="py-2.5 px-4 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 text-xs">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="py-12 text-center text-slate-400 text-sm"
                >
                  No vehicles match the active viewport or filter criteria.
                </td>
              </tr>
            ) : (
              filtered.map((v) => {
                const stateLabel = v.isAnomaly
                  ? v.anomalyReason || 'Anomaly'
                  : v.speed < 22
                    ? 'Congested'
                    : 'Nominal';
                const stateColor = v.isAnomaly
                  ? 'text-red-400'
                  : v.speed < 22
                    ? 'text-amber-400'
                    : 'text-emerald-400';

                return (
                  <tr
                    key={v.meta.vehicleId}
                    className="hover:bg-slate-800/40 transition-colors h-10"
                  >
                    <td className="py-2 px-4 font-mono font-medium text-white">
                      {v.meta.vehicleId}
                    </td>
                    <td className="py-2 px-4 text-slate-300">
                      {v.meta.corridor} ·{' '}
                      <span className="text-slate-500">{v.meta.fleetType}</span>
                    </td>
                    <td className={`py-2 px-4 font-medium ${stateColor}`}>
                      {stateLabel}
                    </td>
                    <td className="py-2 px-4 font-mono text-right text-white">
                      {v.speed.toFixed(1)} km/h
                    </td>
                    <td className="py-2 px-4 font-mono text-right text-sky-400">
                      {v.movingAvgSpeed.toFixed(1)} km/h
                    </td>
                    <td
                      className={`py-2 px-4 font-mono text-right ${
                        v.speedDelta > 10
                          ? 'text-amber-400'
                          : v.speedDelta < -10
                            ? 'text-sky-300'
                            : 'text-slate-400'
                      }`}
                    >
                      {v.speedDelta >= 0 ? '+' : ''}
                      {v.speedDelta.toFixed(1)}
                    </td>
                    <td className="py-2 px-4 font-mono text-slate-400">
                      {v.tileRoom}
                    </td>
                    <td className="py-2 px-4 font-mono text-slate-400">
                      {v.location.coordinates[1].toFixed(4)},{' '}
                      {v.location.coordinates[0].toFixed(4)}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onInspectOnMap(v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-sky-300 hover:text-white hover:bg-sky-500/20 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        Locate
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
