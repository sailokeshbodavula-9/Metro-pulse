import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowUpDown,
  Bike,
  Bus,
  Car,
  Check,
  Copy,
  ExternalLink,
  Footprints,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Plus,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ActiveCityInfo,
  AiRoutePlanResponse,
  AiRouteSuggestion,
  GeocodeResult,
  RoutePriority,
  SavedPlace,
  TelemetryPoint,
  TravelMode,
} from '../types/telemetry';

interface StopDraft {
  id: string;
  query: string;
  coords: { lat: number; lng: number; label?: string } | null;
}

interface AiRoutePlannerProps {
  activeCity: ActiveCityInfo;
  selectedVehicle: TelemetryPoint | null;
  savedPlaces: SavedPlace[];
  routePlan: AiRoutePlanResponse | null;
  selectedRouteId: string | null;
  isGenerating: boolean;
  error: string | null;
  prefillOrigin: { query: string; lat?: number; lng?: number; ts: number } | null;
  prefillDestination: {
    query: string;
    lat?: number;
    lng?: number;
    ts: number;
  } | null;
  onGenerateRoutes: (params: {
    originQuery: string;
    destinationQuery: string;
    originCoords?: { lat: number; lng: number; label?: string } | null;
    destinationCoords?: { lat: number; lng: number; label?: string } | null;
    stops?: Array<{
      query: string;
      coords?: { lat: number; lng: number; label?: string } | null;
    }>;
    travelMode: TravelMode;
    priority: RoutePriority;
    userNotes: string;
  }) => void;
  onSelectRoute: (route: AiRouteSuggestion) => void;
  onStartNavigation: (route: AiRouteSuggestion) => void;
  onClearPlan: () => void;
  onPreviewOnMap?: () => void;
  compact?: boolean;
}

const TRAVEL_MODES: Array<{
  id: TravelMode;
  label: string;
  icon: typeof Car;
}> = [
  { id: 'driving', label: 'Drive', icon: Car },
  { id: 'transit', label: 'Transit', icon: Bus },
  { id: 'bicycling', label: 'Bike', icon: Bike },
  { id: 'walking', label: 'Walk', icon: Footprints },
];

const PRIORITIES: Array<{ id: RoutePriority; label: string }> = [
  { id: 'recommended', label: 'AI Balanced' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'avoid_anomalies', label: 'Bypass Alerts' },
  { id: 'eco', label: 'Eco-Steady' },
];

export function AiRoutePlanner({
  activeCity,
  selectedVehicle,
  savedPlaces,
  routePlan,
  selectedRouteId,
  isGenerating,
  error,
  prefillOrigin,
  prefillDestination,
  onGenerateRoutes,
  onSelectRoute,
  onStartNavigation,
  onClearPlan,
  onPreviewOnMap,
  compact = false,
}: AiRoutePlannerProps) {
  const [originQuery, setOriginQuery] = useState(activeCity.name);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [originCoords, setOriginCoords] = useState<{
    lat: number;
    lng: number;
    label?: string;
  } | null>({ lat: activeCity.lat, lng: activeCity.lng, label: activeCity.name });
  const [destinationCoords, setDestinationCoords] = useState<{
    lat: number;
    lng: number;
    label?: string;
  } | null>(null);
  const [stops, setStops] = useState<StopDraft[]>([]);

  const [travelMode, setTravelMode] = useState<TravelMode>('driving');
  const [priority, setPriority] = useState<RoutePriority>('recommended');
  const [userNotes, setUserNotes] = useState('');

  const [originSuggestions, setOriginSuggestions] = useState<GeocodeResult[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<GeocodeResult[]>([]);
  const [activeField, setActiveField] = useState<'origin' | 'dest' | null>(null);

  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [copiedRouteId, setCopiedRouteId] = useState<string | null>(null);

  useEffect(() => {
    setOriginQuery(activeCity.name);
    setOriginCoords({
      lat: activeCity.lat,
      lng: activeCity.lng,
      label: activeCity.name,
    });
  }, [activeCity.name, activeCity.lat, activeCity.lng]);

  useEffect(() => {
    if (!prefillOrigin) return;
    setOriginQuery(prefillOrigin.query);
    if (
      typeof prefillOrigin.lat === 'number' &&
      typeof prefillOrigin.lng === 'number'
    ) {
      setOriginCoords({
        lat: prefillOrigin.lat,
        lng: prefillOrigin.lng,
        label: prefillOrigin.query,
      });
    } else {
      setOriginCoords(null);
    }
  }, [prefillOrigin]);

  useEffect(() => {
    if (!prefillDestination) return;
    setDestinationQuery(prefillDestination.query);
    if (
      typeof prefillDestination.lat === 'number' &&
      typeof prefillDestination.lng === 'number'
    ) {
      setDestinationCoords({
        lat: prefillDestination.lat,
        lng: prefillDestination.lng,
        label: prefillDestination.query,
      });
    } else {
      setDestinationCoords(null);
    }
  }, [prefillDestination]);

  // Autocomplete for origin
  useEffect(() => {
    const q = originQuery.trim();
    if (activeField !== 'origin' || q.length < 2) {
      setOriginSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setOriginSuggestions(
          Array.isArray(data?.results) ? data.results.slice(0, 4) : []
        );
      } catch {
        setOriginSuggestions([]);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [originQuery, activeField]);

  // Autocomplete for destination
  useEffect(() => {
    const q = destinationQuery.trim();
    if (activeField !== 'dest' || q.length < 2) {
      setDestSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setDestSuggestions(
          Array.isArray(data?.results) ? data.results.slice(0, 4) : []
        );
      } catch {
        setDestSuggestions([]);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [destinationQuery, activeField]);

  const handleUseMyGps = () => {
    if (!navigator.geolocation) {
      setGpsError('Browser geolocation is unavailable.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const label = `My Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        setOriginQuery(label);
        setOriginCoords({ lat, lng, label: 'My Current Location' });
        setGpsLoading(false);
      },
      () => {
        setGpsError('Location permission denied or unavailable.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  };

  const handleUseSelectedVehicle = () => {
    if (!selectedVehicle) return;
    const label = `${selectedVehicle.meta.vehicleId} (${selectedVehicle.meta.corridor})`;
    setOriginQuery(label);
    setOriginCoords({
      lat: selectedVehicle.location.coordinates[1],
      lng: selectedVehicle.location.coordinates[0],
      label,
    });
  };

  const handleSwapEndpoints = () => {
    const nextOrigin = destinationQuery;
    const nextDest = originQuery;
    const nextOriginCoords = destinationCoords;
    const nextDestCoords = originCoords;
    setOriginQuery(nextOrigin);
    setDestinationQuery(nextDest);
    setOriginCoords(nextOriginCoords);
    setDestinationCoords(nextDestCoords);
  };

  const handleCopyGoogleLink = async (routeId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedRouteId(routeId);
      window.setTimeout(() => {
        setCopiedRouteId((curr) => (curr === routeId ? null : curr));
      }, 2000);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!originQuery.trim() || !destinationQuery.trim()) return;
    onGenerateRoutes({
      originQuery,
      destinationQuery,
      originCoords,
      destinationCoords,
      stops: stops
        .filter((s) => s.query.trim().length > 0)
        .map((s) => ({ query: s.query, coords: s.coords })),
      travelMode,
      priority,
      userNotes,
    });
  };

  const strategyLabel: Record<RoutePriority, string> = {
    recommended: 'AI Recommended',
    fastest: 'Fastest',
    avoid_anomalies: 'Anomaly Bypass',
    eco: 'Eco-Steady',
  };

  return (
    <div
      className={`flex flex-col min-h-0 ${
        compact ? 'flex-1 overflow-y-auto p-3.5 space-y-3.5' : 'space-y-4'
      }`}
    >
      {/* Route Query Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-[#121720] border border-white/[0.08] rounded-xl p-3.5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-white">
                AI Route Suggestions
              </h3>
              <p className="text-[11px] text-slate-400">
                Telemetry-aware routing + Google Maps handoff
              </p>
            </div>
          </div>
          {routePlan && (
            <button
              type="button"
              onClick={onClearPlan}
              title="Clear active route overlay"
              className="p-1 text-slate-400 hover:text-white rounded-md hover:bg-white/[0.06] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Origin Field */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="ai-route-origin"
              className="text-[11px] font-medium text-slate-300"
            >
              Origin
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleUseMyGps}
                disabled={gpsLoading}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 rounded cursor-pointer"
              >
                {gpsLoading ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                ) : (
                  <LocateFixed className="w-2.5 h-2.5" />
                )}
                My GPS
              </button>
              {selectedVehicle && (
                <button
                  type="button"
                  onClick={handleUseSelectedVehicle}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 rounded cursor-pointer"
                >
                  {selectedVehicle.meta.vehicleId}
                </button>
              )}
            </div>
          </div>

          <div className="relative">
            <MapPin className="w-3.5 h-3.5 text-emerald-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="ai-route-origin"
              type="text"
              value={originQuery}
              onFocus={() => setActiveField('origin')}
              onBlur={() => window.setTimeout(() => setActiveField(null), 160)}
              onChange={(e) => {
                setOriginQuery(e.target.value);
                setOriginCoords(null);
              }}
              placeholder="Address, landmark, city, or vehicle ID..."
              className="w-full pl-8 pr-8 py-2 text-xs bg-[#0B0F17] border border-white/10 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
            />
            <button
              type="button"
              onClick={handleSwapEndpoints}
              title="Swap origin & destination"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white cursor-pointer"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>

            {activeField === 'origin' && originSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 mt-1 bg-[#141A24] border border-white/10 rounded-lg shadow-2xl overflow-hidden z-30">
                {originSuggestions.map((item, idx) => (
                  <button
                    key={`${item.lat}-${item.lng}-${idx}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setOriginQuery(item.name);
                      setOriginCoords({
                        lat: item.lat,
                        lng: item.lng,
                        label: item.name,
                      });
                      setActiveField(null);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-white/[0.06] border-t first:border-t-0 border-white/[0.05] cursor-pointer"
                  >
                    <div className="text-xs font-medium text-white truncate">
                      {item.name}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {item.displayName}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {gpsError && (
            <p className="text-[11px] text-amber-400">{gpsError}</p>
          )}
        </div>

        {/* Intermediate Multi-Stop Waypoints */}
        {stops.length > 0 && (
          <div className="space-y-1.5">
            {stops.map((st, idx) => (
              <div key={st.id} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={st.query}
                  onChange={(e) => {
                    const val = e.target.value;
                    setStops((prev) =>
                      prev.map((item) =>
                        item.id === st.id
                          ? { ...item, query: val, coords: null }
                          : item
                      )
                    );
                  }}
                  placeholder={`Stop ${idx + 1} (address, landmark, or city)`}
                  className="flex-1 px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-white/10 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60"
                />
                <button
                  type="button"
                  onClick={() =>
                    setStops((prev) => prev.filter((item) => item.id !== st.id))
                  }
                  aria-label="Remove stop"
                  className="p-1.5 text-slate-400 hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Destination Field */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="ai-route-dest"
              className="text-[11px] font-medium text-slate-300"
            >
              Destination
            </label>
            {stops.length < 4 && (
              <button
                type="button"
                onClick={() =>
                  setStops((prev) => [
                    ...prev,
                    { id: `stop-${Date.now()}`, query: '', coords: null },
                  ])
                }
                className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-400 hover:text-sky-300 cursor-pointer"
              >
                <Plus className="w-2.5 h-2.5" />
                Add Stop
              </button>
            )}
          </div>
          <div className="relative">
            <Navigation className="w-3.5 h-3.5 text-red-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="ai-route-dest"
              type="text"
              value={destinationQuery}
              onFocus={() => setActiveField('dest')}
              onBlur={() => window.setTimeout(() => setActiveField(null), 160)}
              onChange={(e) => {
                setDestinationQuery(e.target.value);
                setDestinationCoords(null);
              }}
              placeholder="Where are you heading?"
              className="w-full pl-8 pr-3 py-2 text-xs bg-[#0B0F17] border border-white/10 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
            />

            {activeField === 'dest' && destSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 mt-1 bg-[#141A24] border border-white/10 rounded-lg shadow-2xl overflow-hidden z-30">
                {destSuggestions.map((item, idx) => (
                  <button
                    key={`${item.lat}-${item.lng}-${idx}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setDestinationQuery(item.name);
                      setDestinationCoords({
                        lat: item.lat,
                        lng: item.lng,
                        label: item.name,
                      });
                      setActiveField(null);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-white/[0.06] border-t first:border-t-0 border-white/[0.05] cursor-pointer"
                  >
                    <div className="text-xs font-medium text-white truncate">
                      {item.name}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {item.displayName}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {savedPlaces.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {savedPlaces.slice(0, 4).map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => {
                    setDestinationQuery(sp.label);
                    setDestinationCoords({
                      lat: sp.lat,
                      lng: sp.lng,
                      label: sp.label,
                    });
                  }}
                  className="px-2 py-0.5 text-[10px] rounded bg-[#0B0F17] border border-white/10 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300 cursor-pointer"
                >
                  {sp.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Travel Mode & Priority */}
        <div className="grid grid-cols-4 gap-1.5">
          {TRAVEL_MODES.map((m) => {
            const Icon = m.icon;
            const active = travelMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setTravelMode(m.id)}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                  active
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-[#0B0F17] border-white/[0.07] text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3 h-3" />
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {PRIORITIES.map((p) => {
            const active = priority === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPriority(p.id)}
                className={`py-1.5 px-2.5 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                  active
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                    : 'bg-[#0B0F17] border-white/[0.07] text-slate-400 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <input
          type="text"
          value={userNotes}
          onChange={(e) => setUserNotes(e.target.value)}
          placeholder="Optional notes (e.g. avoid highways, EV stop)..."
          className="w-full px-3 py-1.5 text-xs bg-[#0B0F17] border border-white/10 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
        />

        <button
          type="submit"
          disabled={
            isGenerating || !originQuery.trim() || !destinationQuery.trim()
          }
          className="w-full py-2.5 px-4 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Analyzing Telemetry & Routes...
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              Suggest AI Routes + Google Maps
            </>
          )}
        </button>
      </form>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-start gap-2 text-xs text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">{error}</div>
        </div>
      )}

      {/* AI Route Suggestions Results */}
      {routePlan && (
        <div className="space-y-3">
          {/* Executive Traffic Brief */}
          <div className="bg-[#121720] border border-emerald-500/25 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-emerald-400 inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Live Mobility Brief
              </span>
              <a
                href={routePlan.googleMapsOverviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300"
              >
                Google Maps Trip
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {routePlan.trafficBrief}
            </p>
            <div className="text-[11px] font-mono text-slate-400 truncate">
              {routePlan.origin.name} → {routePlan.destination.name}
            </div>
          </div>

          {/* Route Option Cards */}
          {routePlan.routes.map((route) => {
            const isSelected = route.id === selectedRouteId;
            return (
              <div
                key={route.id}
                onClick={() => onSelectRoute(route)}
                className={`rounded-xl p-3.5 border transition-colors cursor-pointer space-y-2.5 ${
                  isSelected
                    ? 'bg-emerald-500/[0.08] border-emerald-500/50'
                    : 'bg-[#121720] border-white/[0.08] hover:border-white/20'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                        {strategyLabel[route.strategy]}
                      </span>
                      <span
                        className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                          route.riskLevel === 'low'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : route.riskLevel === 'moderate'
                              ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                              : 'bg-red-500/10 text-red-300 border-red-500/20'
                        }`}
                      >
                        {route.riskLevel} risk
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-white mt-1.5">
                      {route.title}
                    </h4>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold font-mono text-white">
                      {route.durationMin} min
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {route.distanceKm} km · {route.estimatedAvgSpeedKmh} km/h
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {route.summary}
                </p>

                {route.corridorsUsed.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {route.corridorsUsed.map((c) => (
                      <span
                        key={c}
                        className="px-2 py-0.5 text-[10px] bg-white/[0.04] border border-white/[0.07] rounded text-slate-300"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                {route.avoidedHotspots.length > 0 && (
                  <div className="text-[10px] text-amber-300/90">
                    Bypasses: {route.avoidedHotspots.join(', ')}
                  </div>
                )}

                {route.turnHints.length > 0 && (
                  <ul className="space-y-1 pt-1 border-t border-white/[0.06]">
                    {route.turnHints.slice(0, 3).map((hint, idx) => (
                      <li
                        key={idx}
                        className="text-[11px] text-slate-400 flex items-start gap-1.5"
                      >
                        <RouteIcon className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{hint}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {route.waypoints.length > 0 && (
                  <div className="pt-1 border-t border-white/[0.06] space-y-1">
                    <div className="text-[10px] font-medium text-slate-400">
                      Suggested Waypoints
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {route.waypoints.map((wp, idx) => (
                        <a
                          key={idx}
                          href={`https://www.google.com/maps/search/?api=1&query=${wp.lat},${wp.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={wp.note}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[#0B0F17] hover:bg-sky-500/15 border border-white/10 hover:border-sky-500/40 rounded text-sky-300 transition-colors"
                        >
                          <MapPin className="w-2.5 h-2.5" />
                          {wp.name}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Turn-by-Turn Start Nav + Google Maps Handoff */}
                <div className="flex items-center gap-1.5 pt-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRoute(route);
                      onStartNavigation(route);
                    }}
                    className="flex-1 py-2 px-2.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    Start Nav
                  </button>

                  <a
                    href={route.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 py-2 px-2.5 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Google Maps
                  </a>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCopyGoogleLink(route.id, route.googleMapsUrl);
                    }}
                    title="Copy Google Maps share link"
                    className="p-2 rounded-lg bg-[#0B0F17] border border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                  >
                    {copiedRouteId === route.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {onPreviewOnMap && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRoute(route);
                        onPreviewOnMap();
                      }}
                      title="Preview route on live telemetry map"
                      className="px-2 py-2 rounded-lg text-[11px] font-medium bg-[#0B0F17] border border-white/10 text-emerald-300 hover:bg-emerald-500/15 cursor-pointer"
                    >
                      Map
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
