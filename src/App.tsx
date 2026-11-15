import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  ChevronDown,
  Compass,
  FileText,
  Home,
  Map as MapIcon,
  Pause,
  Play,
  Search,
  Settings,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { AiRoutePlanner } from './components/AiRoutePlanner';
import {
  BottomAnalyticsRow,
  ReportsView,
  SettingsView,
  TopKpiCards,
} from './components/AnalyticsWidgets';
import { AnomalyLogView } from './components/AnomalyLogView';
import { ExploreAndHazardsPanel } from './components/ExploreAndHazardsPanel';
import { FleetMap, type MapVehicleFilter } from './components/FleetMap';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallBanner';
import { TelemetryTable } from './components/TelemetryTable';
import { useFleetSocket } from './hooks/useFleetSocket';
import { useLiveGps } from './hooks/useLiveGps';
import { useSavedPlaces } from './hooks/useSavedPlaces';
import { apiUrl } from './utils/api';
import { geocodeDirectNominatim } from './utils/clientFallbackEngine';
import type {
  AiRoutePlanResponse,
  AiRouteSuggestion,
  AnomalyRecord,
  BoundingBox,
  DroppedPinInfo,
  GeocodeResult,
  IncidentType,
  MapBasemapTheme,
  PoiCategory,
  PoiPlace,
  RoutePriority,
  TelemetryPoint,
  TravelMode,
} from './types/telemetry';

type NavSection =
  | 'dashboard'
  | 'map'
  | 'routes'
  | 'explore'
  | 'analytics'
  | 'alerts'
  | 'reports'
  | 'settings';

type RightTab = 'overview' | 'routes' | 'explore' | 'vehicles' | 'alerts';

const CITY_QUICK_SWITCH = [
  { name: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
  { name: 'Visakhapatnam, India', lat: 17.6868, lng: 83.2185 },
  { name: 'New York, NY', lat: 40.758, lng: -73.9855 },
  { name: 'London, UK', lat: 51.5074, lng: -0.1278 },
  { name: 'Tokyo, Japan', lat: 35.6762, lng: 139.765 },
  { name: 'Bengaluru, India', lat: 12.9716, lng: 77.5946 },
];

export default function App() {
  const {
    connectionState,
    isEdgeFallback,
    visibleVehicles,
    subscribedTiles,
    spatialMode,
    activeCity,
    metrics,
    metricsHistory,
    anomalies,
    incidents,
    watchedTrip,
    bandwidthSavedPct,
    selectedVehicle,
    setSelectedVehicleId,
    selectedHistory,
    followedVehicleId,
    toggleFollow,
    updateViewport,
    setFallbackCity,
    updateFallbackConfig,
    injectFallbackAnomaly,
    joinTrip,
    leaveTrip,
    publishTripPosition,
  } = useFleetSocket();

  const {
    savedPlaces,
    tripHistory,
    cachedRoutePlan,
    savePlace,
    removePlace,
    recordTrip,
    clearTripHistory,
    cacheRoutePlan,
  } = useSavedPlaces();

  const {
    gpsStatus,
    gpsPosition,
    gpsFollow,
    setGpsFollow,
    gpsError,
    startGps,
    stopGps,
  } = useLiveGps();

  const [navSection, setNavSection] = useState<NavSection>('dashboard');
  const [rightTab, setRightTab] = useState<RightTab>('overview');
  const [showSpatialGrid, setShowSpatialGrid] = useState(false);
  const [vehicleFilter, setVehicleFilter] = useState<MapVehicleFilter>('all');
  const [basemapTheme, setBasemapTheme] = useState<MapBasemapTheme>('dark');
  const [cityMenuOpen, setCityMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const [flyToTarget, setFlyToTarget] = useState<{
    lng: number;
    lat: number;
    ts: number;
  } | null>(null);

  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({
    lat: activeCity.lat,
    lng: activeCity.lng,
  });

  const [fleetCountDraft, setFleetCountDraft] = useState<number | null>(null);
  const [speedLimitDraft, setSpeedLimitDraft] = useState<number | null>(null);

  // Global search (matches both live vehicles & worldwide cities)
  const [searchQuery, setSearchQuery] = useState('');
  const [geoResults, setGeoResults] = useState<GeocodeResult[]>([]);
  const [isSearchingGeo, setIsSearchingGeo] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  // AI Route Suggestions & Navigation state
  const [routePlan, setRoutePlan] = useState<AiRoutePlanResponse | null>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? cachedRoutePlan : null
  );
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [isGeneratingRoutes, setIsGeneratingRoutes] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [navigatingRoute, setNavigatingRoute] =
    useState<AiRouteSuggestion | null>(null);
  const [routePrefillOrigin, setRoutePrefillOrigin] = useState<{
    query: string;
    lat?: number;
    lng?: number;
    ts: number;
  } | null>(null);
  const [routePrefillDestination, setRoutePrefillDestination] = useState<{
    query: string;
    lat?: number;
    lng?: number;
    ts: number;
  } | null>(null);

  // Nearby POIs & Click-anywhere dropped pin state
  const [pois, setPois] = useState<PoiPlace[]>([]);
  const [activePoiCategory, setActivePoiCategory] =
    useState<PoiCategory | null>(null);
  const [poisLoading, setPoisLoading] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<PoiPlace | null>(null);
  const [droppedPin, setDroppedPin] = useState<DroppedPinInfo | null>(null);
  const [droppingPinLoading, setDroppingPinLoading] = useState(false);

  const latestBboxRef = useRef<BoundingBox | null>(null);

  const handleViewportChange = useCallback(
    (bbox: BoundingBox) => {
      latestBboxRef.current = bbox;
      updateViewport(bbox);
    },
    [updateViewport]
  );

  // Restore cached route plan automatically when going offline
  useEffect(() => {
    const onOffline = () => {
      if (!routePlan && cachedRoutePlan) {
        setRoutePlan(cachedRoutePlan);
        setSelectedRouteId(cachedRoutePlan.routes[0]?.id ?? null);
      }
    };
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, [routePlan, cachedRoutePlan]);

  // Auto-join live shared trip if ?trip=<token> is present in URL
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('trip');
    if (!token) return;
    let cancelled = false;
    fetch(apiUrl(`/api/trips/${encodeURIComponent(token)}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.session) return;
        joinTrip(token);
        setNavSection('map');
        setFlyToTarget({
          lat: data.session.currentLat,
          lng: data.session.currentLng,
          ts: Date.now(),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [joinTrip]);

  const fleetCount = fleetCountDraft ?? metrics?.totalFleet ?? 140;
  const speedLimitKmh = speedLimitDraft ?? metrics?.speedLimitKmh ?? 68;
  const isPaused = metrics?.isPaused ?? false;

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setGeoResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setIsSearchingGeo(true);
      try {
        const res = await fetch(apiUrl(`/api/geocode?q=${encodeURIComponent(q)}`));
        if (!res.ok) throw new Error('API geocode unavailable');
        const data = await res.json();
        const list = Array.isArray(data?.results) ? data.results.slice(0, 5) : [];
        if (list.length > 0) {
          setGeoResults(list);
        } else {
          setGeoResults(await geocodeDirectNominatim(q));
        }
      } catch {
        setGeoResults(await geocodeDirectNominatim(q));
      } finally {
        setIsSearchingGeo(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const matchingVehicles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return visibleVehicles
      .filter(
        (v) =>
          v.meta.vehicleId.toLowerCase().includes(q) ||
          v.meta.corridor.toLowerCase().includes(q)
      )
      .slice(0, 4);
  }, [searchQuery, visibleVehicles]);

  const updateSimConfig = async (patch: {
    vehicleCount?: number;
    speedLimitKmh?: number;
    isPaused?: boolean;
  }) => {
    if (isEdgeFallback) {
      updateFallbackConfig(patch);
      return;
    }
    try {
      await fetch(apiUrl('/api/simulation/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch {
      updateFallbackConfig(patch);
    }
  };

  const handleSelectCity = async (city: {
    name: string;
    lat: number;
    lng: number;
  }) => {
    setMapCenter({ lat: city.lat, lng: city.lng });
    setPois([]);
    setActivePoiCategory(null);
    setSelectedPoi(null);
    setDroppedPin(null);
    if (isEdgeFallback) {
      setFallbackCity(city);
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/simulation/city'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(city),
      });
      if (!res.ok) {
        setFallbackCity(city);
      }
    } catch {
      setFallbackCity(city);
    }
  };

  const handleInjectAnomaly = async () => {
    if (isEdgeFallback) {
      const vid = injectFallbackAnomaly();
      if (vid) setSelectedVehicleId(vid);
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/simulation/inject-anomaly'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox: latestBboxRef.current }),
      });
      const data = await res.json();
      if (data?.vehicleId) {
        setSelectedVehicleId(data.vehicleId);
        const match = visibleVehicles.find(
          (v) => v.meta.vehicleId === data.vehicleId
        );
        if (match) {
          setFlyToTarget({
            lng: match.location.coordinates[0],
            lat: match.location.coordinates[1],
            ts: Date.now(),
          });
        }
      }
    } catch {
      const vid = injectFallbackAnomaly();
      if (vid) setSelectedVehicleId(vid);
    }
  };

  const handleLocateVehicle = (vehicle: TelemetryPoint) => {
    setSelectedVehicleId(vehicle.meta.vehicleId);
    setFlyToTarget({
      lng: vehicle.location.coordinates[0],
      lat: vehicle.location.coordinates[1],
      ts: Date.now(),
    });
    if (navSection !== 'dashboard' && navSection !== 'map') {
      setNavSection('dashboard');
    }
  };

  const handleLocateAnomaly = (record: AnomalyRecord) => {
    setSelectedVehicleId(record.vehicleId);
    setFlyToTarget({
      lng: record.coordinates[0],
      lat: record.coordinates[1],
      ts: Date.now(),
    });
    if (navSection !== 'dashboard' && navSection !== 'map') {
      setNavSection('dashboard');
    }
  };

  const handleGenerateRoutes = async (params: {
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
  }) => {
    setIsGeneratingRoutes(true);
    setRouteError(null);
    try {
      const res = await fetch(apiUrl('/api/routes/suggest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, activeCity }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to generate AI route suggestions.');
      }
      const plan = data as AiRoutePlanResponse;
      setRoutePlan(plan);
      const primary = plan.routes[0] ?? null;
      setSelectedRouteId(primary?.id ?? null);
      cacheRoutePlan(plan);
      if (primary) {
        recordTrip({
          originName: plan.origin.name,
          destinationName: plan.destination.name,
          distanceKm: primary.distanceKm,
          durationMin: primary.durationMin,
          travelMode: plan.travelMode,
          googleMapsUrl: primary.googleMapsUrl,
        });
      }
      return plan;
    } catch (err) {
      setRouteError(
        err instanceof Error
          ? err.message
          : 'Failed to generate AI route suggestions.'
      );
      return null;
    } finally {
      setIsGeneratingRoutes(false);
    }
  };

  const handleSelectRoute = (route: AiRouteSuggestion) => {
    setSelectedRouteId(route.id);
  };

  const handleClearRoutePlan = () => {
    setRoutePlan(null);
    setSelectedRouteId(null);
    setRouteError(null);
    setNavigatingRoute(null);
  };

  const handleStartNavigation = (route: AiRouteSuggestion) => {
    setSelectedRouteId(route.id);
    setNavigatingRoute(route);
    setSelectedVehicleId(null);
    setDroppedPin(null);
    setSelectedPoi(null);
    if (
      navSection !== 'dashboard' &&
      navSection !== 'map' &&
      navSection !== 'routes' &&
      navSection !== 'explore'
    ) {
      setNavSection('map');
    }
  };

  const handleExitNavigation = () => {
    setNavigatingRoute(null);
  };

  const handleRerouteFromNav = async (pos: { lat: number; lng: number }) => {
    if (!routePlan) return;
    const plan = await handleGenerateRoutes({
      originQuery: `GPS (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`,
      destinationQuery: routePlan.destination.name,
      originCoords: { lat: pos.lat, lng: pos.lng, label: 'Current Position' },
      destinationCoords: {
        lat: routePlan.destination.lat,
        lng: routePlan.destination.lng,
        label: routePlan.destination.name,
      },
      stops: routePlan.stops.map((s) => ({
        query: s.name,
        coords: { lat: s.lat, lng: s.lng, label: s.name },
      })),
      travelMode: routePlan.travelMode,
      priority: navigatingRoute?.strategy || 'recommended',
      userNotes: 'Recalculated automatically due to off-route diversion.',
    });
    if (plan?.routes[0]) {
      setNavigatingRoute(plan.routes[0]);
      setSelectedRouteId(plan.routes[0].id);
    }
  };

  const handlePlanRouteFromVehicle = (vehicle: TelemetryPoint) => {
    setRoutePrefillOrigin({
      query: `${vehicle.meta.vehicleId} (${vehicle.meta.corridor})`,
      lat: vehicle.location.coordinates[1],
      lng: vehicle.location.coordinates[0],
      ts: Date.now(),
    });
    if (navSection !== 'routes') {
      setRightTab('routes');
    }
  };

  const handleMapClickCoord = async (coord: { lat: number; lng: number }) => {
    setSelectedPoi(null);
    setDroppingPinLoading(true);
    try {
      const res = await fetch(
        apiUrl(`/api/geocode/reverse?lat=${coord.lat}&lng=${coord.lng}`)
      );
      if (!res.ok) throw new Error('Reverse geocode failed');
      const info = (await res.json()) as DroppedPinInfo;
      setDroppedPin(info);
    } catch {
      setDroppedPin({
        lat: coord.lat,
        lng: coord.lng,
        name: `${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`,
        displayName: `Dropped Pin (${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)})`,
        photos: [],
      });
    } finally {
      setDroppingPinLoading(false);
    }
  };

  const handleSearchPois = async (category: PoiCategory) => {
    setActivePoiCategory(category);
    setPoisLoading(true);
    setSelectedPoi(null);
    const searchCoord = gpsFollow && gpsPosition ? gpsPosition : mapCenter;
    try {
      const res = await fetch(
        apiUrl(
          `/api/places/nearby?lat=${searchCoord.lat}&lng=${searchCoord.lng}&category=${encodeURIComponent(category)}`
        )
      );
      const data = await res.json();
      setPois(Array.isArray(data?.places) ? data.places : []);
    } catch {
      setPois([]);
    } finally {
      setPoisLoading(false);
    }
  };

  const handleClearPois = () => {
    setPois([]);
    setActivePoiCategory(null);
    setSelectedPoi(null);
  };

  const handleSelectPoi = (poi: PoiPlace | null) => {
    setSelectedPoi(poi);
    if (poi) {
      setDroppedPin(null);
      setFlyToTarget({ lat: poi.lat, lng: poi.lng, ts: Date.now() });
    }
  };

  const handleRouteToLocation = (target: {
    name: string;
    lat: number;
    lng: number;
  }) => {
    setRoutePrefillDestination({
      query: target.name,
      lat: target.lat,
      lng: target.lng,
      ts: Date.now(),
    });
    if (navSection === 'dashboard' || navSection === 'map') {
      setRightTab('routes');
    } else {
      setNavSection('routes');
    }
  };

  const handleSetOriginLocation = (target: {
    name: string;
    lat: number;
    lng: number;
  }) => {
    setRoutePrefillOrigin({
      query: target.name,
      lat: target.lat,
      lng: target.lng,
      ts: Date.now(),
    });
    if (navSection === 'dashboard' || navSection === 'map') {
      setRightTab('routes');
    } else {
      setNavSection('routes');
    }
  };

  const handleReportIncident = async (payload: {
    type: IncidentType;
    title: string;
    description: string;
    lat: number;
    lng: number;
    corridor: string;
  }) => {
    await fetch(apiUrl('/api/incidents'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  const handleUpvoteIncident = async (id: string) => {
    await fetch(apiUrl(`/api/incidents/${encodeURIComponent(id)}/upvote`), {
      method: 'POST',
    });
  };

  const handleReportIncidentAt = (coord: {
    lat: number;
    lng: number;
    label?: string;
  }) => {
    setMapCenter({ lat: coord.lat, lng: coord.lng });
    setFlyToTarget({ lat: coord.lat, lng: coord.lng, ts: Date.now() });
    if (navSection === 'dashboard' || navSection === 'map') {
      setRightTab('explore');
    } else {
      setNavSection('explore');
    }
  };

  const sortedVehicles = useMemo(() => {
    return [...visibleVehicles].sort((a, b) => {
      if (a.isAnomaly !== b.isAnomaly) return a.isAnomaly ? -1 : 1;
      return b.speed - a.speed;
    });
  }, [visibleVehicles]);

  const lastUpdatedStr = useMemo(() => {
    const dt = metrics?.timestamp ? new Date(metrics.timestamp) : new Date();
    const time = dt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const date = dt.toLocaleDateString([], {
      day: '2-digit',
      month: 'short',
    });
    return `${time} · ${date}`;
  }, [metrics?.timestamp]);

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: typeof Home;
    badge?: number;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'routes', label: 'AI Routes', icon: Sparkles },
    {
      id: 'explore',
      label: 'Explore',
      icon: Compass,
      badge: incidents.length > 0 ? incidents.length : undefined,
    },
    { id: 'map', label: 'Map', icon: MapIcon },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    {
      id: 'alerts',
      label: 'Alerts',
      icon: AlertTriangle,
      badge: metrics?.activeAnomalies ?? 0,
    },
    { id: 'reports', label: 'Reports', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const showRightInspector =
    navSection === 'dashboard' || navSection === 'map';

  const sharedMapProps = {
    vehicles: visibleVehicles,
    subscribedTiles,
    showSpatialGrid,
    onToggleSpatialGrid: () => setShowSpatialGrid((p) => !p),
    vehicleFilter,
    onChangeVehicleFilter: setVehicleFilter,
    activeCity,
    onSelectCity: (c: { name: string; lat: number; lng: number }) =>
      void handleSelectCity(c),
    selectedVehicle,
    selectedHistory,
    followedVehicleId,
    speedLimitKmh,
    onSelectVehicle: setSelectedVehicleId,
    onToggleFollow: toggleFollow,
    onViewportChange: handleViewportChange,
    onMapCenterChange: setMapCenter,
    flyToTarget,
    routePlan,
    selectedRouteId,
    onPlanRouteFromVehicle: handlePlanRouteFromVehicle,
    basemapTheme,
    onChangeBasemapTheme: setBasemapTheme,
    pois,
    selectedPoi,
    onSelectPoi: handleSelectPoi,
    incidents,
    droppedPin,
    droppingPinLoading,
    onMapClickCoord: (coord: { lat: number; lng: number }) =>
      void handleMapClickCoord(coord),
    onClearDroppedPin: () => setDroppedPin(null),
    onRouteToLocation: handleRouteToLocation,
    onSetOriginLocation: handleSetOriginLocation,
    onSavePlace: savePlace,
    onReportIncidentAt: handleReportIncidentAt,
    navigatingRoute,
    onExitNavigation: handleExitNavigation,
    onRerouteFromNav: (pos: { lat: number; lng: number }) =>
      void handleRerouteFromNav(pos),
    onPublishTripPosition: publishTripPosition,
    watchedTrip,
    gpsStatus,
    gpsPosition,
    gpsFollow,
    gpsError,
    onStartGps: startGps,
    onStopGps: stopGps,
    onSetGpsFollow: setGpsFollow,
  };

  return (
    <div className="min-h-screen lg:h-screen flex bg-[#0A0D12] text-slate-100 overflow-x-hidden lg:overflow-hidden">
      <OfflineIndicator />
      {/* Left Navigation Sidebar */}
      <aside className="hidden md:flex w-[216px] bg-[#0F141C] border-r border-white/[0.07] flex-col justify-between shrink-0 relative overflow-hidden">
        <div>
          {/* Brand Lockup */}
          <div className="px-4 h-16 flex items-center gap-3 border-b border-white/[0.06]">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <path
                  d="M4 18V7.5L9.5 14L14.5 7.5V18"
                  stroke="#22c55e"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="19" cy="16" r="2.2" fill="#22c55e" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-white leading-tight font-display">
                MetroPulse
              </div>
              <div className="text-[11px] text-slate-400 leading-tight">
                Fleet Telemetry
              </div>
            </div>
          </div>

          {/* Primary Nav */}
          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = navSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setNavSection(item.id)}
                  className={`w-full px-3 py-2.5 rounded-lg flex items-center justify-between text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-emerald-500/20 to-emerald-500/5 text-white border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 ${
                        isActive ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    />
                    {item.label}
                  </span>
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-red-500 text-white rounded-full leading-none">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom System Online Box + Skyline Silhouette */}
        <div className="relative z-10 p-3 pt-2">
          <div className="bg-[#151B26]/90 backdrop-blur-sm border border-white/[0.08] rounded-xl p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionState === 'connected'
                    ? 'bg-emerald-500'
                    : connectionState === 'connecting'
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                }`}
              />
              {connectionState === 'connected'
                ? 'System Online'
                : connectionState === 'connecting'
                  ? 'Connecting...'
                  : 'Reconnecting'}
            </div>
            <div className="text-[11px] text-slate-400 mt-2">Last Updated</div>
            <div className="text-[11px] font-mono text-slate-200 mt-0.5">
              {lastUpdatedStr}
            </div>
          </div>

          {/* Subtle Architectural Skyline Silhouette */}
          <svg
            viewBox="0 0 216 64"
            className="w-full h-14 mt-2 opacity-25 text-slate-400 pointer-events-none"
            preserveAspectRatio="none"
          >
            <path
              d="M0 64V44H14V30H24V44H32V20H46V44H54V36H68V12H78V44H88V26H104V44H112V16H126V44H136V28H150V44H162V22H176V44H188V34H202V44H216V64Z"
              fill="currentColor"
            />
          </svg>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top Global Search & Status Bar */}
        <header className="h-16 px-4 lg:px-5 border-b border-white/[0.07] bg-[#0D1118] flex items-center justify-between gap-4 shrink-0">
          {/* Mobile quick nav */}
          <div className="flex md:hidden items-center gap-2 shrink-0">
            <span className="text-sm font-bold text-white font-display">
              MetroPulse
            </span>
          </div>

          {/* Universal Search: Vehicles + Any City Worldwide */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 180)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchFocused(true);
              }}
              placeholder="Search vehicle, location..."
              className="w-full pl-10 pr-8 py-2 text-xs bg-[#151B26] border border-white/[0.08] rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setGeoResults([]);
                }}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {searchFocused && searchQuery.trim().length >= 2 && (
              <div className="absolute left-0 right-0 mt-1.5 bg-[#141A24] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-30">
                {matchingVehicles.length > 0 && (
                  <div className="border-b border-white/[0.06]">
                    <div className="px-3 py-1.5 text-[10px] font-medium text-slate-400 bg-white/[0.02]">
                      Active Vehicles
                    </div>
                    {matchingVehicles.map((v) => (
                      <button
                        key={v.meta.vehicleId}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleLocateVehicle(v);
                          setSearchFocused(false);
                        }}
                        className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-white/[0.05] text-xs cursor-pointer"
                      >
                        <span className="font-mono font-medium text-white">
                          {v.meta.vehicleId}{' '}
                          <span className="font-sans text-slate-400 font-normal">
                            · {v.meta.corridor}
                          </span>
                        </span>
                        <span className="font-mono text-emerald-400">
                          {v.speed.toFixed(1)} km/h
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <div className="px-3 py-1.5 text-[10px] font-medium text-slate-400 bg-white/[0.02]">
                    Deploy Fleet to Any City
                  </div>
                  {isSearchingGeo ? (
                    <div className="px-3 py-2.5 text-xs text-slate-400">
                      Searching OpenStreetMap...
                    </div>
                  ) : geoResults.length === 0 ? (
                    <div className="px-3 py-2.5 text-xs text-slate-400">
                      No matching cities found.
                    </div>
                  ) : (
                    geoResults.map((city, i) => (
                      <button
                        key={`${city.lat}-${city.lng}-${i}`}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          void handleSelectCity({
                            name: city.name,
                            lat: city.lat,
                            lng: city.lng,
                          });
                          setSearchQuery(city.name);
                          setSearchFocused(false);
                          setNavSection('dashboard');
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-white/[0.05] border-t border-white/[0.04] cursor-pointer"
                      >
                        <div className="text-xs font-medium text-white">
                          {city.name}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {city.displayName}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />

            {watchedTrip && (
              <button
                type="button"
                onClick={() => leaveTrip(watchedTrip.token)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-sky-500/15 border border-sky-500/35 text-sky-300 hover:bg-sky-500/25 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Stop Shared Trip
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleInjectAnomaly()}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              Inject Anomaly
            </button>

            <button
              type="button"
              onClick={() => void updateSimConfig({ isPaused: !isPaused })}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#151B26] border border-white/10 text-slate-200 hover:bg-white/10 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {isPaused ? (
                <>
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5 text-slate-300" />
                  Pause
                </>
              )}
            </button>

            <div className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium text-slate-200">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionState === 'connected'
                    ? 'bg-emerald-500'
                    : connectionState === 'connecting'
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                }`}
              />
              <span>
                {connectionState === 'connected'
                  ? 'Live'
                  : connectionState === 'connecting'
                    ? 'Connecting'
                    : 'Offline'}
              </span>
            </div>

            {/* Notification Bell Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setBellOpen((o) => !o)}
                aria-label="Toggle recent alerts"
                className="relative p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {anomalies.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-mono font-semibold flex items-center justify-center">
                    {Math.min(99, metrics?.activeAnomalies || anomalies.length)}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-[#141A24] border border-white/10 rounded-xl shadow-2xl z-30 overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      Latest Alerts
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setBellOpen(false);
                        setNavSection('alerts');
                      }}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 cursor-pointer"
                    >
                      View All
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.06]">
                    {anomalies.slice(0, 5).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setBellOpen(false);
                          handleLocateAnomaly(a);
                        }}
                        className="w-full px-3.5 py-2.5 text-left hover:bg-white/[0.04] flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-medium text-white truncate">
                            {a.vehicleId} ·{' '}
                            <span className="text-red-400 font-sans">
                              {a.reason}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {a.corridor} · {a.speed.toFixed(1)} km/h
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {new Date(a.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="w-8 h-8 rounded-full bg-[#1C2331] border border-white/10 flex items-center justify-center text-xs font-semibold text-slate-200">
              V
            </div>
          </div>
        </header>

        {/* Mobile Section Switcher */}
        <div className="flex md:hidden items-center gap-1 px-3 py-2 border-b border-white/[0.06] bg-[#0F141C] overflow-x-auto shrink-0">
          {(
            [
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'routes', label: 'AI Routes' },
              { id: 'explore', label: 'Explore' },
              { id: 'map', label: 'Map' },
              { id: 'alerts', label: 'Alerts' },
            ] as Array<{ id: NavSection; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setNavSection(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                navSection === item.id
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'bg-[#151B26] text-slate-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Body Workspace */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* Center Column */}
          {navSection === 'dashboard' && (
            <div className="flex-1 flex flex-col min-w-0 min-h-0 p-3.5 gap-3.5 lg:overflow-y-auto">
              <TopKpiCards
                metrics={metrics}
                metricsHistory={metricsHistory}
                visibleVehicles={visibleVehicles}
              />

              <div className="relative flex-1 min-h-[380px]">
                <FleetMap {...sharedMapProps} />
              </div>

              <BottomAnalyticsRow
                visibleVehicles={visibleVehicles}
                metrics={metrics}
                metricsHistory={metricsHistory}
                anomalies={anomalies}
                onViewAllAlerts={() => setNavSection('alerts')}
              />
            </div>
          )}

          {navSection === 'routes' && (
            <div className="flex-1 flex flex-col lg:flex-row min-h-0 p-3.5 gap-3.5 overflow-y-auto lg:overflow-hidden">
              <div className="w-full lg:w-[410px] shrink-0 overflow-y-auto pr-0.5">
                <AiRoutePlanner
                  activeCity={activeCity}
                  selectedVehicle={selectedVehicle}
                  savedPlaces={savedPlaces}
                  routePlan={routePlan}
                  selectedRouteId={selectedRouteId}
                  isGenerating={isGeneratingRoutes}
                  error={routeError}
                  prefillOrigin={routePrefillOrigin}
                  prefillDestination={routePrefillDestination}
                  onGenerateRoutes={(p) => void handleGenerateRoutes(p)}
                  onSelectRoute={handleSelectRoute}
                  onStartNavigation={handleStartNavigation}
                  onClearPlan={handleClearRoutePlan}
                />
              </div>
              <div className="relative flex-1 min-h-[420px] lg:min-h-0">
                <FleetMap {...sharedMapProps} />
              </div>
            </div>
          )}

          {navSection === 'explore' && (
            <div className="flex-1 flex flex-col lg:flex-row min-h-0 p-3.5 gap-3.5 overflow-y-auto lg:overflow-hidden">
              <div className="w-full lg:w-[390px] shrink-0 bg-[#0F141C] border border-white/[0.07] rounded-xl flex flex-col min-h-0 overflow-hidden">
                <ExploreAndHazardsPanel
                  activeCity={activeCity}
                  mapCenter={mapCenter}
                  pois={pois}
                  activePoiCategory={activePoiCategory}
                  poisLoading={poisLoading}
                  incidents={incidents}
                  savedPlaces={savedPlaces}
                  tripHistory={tripHistory}
                  onSearchPois={(cat) => void handleSearchPois(cat)}
                  onClearPois={handleClearPois}
                  onSelectPoi={(poi) => handleSelectPoi(poi)}
                  onRouteToLocation={handleRouteToLocation}
                  onSavePlace={savePlace}
                  onRemoveSavedPlace={removePlace}
                  onClearTripHistory={clearTripHistory}
                  onReportIncident={handleReportIncident}
                  onUpvoteIncident={handleUpvoteIncident}
                  onLocateCoords={(lat, lng) =>
                    setFlyToTarget({ lat, lng, ts: Date.now() })
                  }
                />
              </div>
              <div className="relative flex-1 min-h-[420px] lg:min-h-0">
                <FleetMap {...sharedMapProps} />
              </div>
            </div>
          )}

          {navSection === 'map' && (
            <div className="flex-1 p-3.5 min-h-[500px] lg:min-h-0 relative">
              <FleetMap {...sharedMapProps} />
            </div>
          )}

          {navSection === 'analytics' && (
            <TelemetryTable
              vehicles={visibleVehicles}
              onInspectOnMap={handleLocateVehicle}
            />
          )}

          {navSection === 'alerts' && (
            <AnomalyLogView
              anomalies={anomalies}
              onLocateAnomaly={handleLocateAnomaly}
              onInjectAnomaly={() => void handleInjectAnomaly()}
            />
          )}

          {navSection === 'reports' && (
            <ReportsView
              activeCity={activeCity}
              visibleVehicles={visibleVehicles}
              anomalies={anomalies}
              metrics={metrics}
            />
          )}

          {navSection === 'settings' && (
            <SettingsView
              fleetCount={fleetCount}
              speedLimitKmh={speedLimitKmh}
              isPaused={isPaused}
              showSpatialGrid={showSpatialGrid}
              onToggleSpatialGrid={() => setShowSpatialGrid((p) => !p)}
              onUpdateConfig={(p) => void updateSimConfig(p)}
              onInjectAnomaly={() => void handleInjectAnomaly()}
              onSelectCity={(c) => {
                void handleSelectCity(c);
                setNavSection('dashboard');
              }}
            />
          )}

          {/* Right Operational Inspector Panel (Dashboard & Map modes) */}
          {showRightInspector && (
            <aside className="w-full lg:w-[328px] xl:w-[344px] border-t lg:border-t-0 lg:border-l border-white/[0.07] bg-[#0F141C] flex flex-col min-h-0 shrink-0">
              {/* Active City & Grid Selector */}
              <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between gap-2 relative">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-xs font-semibold text-white truncate">
                    {activeCity.name}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setCityMenuOpen((o) => !o)}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors shrink-0 cursor-pointer"
                >
                  {activeCity.corridorSource === 'openstreetmap'
                    ? 'OSM Roads'
                    : 'Urban Grid'}
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {cityMenuOpen && (
                  <div className="absolute right-3 top-11 w-52 bg-[#141A24] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-30">
                    <div className="px-3 py-1.5 text-[10px] font-medium text-slate-400 bg-white/[0.02]">
                      Switch City Region
                    </div>
                    {CITY_QUICK_SWITCH.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => {
                          setCityMenuOpen(false);
                          void handleSelectCity(c);
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.05] transition-colors cursor-pointer"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Inspector Sub-Tabs */}
              <div className="px-3 border-b border-white/[0.07] flex items-center justify-between gap-1 text-[11px] overflow-x-auto">
                {(
                  [
                    { id: 'overview', label: 'Overview' },
                    { id: 'routes', label: 'Routes' },
                    { id: 'explore', label: 'Explore' },
                    { id: 'vehicles', label: 'Fleet' },
                    { id: 'alerts', label: 'Alerts' },
                  ] as Array<{ id: RightTab; label: string }>
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setRightTab(t.id)}
                    className={`py-2.5 px-1 border-b-2 font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      rightTab === t.id
                        ? 'border-emerald-400 text-white'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {rightTab === 'overview' && (
                <div className="flex-1 overflow-y-auto flex flex-col">
                  {/* 2x2 Metrics Grid */}
                  <div className="grid grid-cols-2 border-b border-white/[0.07]">
                    <div className="p-3.5 border-r border-b border-white/[0.07]">
                      <div className="text-[11px] text-slate-400">
                        Viewport Vehicles
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-lg font-bold text-white font-mono">
                          {visibleVehicles.length}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          / {metrics?.totalFleet ?? fleetCount}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-emerald-400 font-mono">
                        {spatialMode === 'overview'
                          ? 'Overview mode'
                          : `${bandwidthSavedPct}% bandwidth saved`}
                      </div>
                    </div>

                    <div className="p-3.5 border-b border-white/[0.07]">
                      <div className="text-[11px] text-slate-400">
                        Mean Fleet Speed
                      </div>
                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-lg font-bold text-white font-mono">
                          {(metrics?.avgFleetSpeed ?? 0).toFixed(1)}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          km/h
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-emerald-400 font-mono">
                        {subscribedTiles.length} spatial tiles
                      </div>
                    </div>

                    <div className="p-3.5 border-r border-white/[0.07]">
                      <div className="text-[11px] text-slate-400">
                        Active Anomalies
                      </div>
                      <div
                        className={`mt-1 text-lg font-bold font-mono ${
                          (metrics?.activeAnomalies ?? 0) > 0
                            ? 'text-red-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {metrics?.activeAnomalies ?? 0}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400 font-mono">
                        Limit: {speedLimitKmh} km/h
                      </div>
                    </div>

                    <div className="p-3.5">
                      <div className="text-[11px] text-slate-400">
                        Ingestion Rate
                      </div>
                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-lg font-bold text-white font-mono">
                          {metrics?.writesPerSec ?? 0}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          docs/s
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400 font-mono">
                        {(metrics?.totalIngested ?? 0).toLocaleString()} stored
                      </div>
                    </div>
                  </div>

                  {/* Emerald Sliders */}
                  <div className="p-4 border-b border-white/[0.07] space-y-4">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <label
                          htmlFor="inspector-fleet-slider"
                          className="text-slate-300"
                        >
                          Simulated Fleet Size
                        </label>
                        <span className="font-mono text-white">
                          {fleetCount} vehicles
                        </span>
                      </div>
                      <input
                        id="inspector-fleet-slider"
                        type="range"
                        min={40}
                        max={300}
                        step={10}
                        value={fleetCount}
                        onChange={(e) =>
                          setFleetCountDraft(Number(e.target.value))
                        }
                        onMouseUp={() => {
                          if (fleetCountDraft !== null) {
                            void updateSimConfig({
                              vehicleCount: fleetCountDraft,
                            });
                            setFleetCountDraft(null);
                          }
                        }}
                        onTouchEnd={() => {
                          if (fleetCountDraft !== null) {
                            void updateSimConfig({
                              vehicleCount: fleetCountDraft,
                            });
                            setFleetCountDraft(null);
                          }
                        }}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <label
                          htmlFor="inspector-limit-slider"
                          className="text-slate-300"
                        >
                          Anomaly Speed Threshold
                        </label>
                        <span className="font-mono text-white">
                          {speedLimitKmh} km/h
                        </span>
                      </div>
                      <input
                        id="inspector-limit-slider"
                        type="range"
                        min={40}
                        max={100}
                        step={2}
                        value={speedLimitKmh}
                        onChange={(e) =>
                          setSpeedLimitDraft(Number(e.target.value))
                        }
                        onMouseUp={() => {
                          if (speedLimitDraft !== null) {
                            void updateSimConfig({
                              speedLimitKmh: speedLimitDraft,
                            });
                            setSpeedLimitDraft(null);
                          }
                        }}
                        onTouchEnd={() => {
                          if (speedLimitDraft !== null) {
                            void updateSimConfig({
                              speedLimitKmh: speedLimitDraft,
                            });
                            setSpeedLimitDraft(null);
                          }
                        }}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Recent Alerts */}
                  <div className="p-4 flex-1">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-white">
                        Recent Alerts
                      </h3>
                      <button
                        type="button"
                        onClick={() => setNavSection('alerts')}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer"
                      >
                        View All
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>

                    {anomalies.length === 0 ? (
                      <div className="text-xs text-slate-400 py-4 text-center">
                        No recent speeding alerts.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {anomalies.slice(0, 5).map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => handleLocateAnomaly(a)}
                            className="w-full flex items-center justify-between gap-2 text-left hover:bg-white/[0.04] p-1.5 -mx-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                              <span className="text-xs font-mono font-medium text-white shrink-0">
                                {a.vehicleId}
                              </span>
                              <span className="text-xs text-red-400 truncate">
                                {a.reason}
                              </span>
                            </div>
                            <span className="text-[11px] font-mono text-slate-400 shrink-0">
                              {new Date(a.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {rightTab === 'vehicles' && (
                <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
                  {sortedVehicles.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      No vehicles inside the current viewport.
                    </div>
                  ) : (
                    sortedVehicles.map((v) => (
                      <button
                        key={v.meta.vehicleId}
                        type="button"
                        onClick={() => handleLocateVehicle(v)}
                        className={`w-full px-4 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-white/[0.04] transition-colors cursor-pointer ${
                          selectedVehicle?.meta.vehicleId === v.meta.vehicleId
                            ? 'bg-emerald-500/10'
                            : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-semibold text-white">
                            {v.meta.vehicleId}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {v.meta.corridor}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`text-xs font-mono font-semibold ${
                              v.isAnomaly
                                ? 'text-red-400'
                                : v.speed < 22
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                            }`}
                          >
                            {v.speed.toFixed(1)} km/h
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            avg {v.movingAvgSpeed.toFixed(1)}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}

              {rightTab === 'alerts' && (
                <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
                  {anomalies.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      No anomalies recorded yet.
                    </div>
                  ) : (
                    anomalies.slice(0, 25).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => handleLocateAnomaly(a)}
                        className="w-full px-4 py-2.5 text-left hover:bg-white/[0.04] flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-semibold text-white">
                              {a.vehicleId}
                            </span>
                            <span className="text-[11px] text-red-400 truncate">
                              {a.reason}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {a.corridor} · Peak {a.speed.toFixed(1)} km/h
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {new Date(a.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {rightTab === 'routes' && (
                <AiRoutePlanner
                  compact
                  activeCity={activeCity}
                  selectedVehicle={selectedVehicle}
                  savedPlaces={savedPlaces}
                  routePlan={routePlan}
                  selectedRouteId={selectedRouteId}
                  isGenerating={isGeneratingRoutes}
                  error={routeError}
                  prefillOrigin={routePrefillOrigin}
                  prefillDestination={routePrefillDestination}
                  onGenerateRoutes={(p) => void handleGenerateRoutes(p)}
                  onSelectRoute={handleSelectRoute}
                  onStartNavigation={handleStartNavigation}
                  onClearPlan={handleClearRoutePlan}
                  onPreviewOnMap={() => setNavSection('dashboard')}
                />
              )}

              {rightTab === 'explore' && (
                <ExploreAndHazardsPanel
                  activeCity={activeCity}
                  mapCenter={mapCenter}
                  pois={pois}
                  activePoiCategory={activePoiCategory}
                  poisLoading={poisLoading}
                  incidents={incidents}
                  savedPlaces={savedPlaces}
                  tripHistory={tripHistory}
                  onSearchPois={(cat) => void handleSearchPois(cat)}
                  onClearPois={handleClearPois}
                  onSelectPoi={(poi) => handleSelectPoi(poi)}
                  onRouteToLocation={handleRouteToLocation}
                  onSavePlace={savePlace}
                  onRemoveSavedPlace={removePlace}
                  onClearTripHistory={clearTripHistory}
                  onReportIncident={handleReportIncident}
                  onUpvoteIncident={handleUpvoteIncident}
                  onLocateCoords={(lat, lng) =>
                    setFlyToTarget({ lat, lng, ts: Date.now() })
                  }
                />
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
