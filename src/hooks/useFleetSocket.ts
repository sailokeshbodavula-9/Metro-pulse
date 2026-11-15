import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ActiveCityInfo,
  AnomalyRecord,
  BoundingBox,
  FleetMetricsSnapshot,
  RoadIncident,
  SharedTripSession,
  SubscribedTile,
  TelemetryPoint,
} from '../types/telemetry';
import { apiUrl, getSocketNamespaceUrl } from '../utils/api';
import { ClientTelemetryFallback } from '../utils/clientFallbackEngine';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface SnapshotPayload {
  vehicles: TelemetryPoint[];
  totalFleet: number;
  subscribedTiles: SubscribedTile[];
  mode: 'overview' | 'spatial-tiles';
  activeCity?: ActiveCityInfo;
}

interface BatchPayload {
  room: string;
  vehicles: TelemetryPoint[];
}

function isPointInBbox(lat: number, lng: number, bbox: BoundingBox): boolean {
  if (lat < bbox.south || lat > bbox.north) return false;
  if (bbox.east >= bbox.west) {
    return lng >= bbox.west && lng <= bbox.east;
  }
  return lng >= bbox.west || lng <= bbox.east;
}

export function useFleetSocket() {
  const socketRef = useRef<Socket | null>(null);
  const bboxRef = useRef<BoundingBox | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const vehicleMapRef = useRef<Map<string, TelemetryPoint>>(new Map());
  const viewportDebounceRef = useRef<number | null>(null);
  const fallbackRef = useRef<ClientTelemetryFallback | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const socketConnectedRef = useRef<boolean>(false);

  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting');
  const [isEdgeFallback, setIsEdgeFallback] = useState(false);
  const [visibleVehicles, setVisibleVehicles] = useState<TelemetryPoint[]>([]);
  const [subscribedTiles, setSubscribedTiles] = useState<SubscribedTile[]>([]);
  const [spatialMode, setSpatialMode] = useState<'overview' | 'spatial-tiles'>(
    'spatial-tiles'
  );
  const [activeCity, setActiveCity] = useState<ActiveCityInfo>({
    name: 'San Francisco, CA',
    lat: 37.7749,
    lng: -122.4194,
    corridorSource: 'urban-grid',
    corridorCount: 10,
  });
  const [metrics, setMetrics] = useState<FleetMetricsSnapshot | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<FleetMetricsSnapshot[]>(
    []
  );
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    null
  );
  const [followedVehicleId, setFollowedVehicleId] = useState<string | null>(
    null
  );
  const [selectedHistory, setSelectedHistory] = useState<TelemetryPoint[]>([]);
  const [incidents, setIncidents] = useState<RoadIncident[]>([]);
  const [watchedTrip, setWatchedTrip] = useState<SharedTripSession | null>(
    null
  );

  useEffect(() => {
    selectedIdRef.current = selectedVehicleId;
  }, [selectedVehicleId]);

  const stopEdgeFallback = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    setIsEdgeFallback(false);
  }, []);

  const startEdgeFallback = useCallback(() => {
    if (socketConnectedRef.current || fallbackTimerRef.current !== null) return;
    if (!fallbackRef.current) {
      fallbackRef.current = new ClientTelemetryFallback(140);
    }

    setIsEdgeFallback(true);
    setConnectionState('connected');
    setSpatialMode('overview');

    const tickFallback = () => {
      const engine = fallbackRef.current;
      if (!engine || socketConnectedRef.current) return;
      const { points, metrics: nextMetrics, anomalies: newAnomalies } = engine.step();

      const bbox = bboxRef.current;
      const filtered = bbox
        ? points.filter((p) => {
            const [lng, lat] = p.location.coordinates;
            return isPointInBbox(lat, lng, bbox);
          })
        : points;

      const nextMap = new Map<string, TelemetryPoint>();
      for (const p of filtered) {
        nextMap.set(p.meta.vehicleId, p);
      }
      vehicleMapRef.current = nextMap;
      setVisibleVehicles(filtered);
      setMetrics(nextMetrics);
      setMetricsHistory((prev) => {
        const next = [...prev, nextMetrics];
        return next.length > 36 ? next.slice(-36) : next;
      });

      if (newAnomalies.length > 0) {
        setAnomalies((prev) => [...newAnomalies, ...prev].slice(0, 120));
      }

      if (selectedIdRef.current) {
        const hist = engine.getVehicleHistory(selectedIdRef.current);
        if (hist.length > 0) {
          setSelectedHistory(hist);
        }
      }
    };

    tickFallback();
    fallbackTimerRef.current = window.setInterval(tickFallback, 500);
  }, []);

  useEffect(() => {
    fetch(apiUrl('/api/telemetry/anomalies?limit=60'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.anomalies) {
          setAnomalies(data.anomalies);
        }
      })
      .catch(() => {});

    fetch(apiUrl('/api/incidents'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.incidents)) {
          setIncidents(data.incidents);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedVehicleId) {
      setSelectedHistory([]);
      return;
    }

    if (isEdgeFallback && fallbackRef.current) {
      setSelectedHistory(fallbackRef.current.getVehicleHistory(selectedVehicleId));
      return;
    }

    let cancelled = false;
    fetch(
      apiUrl(`/api/telemetry/history/${encodeURIComponent(selectedVehicleId)}?limit=60`)
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.history)) {
          setSelectedHistory(data.history);
        }
      })
      .catch(() => {});

    const socket = socketRef.current;
    socket?.emit('vehicle:follow', selectedVehicleId);

    return () => {
      cancelled = true;
      socket?.emit('vehicle:unfollow', selectedVehicleId);
    };
  }, [selectedVehicleId, isEdgeFallback]);

  useEffect(() => {
    let connectFailures = 0;

    const socket = io(getSocketNamespaceUrl(), {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1200,
      timeout: 3000,
    });
    socketRef.current = socket;

    // If no WebSocket backend is reachable (e.g., Vercel serverless/static deployment),
    // automatically activate the live browser telemetry engine after 2.8s so vehicles render.
    const fallbackTimeout = window.setTimeout(() => {
      if (!socketConnectedRef.current) {
        startEdgeFallback();
      }
    }, 2800);

    socket.on('connect', () => {
      socketConnectedRef.current = true;
      connectFailures = 0;
      window.clearTimeout(fallbackTimeout);
      stopEdgeFallback();
      setConnectionState('connected');
      if (bboxRef.current) {
        socket.emit('viewport:update', bboxRef.current);
      }
    });

    socket.on('disconnect', () => {
      socketConnectedRef.current = false;
      setConnectionState('disconnected');
    });

    socket.on('connect_error', () => {
      socketConnectedRef.current = false;
      connectFailures += 1;
      if (connectFailures >= 2) {
        startEdgeFallback();
      } else {
        setConnectionState('disconnected');
      }
    });

    socket.on('telemetry:snapshot', (payload: SnapshotPayload) => {
      const nextMap = new Map<string, TelemetryPoint>();
      for (const v of payload.vehicles) {
        nextMap.set(v.meta.vehicleId, v);
      }
      vehicleMapRef.current = nextMap;
      setVisibleVehicles(payload.vehicles);
      setSubscribedTiles(payload.subscribedTiles || []);
      setSpatialMode(payload.mode);
      if (payload.activeCity) {
        setActiveCity(payload.activeCity);
      }
    });

    socket.on('simulation:city-changed', (city: ActiveCityInfo) => {
      vehicleMapRef.current.clear();
      setVisibleVehicles([]);
      setSelectedVehicleId(null);
      setFollowedVehicleId(null);
      setSelectedHistory([]);
      setActiveCity(city);
      if (bboxRef.current) {
        socket.emit('viewport:update', bboxRef.current);
      }
    });

    socket.on('telemetry:batch', (payload: BatchPayload) => {
      const map = vehicleMapRef.current;
      const bbox = bboxRef.current;

      for (const v of payload.vehicles) {
        map.set(v.meta.vehicleId, v);
      }

      if (bbox) {
        for (const [vid, point] of map.entries()) {
          const [lng, lat] = point.location.coordinates;
          if (!isPointInBbox(lat, lng, bbox)) {
            map.delete(vid);
          }
        }
      }

      setVisibleVehicles(Array.from(map.values()));
    });

    socket.on('vehicle:update', (point: TelemetryPoint) => {
      if (point.meta.vehicleId === selectedIdRef.current) {
        setSelectedHistory((prev) => {
          const next = [...prev, point];
          return next.length > 60 ? next.slice(-60) : next;
        });
      }
    });

    socket.on('fleet:metrics', (nextMetrics: FleetMetricsSnapshot) => {
      setMetrics(nextMetrics);
      setMetricsHistory((prev) => {
        const next = [...prev, nextMetrics];
        return next.length > 36 ? next.slice(-36) : next;
      });
      if (nextMetrics.activeCity) {
        setActiveCity(nextMetrics.activeCity);
      }
    });

    socket.on('anomaly:alert', (incoming: TelemetryPoint[]) => {
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      setAnomalies((prev) => {
        const mapped: AnomalyRecord[] = incoming
          .filter((p) => p.anomalyReason)
          .map((p) => ({
            id: `${p.meta.vehicleId}-${p.timestamp}`,
            timestamp: p.timestamp,
            vehicleId: p.meta.vehicleId,
            fleetType: p.meta.fleetType,
            corridor: p.meta.corridor,
            speed: p.speed,
            movingAvgSpeed: p.movingAvgSpeed,
            speedLimit: 68,
            reason: p.anomalyReason!,
            coordinates: p.location.coordinates,
          }));
        const combined = [...mapped, ...prev];
        return combined.slice(0, 120);
      });
    });

    socket.on('incidents:list', (list: RoadIncident[]) => {
      if (Array.isArray(list)) {
        setIncidents(list);
      }
    });

    socket.on('trip:update', (session: SharedTripSession) => {
      if (session?.token) {
        setWatchedTrip(session);
      }
    });

    return () => {
      window.clearTimeout(fallbackTimeout);
      stopEdgeFallback();
      if (viewportDebounceRef.current) {
        window.clearTimeout(viewportDebounceRef.current);
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [startEdgeFallback, stopEdgeFallback]);

  const updateViewport = useCallback((bbox: BoundingBox) => {
    bboxRef.current = bbox;
    if (viewportDebounceRef.current) {
      window.clearTimeout(viewportDebounceRef.current);
    }
    viewportDebounceRef.current = window.setTimeout(() => {
      if (socketConnectedRef.current) {
        socketRef.current?.emit('viewport:update', bbox);
      } else if (fallbackRef.current) {
        const filtered = fallbackRef.current.getLatestPoints().filter((p) => {
          const [lng, lat] = p.location.coordinates;
          return isPointInBbox(lat, lng, bbox);
        });
        setVisibleVehicles(filtered);
      }
    }, 120);
  }, []);

  const setFallbackCity = useCallback((city: { name: string; lat: number; lng: number }) => {
    if (!fallbackRef.current) return;
    const info = fallbackRef.current.setCity(city.name, city.lat, city.lng);
    setActiveCity(info);
    setSelectedVehicleId(null);
    setFollowedVehicleId(null);
    setSelectedHistory([]);
    const { points, metrics: nextMetrics } = fallbackRef.current.step();
    setVisibleVehicles(points);
    setMetrics(nextMetrics);
  }, []);

  const updateFallbackConfig = useCallback(
    (patch: { vehicleCount?: number; speedLimitKmh?: number; isPaused?: boolean }) => {
      fallbackRef.current?.updateConfig(patch);
    },
    []
  );

  const injectFallbackAnomaly = useCallback((): string | null => {
    return fallbackRef.current?.injectAnomaly() ?? null;
  }, []);

  const selectedVehicle = useMemo(() => {
    if (!selectedVehicleId) return null;
    return (
      visibleVehicles.find((v) => v.meta.vehicleId === selectedVehicleId) ??
      selectedHistory[selectedHistory.length - 1] ??
      null
    );
  }, [selectedVehicleId, visibleVehicles, selectedHistory]);

  const bandwidthSavedPct = useMemo(() => {
    const total = metrics?.totalFleet ?? 0;
    if (total <= 0) return 0;
    const saved = Math.max(0, total - visibleVehicles.length);
    return Number(((saved / total) * 100).toFixed(1));
  }, [metrics?.totalFleet, visibleVehicles.length]);

  const toggleFollow = useCallback((vehicleId: string) => {
    setFollowedVehicleId((prev) => (prev === vehicleId ? null : vehicleId));
  }, []);

  const joinTrip = useCallback((token: string) => {
    socketRef.current?.emit('trip:join', token);
  }, []);

  const leaveTrip = useCallback((token: string) => {
    socketRef.current?.emit('trip:leave', token);
    setWatchedTrip(null);
  }, []);

  const publishTripPosition = useCallback(
    (payload: {
      token: string;
      currentLat: number;
      currentLng: number;
      heading: number;
      speedKmh: number;
      etaMinutes: number;
      remainingKm: number;
    }) => {
      socketRef.current?.emit('trip:position', payload);
    },
    []
  );

  return {
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
    selectedVehicleId,
    setSelectedVehicleId,
    selectedVehicle,
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
  };
}
