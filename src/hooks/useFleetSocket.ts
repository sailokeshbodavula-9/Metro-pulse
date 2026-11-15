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

  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting');
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

  useEffect(() => {
    fetch('/api/telemetry/anomalies?limit=60')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.anomalies) {
          setAnomalies(data.anomalies);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedVehicleId) {
      setSelectedHistory([]);
      return;
    }

    let cancelled = false;
    fetch(
      `/api/telemetry/history/${encodeURIComponent(selectedVehicleId)}?limit=60`
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
  }, [selectedVehicleId]);

  useEffect(() => {
    const socket = io('/telemetry', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      if (bboxRef.current) {
        socket.emit('viewport:update', bboxRef.current);
      }
    });

    socket.on('disconnect', () => {
      setConnectionState('disconnected');
    });

    socket.on('connect_error', () => {
      setConnectionState('disconnected');
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
      if (viewportDebounceRef.current) {
        window.clearTimeout(viewportDebounceRef.current);
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const updateViewport = useCallback((bbox: BoundingBox) => {
    bboxRef.current = bbox;
    if (viewportDebounceRef.current) {
      window.clearTimeout(viewportDebounceRef.current);
    }
    viewportDebounceRef.current = window.setTimeout(() => {
      socketRef.current?.emit('viewport:update', bbox);
    }, 120);
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
    joinTrip,
    leaveTrip,
    publishTripPosition,
  };
}
