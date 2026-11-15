import { AlertTriangle, MapPin } from 'lucide-react';
import type { AnomalyRecord } from '../types/telemetry';

interface AnomalyLogViewProps {
  anomalies: AnomalyRecord[];
  onLocateAnomaly: (record: AnomalyRecord) => void;
  onInjectAnomaly: () => void;
}

export function AnomalyLogView({
  anomalies,
  onLocateAnomaly,
  onInjectAnomaly,
}: AnomalyLogViewProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0B0F17] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Sliding-Window Anomaly Ledger
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time speeding and sudden-acceleration events persisted to the
            Time Series store
          </p>
        </div>

        <button
          type="button"
          onClick={onInjectAnomaly}
          className="px-4 py-2 text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Trigger Test Anomaly
        </button>
      </div>

      <div className="flex-1 overflow-auto mt-4 border border-slate-800 rounded-xl bg-[#111827]">
        {anomalies.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center px-4">
            <AlertTriangle className="w-8 h-8 text-slate-500 mb-3" />
            <p className="text-sm font-medium text-slate-200">
              No anomalies recorded yet
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-md">
              The sliding-window tracker monitors all vehicles every 500ms.
              Trigger a test anomaly or lower the speed threshold to observe
              real-time alerts.
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#161E2E] border-b border-slate-800 text-xs text-slate-400">
              <tr>
                <th className="py-2.5 px-4 font-medium">Timestamp</th>
                <th className="py-2.5 px-4 font-medium">Vehicle ID</th>
                <th className="py-2.5 px-4 font-medium">Corridor</th>
                <th className="py-2.5 px-4 font-medium">Trigger Reason</th>
                <th className="py-2.5 px-4 font-medium text-right">
                  Peak Speed
                </th>
                <th className="py-2.5 px-4 font-medium text-right">
                  Moving Avg
                </th>
                <th className="py-2.5 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {anomalies.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-slate-800/40 transition-colors h-10"
                >
                  <td className="py-2 px-4 font-mono text-slate-400">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="py-2 px-4 font-mono font-medium text-white">
                    {item.vehicleId}
                  </td>
                  <td className="py-2 px-4 text-slate-300">
                    {item.corridor} ·{' '}
                    <span className="text-slate-500">{item.fleetType}</span>
                  </td>
                  <td className="py-2 px-4 text-red-400 font-medium">
                    {item.reason}
                  </td>
                  <td className="py-2 px-4 font-mono text-right text-red-300 font-semibold">
                    {item.speed.toFixed(1)} km/h
                  </td>
                  <td className="py-2 px-4 font-mono text-right text-sky-400">
                    {item.movingAvgSpeed.toFixed(1)} km/h
                  </td>
                  <td className="py-2 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => onLocateAnomaly(item)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-sky-300 hover:text-white hover:bg-sky-500/20 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
