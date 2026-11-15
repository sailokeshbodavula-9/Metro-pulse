import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {
  AlertTriangle,
  Bookmark,
  Box,
  ChevronDown,
  Compass,
  Crosshair,
  ExternalLink,
  Grid3x3,
  Layers,
  LocateFixed,
  MapPin,
  Minus,
  Moon,
  Navigation,
  Phone,
  Plus,
  Ruler,
  Satellite,
  Sun,
  TrainFront,
  TrendingUp,
  Undo2,
  X,
} from 'lucide-react';
import type { GpsStatus, LiveGpsPosition } from '../hooks/useLiveGps';
import type {
  ActiveCityInfo,
  AiRoutePlanResponse,
  AiRouteSuggestion,
  BoundingBox,
  DroppedPinInfo,
  MapBasemapTheme,
  PoiPlace,
  RoadIncident,
  SharedTripSession,
  SubscribedTile,
  TelemetryPoint,
} from '../types/telemetry';
import { NavigationHud, type UserNavPosition } from './NavigationHud';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

export type MapVehicleFilter = 'all' | 'normal' | 'delayed' | 'anomaly';

interface FleetMapProps {
  vehicles: TelemetryPoint[];
  subscribedTiles: SubscribedTile[];
  showSpatialGrid: boolean;
  onToggleSpatialGrid: () => void;
  vehicleFilter: MapVehicleFilter;
  onChangeVehicleFilter: (filter: MapVehicleFilter) => void;
  activeCity: ActiveCityInfo;
  onSelectCity: (city: { name: string; lat: number; lng: number }) => void;
  selectedVehicle: TelemetryPoint | null;
  selectedHistory: TelemetryPoint[];
  followedVehicleId: string | null;
  speedLimitKmh: number;
  onSelectVehicle: (vehicleId: string | null) => void;
  onToggleFollow: (vehicleId: string) => void;
  onViewportChange: (bbox: BoundingBox) => void;
  onMapCenterChange?: (center: { lat: number; lng: number }) => void;
  flyToTarget: { lng: number; lat: number; ts: number } | null;
  routePlan?: AiRoutePlanResponse | null;
  selectedRouteId?: string | null;
  onPlanRouteFromVehicle?: (vehicle: TelemetryPoint) => void;
  basemapTheme?: MapBasemapTheme;
  onChangeBasemapTheme?: (theme: MapBasemapTheme) => void;
  pois?: PoiPlace[];
  selectedPoi?: PoiPlace | null;
  onSelectPoi?: (poi: PoiPlace | null) => void;
  incidents?: RoadIncident[];
  droppedPin?: DroppedPinInfo | null;
  droppingPinLoading?: boolean;
  onMapClickCoord?: (coord: { lat: number; lng: number }) => void;
  onClearDroppedPin?: () => void;
  onRouteToLocation?: (target: { name: string; lat: number; lng: number }) => void;
  onSetOriginLocation?: (target: { name: string; lat: number; lng: number }) => void;
  onSavePlace?: (place: {
    label: string;
    tag: 'home' | 'work' | 'favorite';
    name: string;
    lat: number;
    lng: number;
  }) => void;
  onReportIncidentAt?: (coord: { lat: number; lng: number; label?: string }) => void;
  navigatingRoute?: AiRouteSuggestion | null;
  onExitNavigation?: () => void;
  onRerouteFromNav?: (pos: { lat: number; lng: number }) => void;
  onPublishTripPosition?: (payload: {
    token: string;
    currentLat: number;
    currentLng: number;
    heading: number;
    speedKmh: number;
    etaMinutes: number;
    remainingKm: number;
  }) => void;
  watchedTrip?: SharedTripSession | null;
  gpsStatus?: GpsStatus;
  gpsPosition?: LiveGpsPosition | null;
  gpsFollow?: boolean;
  gpsError?: string | null;
  onStartGps?: () => void;
  onStopGps?: () => void;
  onSetGpsFollow?: (follow: boolean) => void;
}

interface GeoPolygonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

interface GeoPointFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

interface GeoLineFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
}

type AnyGeoFeature = GeoPolygonFeature | GeoPointFeature | GeoLineFeature;

interface GeoFeatureCollection<T extends AnyGeoFeature = AnyGeoFeature> {
  type: 'FeatureCollection';
  features: T[];
}

const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const OPENFREEMAP_DAY_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    {
      id: 'sat-bg',
      type: 'background',
      paint: { 'background-color': '#090d13' },
    },
    {
      id: 'esri-sat-layer',
      type: 'raster',
      source: 'esri-satellite',
      minzoom: 0,
      maxzoom: 18,
    },
  ],
};

const DARK_FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    'esri-dark-gray': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; Esri',
    },
  },
  layers: [
    {
      id: 'water-bg',
      type: 'background',
      paint: { 'background-color': '#090d13' },
    },
    {
      id: 'esri-dark-layer',
      type: 'raster',
      source: 'esri-dark-gray',
      minzoom: 0,
      maxzoom: 16,
      paint: { 'raster-opacity': 0.94 },
    },
  ],
};

function getStyleForTheme(
  theme: MapBasemapTheme
): string | maplibregl.StyleSpecification {
  if (theme === 'day') return OPENFREEMAP_DAY_STYLE;
  if (theme === 'satellite') return SATELLITE_STYLE;
  return OPENFREEMAP_DARK_STYLE;
}

function createVehicleArrowImageData(): ImageData {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(size / 2, 5);
  ctx.lineTo(size - 9, size - 7);
  ctx.lineTo(size / 2, size - 15);
  ctx.lineTo(9, size - 7);
  ctx.closePath();
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

function createAnomalyBadgeImageData(): ImageData {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 20, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 15, 0, Math.PI * 2);
  ctx.fillStyle = '#ef4444';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(size / 2 - 2, size / 2 - 8, 4, 10);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2 + 7, 2.3, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

function createIncidentBadgeImageData(): ImageData {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.moveTo(size / 2, 6);
  ctx.lineTo(size - 6, size - 8);
  ctx.lineTo(6, size - 8);
  ctx.closePath();
  ctx.fillStyle = '#f59e0b';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#0f172a';
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(size / 2 - 2, 18, 4, 11);
  ctx.fillRect(size / 2 - 2, 32, 4, 4);

  return ctx.getImageData(0, 0, size, size);
}

function isWebGLSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

function buildVehicleGeoJson(
  vehicles: TelemetryPoint[],
  selectedId: string | null,
  filter: MapVehicleFilter
): GeoFeatureCollection<GeoPointFeature> {
  const filtered = vehicles.filter((v) => {
    if (filter === 'anomaly') return v.isAnomaly;
    if (filter === 'delayed') return !v.isAnomaly && v.speed < 22;
    if (filter === 'normal') return !v.isAnomaly && v.speed >= 22;
    return true;
  });

  return {
    type: 'FeatureCollection',
    features: filtered.map((v) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: v.location.coordinates,
      },
      properties: {
        vehicleId: v.meta.vehicleId,
        speed: v.speed,
        movingAvgSpeed: v.movingAvgSpeed,
        heading: v.heading,
        isAnomaly: v.isAnomaly,
        isSelected: v.meta.vehicleId === selectedId,
      },
    })),
  };
}

function buildTrafficFlowGeoJson(
  vehicles: TelemetryPoint[],
  showTrafficFlow: boolean
): GeoFeatureCollection<GeoLineFeature> {
  if (!showTrafficFlow || vehicles.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const byCorridor = new Map<string, TelemetryPoint[]>();
  for (const v of vehicles) {
    const list = byCorridor.get(v.meta.corridor) ?? [];
    list.push(v);
    byCorridor.set(v.meta.corridor, list);
  }

  const features: GeoLineFeature[] = [];
  for (const [corridor, list] of byCorridor.entries()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) =>
        a.location.coordinates[0] - b.location.coordinates[0] ||
        a.location.coordinates[1] - b.location.coordinates[1]
    );
    const avgSpeed =
      sorted.reduce((acc, item) => acc + item.speed, 0) / sorted.length;
    const hasAnomaly = sorted.some((v) => v.isAnomaly);
    const tier = hasAnomaly
      ? 'anomaly'
      : avgSpeed < 24
        ? 'congested'
        : avgSpeed < 36
          ? 'moderate'
          : 'clear';

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: sorted.map((v) => v.location.coordinates),
      },
      properties: { corridor, tier },
    });
  }
  return { type: 'FeatureCollection', features };
}

function buildTilesGeoJson(
  subscribedTiles: SubscribedTile[],
  showSpatialGrid: boolean
): GeoFeatureCollection<GeoPolygonFeature> {
  if (!showSpatialGrid) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: subscribedTiles.map((tile) => {
      const { west, south, east, north } = tile.bounds;
      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
        properties: { roomId: tile.roomId },
      };
    }),
  };
}

function buildRouteLinesGeoJson(
  routePlan: AiRoutePlanResponse | null | undefined,
  selectedRouteId: string | null | undefined,
  watchedTrip?: SharedTripSession | null
): GeoFeatureCollection<GeoLineFeature> {
  const features: GeoLineFeature[] = [];
  if (routePlan && routePlan.routes.length > 0) {
    const activeId = selectedRouteId || routePlan.routes[0].id;
    for (const r of routePlan.routes) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: r.geometry },
        properties: { routeId: r.id, isSelected: r.id === activeId },
      });
    }
  } else if (watchedTrip && watchedTrip.geometry.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: watchedTrip.geometry },
      properties: { routeId: watchedTrip.token, isSelected: true },
    });
  }
  return { type: 'FeatureCollection', features };
}

function buildRouteEndpointsGeoJson(
  routePlan: AiRoutePlanResponse | null | undefined,
  selectedRouteId: string | null | undefined,
  droppedPin?: DroppedPinInfo | null,
  userNavPos?: UserNavPosition | null,
  watchedTrip?: SharedTripSession | null
): GeoFeatureCollection<GeoPointFeature> {
  const features: GeoPointFeature[] = [];
  if (routePlan) {
    const activeRoute =
      routePlan.routes.find((r) => r.id === selectedRouteId) ||
      routePlan.routes[0];
    features.push(
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [routePlan.origin.lng, routePlan.origin.lat],
        },
        properties: { kind: 'origin' },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [routePlan.destination.lng, routePlan.destination.lat],
        },
        properties: { kind: 'destination' },
      }
    );
    if (activeRoute) {
      for (const wp of activeRoute.waypoints) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [wp.lng, wp.lat] },
          properties: { kind: 'waypoint' },
        });
      }
    }
  }

  if (droppedPin) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [droppedPin.lng, droppedPin.lat],
      },
      properties: { kind: 'dropped' },
    });
  }

  if (userNavPos) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [userNavPos.lng, userNavPos.lat],
      },
      properties: { kind: 'user_nav' },
    });
  }

  if (watchedTrip) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [watchedTrip.currentLng, watchedTrip.currentLat],
      },
      properties: { kind: 'user_nav' },
    });
  }

  return { type: 'FeatureCollection', features };
}

function buildPoisGeoJson(
  pois: PoiPlace[] = [],
  selectedPoi?: PoiPlace | null
): GeoFeatureCollection<GeoPointFeature> {
  return {
    type: 'FeatureCollection',
    features: pois.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        poiId: p.id,
        category: p.category,
        isSelected: selectedPoi?.id === p.id,
      },
    })),
  };
}

function buildIncidentsGeoJson(
  incidents: RoadIncident[] = []
): GeoFeatureCollection<GeoPointFeature> {
  return {
    type: 'FeatureCollection',
    features: incidents.map((inc) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [inc.lng, inc.lat] },
      properties: {
        incidentId: inc.id,
        type: inc.type,
        title: inc.title,
      },
    })),
  };
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildLiveGpsAccuracyGeoJson(
  gpsPosition: LiveGpsPosition | null | undefined
): GeoFeatureCollection<GeoPolygonFeature> {
  if (!gpsPosition) return { type: 'FeatureCollection', features: [] };
  const radiusM = Math.max(12, Math.min(2000, gpsPosition.accuracyMeters));
  const steps = 40;
  const latRad = (gpsPosition.lat * Math.PI) / 180;
  const degLat = radiusM / 111320;
  const degLng = radiusM / (111320 * Math.max(0.2, Math.cos(latRad)));
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    ring.push([
      gpsPosition.lng + Math.cos(theta) * degLng,
      gpsPosition.lat + Math.sin(theta) * degLat,
    ]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { accuracy: radiusM },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
  };
}

function buildLiveGpsPointGeoJson(
  gpsPosition: LiveGpsPosition | null | undefined
): GeoFeatureCollection<GeoPointFeature> {
  if (!gpsPosition) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [gpsPosition.lng, gpsPosition.lat],
        },
        properties: {
          heading: gpsPosition.heading ?? 0,
        },
      },
    ],
  };
}

function buildMeasureLinesGeoJson(
  points: Array<[number, number]>
): GeoFeatureCollection<GeoLineFeature> {
  if (points.length < 2) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: points },
        properties: {},
      },
    ],
  };
}

function buildMeasurePointsGeoJson(
  points: Array<[number, number]>
): GeoFeatureCollection<GeoPointFeature> {
  return {
    type: 'FeatureCollection',
    features: points.map((pt, idx) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pt },
      properties: { idx },
    })),
  };
}

function SpeedHistoryChart({
  history,
  speedLimitKmh,
}: {
  history: TelemetryPoint[];
  speedLimitKmh: number;
}) {
  const width = 300;
  const height = 82;
  const padX = 4;
  const padY = 8;

  const { rawPath, avgPath, limitY, maxSpeed } = useMemo(() => {
    const pts = history.length > 0 ? history : [];
    const peak = Math.max(
      speedLimitKmh + 15,
      ...pts.map((p) => Math.max(p.speed, p.movingAvgSpeed))
    );
    const maxVal = Math.max(80, Math.ceil(peak / 10) * 10);
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    const toY = (val: number) =>
      padY + plotH - (Math.min(maxVal, Math.max(0, val)) / maxVal) * plotH;
    const toX = (idx: number, total: number) =>
      total <= 1 ? padX : padX + (idx / (total - 1)) * plotW;

    const rPath = pts
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'}${toX(i, pts.length).toFixed(1)},${toY(p.speed).toFixed(1)}`
      )
      .join(' ');

    const aPath = pts
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'}${toX(i, pts.length).toFixed(1)},${toY(p.movingAvgSpeed).toFixed(1)}`
      )
      .join(' ');

    return {
      rawPath: rPath,
      avgPath: aPath,
      limitY: toY(speedLimitKmh),
      maxSpeed: maxVal,
    };
  }, [history, speedLimitKmh]);

  if (history.length < 2) {
    return (
      <div className="h-20 flex items-center justify-center text-xs text-slate-400 font-mono">
        Collecting sliding-window samples...
      </div>
    );
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-20 overflow-visible"
        role="img"
        aria-label="Vehicle speed vs sliding window moving average chart"
      >
        <line
          x1={padX}
          y1={limitY}
          x2={width - padX}
          y2={limitY}
          stroke="#f59e0b"
          strokeOpacity="0.65"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        <path
          d={rawPath}
          fill="none"
          stroke="#64748b"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d={avgPath}
          fill="none"
          stroke="#22c55e"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mt-1">
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-0.5 bg-slate-400 inline-block" />
            Raw
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-0.5 bg-emerald-500 inline-block" />
            Moving Avg
          </span>
        </span>
        <span>0–{maxSpeed} km/h</span>
      </div>
    </div>
  );
}

function CanvasFallbackMap({
  vehicles,
  subscribedTiles,
  showSpatialGrid,
  vehicleFilter,
  activeCity,
  selectedVehicleId,
  routePlan,
  selectedRouteId,
  onSelectVehicle,
  onViewportChange,
  flyToTarget,
}: {
  vehicles: TelemetryPoint[];
  subscribedTiles: SubscribedTile[];
  showSpatialGrid: boolean;
  vehicleFilter: MapVehicleFilter;
  activeCity: ActiveCityInfo;
  selectedVehicleId: string | null;
  routePlan?: AiRoutePlanResponse | null;
  selectedRouteId?: string | null;
  onSelectVehicle: (id: string | null) => void;
  onViewportChange: (bbox: BoundingBox) => void;
  flyToTarget: { lng: number; lat: number; ts: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({
    centerLng: activeCity.lng,
    centerLat: activeCity.lat,
    zoom: 12.6,
  });
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startLng: activeCity.lng,
    startLat: activeCity.lat,
    moved: false,
  });

  const emitBounds = (width: number, height: number) => {
    const { centerLng, centerLat, zoom } = viewRef.current;
    const scale = 256 * Math.pow(2, zoom);
    const degPerPxLng = 360 / scale;
    const degPerPxLat =
      (360 * Math.cos((centerLat * Math.PI) / 180)) / scale;
    const halfW = (width / 2) * degPerPxLng;
    const halfH = (height / 2) * degPerPxLat;
    onViewportChange({
      north: Number((centerLat + halfH).toFixed(6)),
      south: Number((centerLat - halfH).toFixed(6)),
      east: Number((centerLng + halfW).toFixed(6)),
      west: Number((centerLng - halfW).toFixed(6)),
      zoom: Number(zoom.toFixed(2)),
    });
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    viewRef.current = {
      centerLng: activeCity.lng,
      centerLat: activeCity.lat,
      zoom: 12.6,
    };
    emitBounds(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCity.lat, activeCity.lng]);

  useEffect(() => {
    if (!flyToTarget || !canvasRef.current) return;
    viewRef.current = {
      centerLng: flyToTarget.lng,
      centerLat: flyToTarget.lat,
      zoom: 14.2,
    };
    emitBounds(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTarget]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 500;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { centerLng, centerLat, zoom } = viewRef.current;
    const scale = 256 * Math.pow(2, zoom);
    const pxPerDegLng = scale / 360;
    const pxPerDegLat = scale / (360 * Math.cos((centerLat * Math.PI) / 180));

    const project = (lng: number, lat: number): [number, number] => [
      width / 2 + (lng - centerLng) * pxPerDegLng,
      height / 2 - (lat - centerLat) * pxPerDegLat,
    ];

    ctx.fillStyle = '#090d13';
    ctx.fillRect(0, 0, width, height);

    if (showSpatialGrid) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      for (const tile of subscribedTiles) {
        const [x1, y1] = project(tile.bounds.west, tile.bounds.north);
        const [x2, y2] = project(tile.bounds.east, tile.bounds.south);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.03)';
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      }
      ctx.restore();
    }

    if (routePlan) {
      for (const r of routePlan.routes) {
        const isActive = r.id === (selectedRouteId || routePlan.routes[0]?.id);
        ctx.beginPath();
        r.geometry.forEach((pt, idx) => {
          const [px, py] = project(pt[0], pt[1]);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = isActive ? '#38bdf8' : 'rgba(148,163,184,0.45)';
        ctx.lineWidth = isActive ? 4 : 2;
        ctx.stroke();
      }
    }

    const filtered = vehicles.filter((v) => {
      if (vehicleFilter === 'anomaly') return v.isAnomaly;
      if (vehicleFilter === 'delayed') return !v.isAnomaly && v.speed < 22;
      if (vehicleFilter === 'normal') return !v.isAnomaly && v.speed >= 22;
      return true;
    });

    for (const v of filtered) {
      const [x, y] = project(
        v.location.coordinates[0],
        v.location.coordinates[1]
      );
      const isSelected = v.meta.vehicleId === selectedVehicleId;
      const color = isSelected
        ? '#38bdf8'
        : v.isAnomaly
          ? '#ef4444'
          : v.speed < 22
            ? '#f59e0b'
            : '#22c55e';

      if (v.isAnomaly) {
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 1, y - 4, 2, 5);
        ctx.fillRect(x - 1, y + 2, 2, 2);
      } else {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((v.heading * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(6, 6);
        ctx.lineTo(0, 2);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }

      if (isSelected || v.isAnomaly || zoom >= 12.6) {
        ctx.font = '600 10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(9, 13, 19, 0.85)';
        const label = v.meta.vehicleId;
        const w = ctx.measureText(label).width + 6;
        ctx.fillRect(x - w / 2, y + 9, w, 13);
        ctx.fillStyle = isSelected ? '#38bdf8' : v.isAnomaly ? '#fca5a5' : '#e2e8f0';
        ctx.fillText(label, x, y + 19);
      }
    }
  }, [
    vehicles,
    subscribedTiles,
    showSpatialGrid,
    selectedVehicleId,
    vehicleFilter,
    routePlan,
    selectedRouteId,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
      onMouseDown={(e) => {
        dragRef.current = {
          active: true,
          startX: e.clientX,
          startY: e.clientY,
          startLng: viewRef.current.centerLng,
          startLat: viewRef.current.centerLat,
          moved: false,
        };
      }}
      onMouseMove={(e) => {
        if (!dragRef.current.active || !canvasRef.current) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
        const scale = 256 * Math.pow(2, viewRef.current.zoom);
        const pxPerDegLng = scale / 360;
        const pxPerDegLat =
          scale /
          (360 * Math.cos((dragRef.current.startLat * Math.PI) / 180));
        viewRef.current.centerLng = dragRef.current.startLng - dx / pxPerDegLng;
        viewRef.current.centerLat = dragRef.current.startLat + dy / pxPerDegLat;
      }}
      onMouseUp={(e) => {
        const wasMoved = dragRef.current.moved;
        dragRef.current.active = false;
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (wasMoved) {
          emitBounds(canvas.clientWidth, canvas.clientHeight);
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const { centerLng, centerLat, zoom } = viewRef.current;
        const scale = 256 * Math.pow(2, zoom);
        const pxPerDegLng = scale / 360;
        const pxPerDegLat =
          scale / (360 * Math.cos((centerLat * Math.PI) / 180));
        let closest: string | null = null;
        let minDist = 18;
        for (const v of vehicles) {
          const vx =
            rect.width / 2 +
            (v.location.coordinates[0] - centerLng) * pxPerDegLng;
          const vy =
            rect.height / 2 -
            (v.location.coordinates[1] - centerLat) * pxPerDegLat;
          const dist = Math.hypot(vx - clickX, vy - clickY);
          if (dist < minDist) {
            minDist = dist;
            closest = v.meta.vehicleId;
          }
        }
        if (closest) onSelectVehicle(closest);
      }}
      onWheel={(e) => {
        if (!canvasRef.current) return;
        const delta = e.deltaY > 0 ? -0.35 : 0.35;
        viewRef.current.zoom = Math.max(
          2,
          Math.min(17, viewRef.current.zoom + delta)
        );
        emitBounds(
          canvasRef.current.clientWidth,
          canvasRef.current.clientHeight
        );
      }}
    />
  );
}

export function FleetMap({
  vehicles,
  subscribedTiles,
  showSpatialGrid,
  onToggleSpatialGrid,
  vehicleFilter,
  onChangeVehicleFilter,
  activeCity,
  onSelectCity,
  selectedVehicle,
  selectedHistory,
  followedVehicleId,
  speedLimitKmh,
  onSelectVehicle,
  onToggleFollow,
  onViewportChange,
  onMapCenterChange,
  flyToTarget,
  routePlan,
  selectedRouteId,
  onPlanRouteFromVehicle,
  basemapTheme = 'dark',
  onChangeBasemapTheme,
  pois = [],
  selectedPoi,
  onSelectPoi,
  incidents = [],
  droppedPin,
  droppingPinLoading = false,
  onMapClickCoord,
  onClearDroppedPin,
  onRouteToLocation,
  onSetOriginLocation,
  onSavePlace,
  onReportIncidentAt,
  navigatingRoute,
  onExitNavigation,
  onRerouteFromNav,
  onPublishTripPosition,
  watchedTrip,
  gpsStatus = 'off',
  gpsPosition = null,
  gpsFollow = false,
  gpsError = null,
  onStartGps,
  onStopGps,
  onSetGpsFollow,
}: FleetMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const [useCanvasFallback, setUseCanvasFallback] = useState(
    () => !isWebGLSupported()
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [showTrafficFlow, setShowTrafficFlow] = useState(false);
  const [show3DBuildings, setShow3DBuildings] = useState(false);
  const [showVehicleLabels, setShowVehicleLabels] = useState(true);
  const [userNavPos, setUserNavPos] = useState<UserNavPosition | null>(null);
  const [measureActive, setMeasureActive] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Array<[number, number]>>([]);
  const [mapBearing, setMapBearing] = useState(0);
  const [mapPitch, setMapPitch] = useState(0);
  const [mapZoom, setMapZoom] = useState(12.6);
  const [cursorCoords, setCursorCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [gpsCardDismissed, setGpsCardDismissed] = useState(false);

  const onViewportRef = useRef(onViewportChange);
  const onCenterRef = useRef(onMapCenterChange);
  const onSelectRef = useRef(onSelectVehicle);
  const onSelectPoiRef = useRef(onSelectPoi);
  const onMapClickRef = useRef(onMapClickCoord);
  const onSetGpsFollowRef = useRef(onSetGpsFollow);

  const latestVehiclesRef = useRef(vehicles);
  const latestTilesRef = useRef(subscribedTiles);
  const latestGridRef = useRef(showSpatialGrid);
  const latestFilterRef = useRef(vehicleFilter);
  const latestSelectedIdRef = useRef(selectedVehicle?.meta.vehicleId ?? null);
  const latestRoutePlanRef = useRef(routePlan);
  const latestSelectedRouteIdRef = useRef(selectedRouteId);
  const latestPoisRef = useRef(pois);
  const latestSelectedPoiRef = useRef(selectedPoi);
  const latestIncidentsRef = useRef(incidents);
  const latestDroppedPinRef = useRef(droppedPin);
  const latestUserNavRef = useRef(userNavPos);
  const latestWatchedTripRef = useRef(watchedTrip);
  const latestTrafficFlowRef = useRef(showTrafficFlow);
  const latest3DRef = useRef(show3DBuildings);
  const latestVehicleLabelsRef = useRef(showVehicleLabels);
  const latestGpsRef = useRef(gpsPosition);
  const latestMeasurePointsRef = useRef(measurePoints);
  const measureActiveRef = useRef(measureActive);
  const appliedThemeRef = useRef<MapBasemapTheme>(basemapTheme);

  useEffect(() => {
    onViewportRef.current = onViewportChange;
  }, [onViewportChange]);
  useEffect(() => {
    onCenterRef.current = onMapCenterChange;
  }, [onMapCenterChange]);
  useEffect(() => {
    onSelectRef.current = onSelectVehicle;
  }, [onSelectVehicle]);
  useEffect(() => {
    onSelectPoiRef.current = onSelectPoi;
  }, [onSelectPoi]);
  useEffect(() => {
    onMapClickRef.current = onMapClickCoord;
  }, [onMapClickCoord]);
  useEffect(() => {
    onSetGpsFollowRef.current = onSetGpsFollow;
  }, [onSetGpsFollow]);
  useEffect(() => {
    latestGpsRef.current = gpsPosition;
  }, [gpsPosition]);
  useEffect(() => {
    latestMeasurePointsRef.current = measurePoints;
  }, [measurePoints]);
  useEffect(() => {
    measureActiveRef.current = measureActive;
  }, [measureActive]);
  useEffect(() => {
    latestVehiclesRef.current = vehicles;
  }, [vehicles]);
  useEffect(() => {
    latestTilesRef.current = subscribedTiles;
  }, [subscribedTiles]);
  useEffect(() => {
    latestGridRef.current = showSpatialGrid;
  }, [showSpatialGrid]);
  useEffect(() => {
    latestFilterRef.current = vehicleFilter;
  }, [vehicleFilter]);
  useEffect(() => {
    latestSelectedIdRef.current = selectedVehicle?.meta.vehicleId ?? null;
  }, [selectedVehicle?.meta.vehicleId]);
  useEffect(() => {
    latestRoutePlanRef.current = routePlan;
  }, [routePlan]);
  useEffect(() => {
    latestSelectedRouteIdRef.current = selectedRouteId;
  }, [selectedRouteId]);
  useEffect(() => {
    latestPoisRef.current = pois;
  }, [pois]);
  useEffect(() => {
    latestSelectedPoiRef.current = selectedPoi;
  }, [selectedPoi]);
  useEffect(() => {
    latestIncidentsRef.current = incidents;
  }, [incidents]);
  useEffect(() => {
    latestDroppedPinRef.current = droppedPin;
  }, [droppedPin]);
  useEffect(() => {
    latestUserNavRef.current = userNavPos;
  }, [userNavPos]);
  useEffect(() => {
    latestWatchedTripRef.current = watchedTrip;
  }, [watchedTrip]);
  useEffect(() => {
    latestTrafficFlowRef.current = showTrafficFlow;
  }, [showTrafficFlow]);
  useEffect(() => {
    latest3DRef.current = show3DBuildings;
  }, [show3DBuildings]);
  useEffect(() => {
    latestVehicleLabelsRef.current = showVehicleLabels;
  }, [showVehicleLabels]);

  const syncAllOverlayLayers = (map: maplibregl.Map) => {
    if (!map.hasImage('vehicle-arrow')) {
      map.addImage('vehicle-arrow', createVehicleArrowImageData(), { sdf: true });
    }
    if (!map.hasImage('anomaly-badge')) {
      map.addImage('anomaly-badge', createAnomalyBadgeImageData());
    }
    if (!map.hasImage('incident-badge')) {
      map.addImage('incident-badge', createIncidentBadgeImageData());
    }

    // Optional 3D Buildings extrusion on vector OpenFreeMap styles
    if (latest3DRef.current && map.getSource('openmaptiles') && !map.getLayer('3d-buildings-extrusion')) {
      try {
        map.addLayer({
          id: '3d-buildings-extrusion',
          source: 'openmaptiles',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#1e293b',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.72,
          },
        });
      } catch {
        // Ignore if vector source schema differs
      }
    }

    if (!map.getSource('spatial-tiles')) {
      map.addSource('spatial-tiles', {
        type: 'geojson',
        data: buildTilesGeoJson(latestTilesRef.current, latestGridRef.current),
      });
      map.addLayer({
        id: 'spatial-tiles-fill',
        type: 'fill',
        source: 'spatial-tiles',
        paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.02 },
      });
      map.addLayer({
        id: 'spatial-tiles-line',
        type: 'line',
        source: 'spatial-tiles',
        paint: {
          'line-color': '#64748b',
          'line-opacity': 0.25,
          'line-width': 1,
          'line-dasharray': [3, 3],
        },
      });
    }

    if (!map.getSource('traffic-flow')) {
      map.addSource('traffic-flow', {
        type: 'geojson',
        data: buildTrafficFlowGeoJson(
          latestVehiclesRef.current,
          latestTrafficFlowRef.current
        ),
      });
      map.addLayer({
        id: 'traffic-flow-line',
        type: 'line',
        source: 'traffic-flow',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'tier'],
            'anomaly',
            '#ef4444',
            'congested',
            '#f59e0b',
            'moderate',
            '#38bdf8',
            '#22c55e',
          ],
          'line-width': 2.5,
          'line-opacity': 0.45,
        },
      });
    }

    if (!map.getSource('ai-routes')) {
      map.addSource('ai-routes', {
        type: 'geojson',
        data: buildRouteLinesGeoJson(
          latestRoutePlanRef.current,
          latestSelectedRouteIdRef.current,
          latestWatchedTripRef.current
        ),
      });
      map.addLayer({
        id: 'ai-routes-alternate',
        type: 'line',
        source: 'ai-routes',
        filter: ['!=', ['get', 'isSelected'], true],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#64748b',
          'line-width': 3,
          'line-opacity': 0.55,
          'line-dasharray': [2, 2],
        },
      });
      map.addLayer({
        id: 'ai-routes-active-glow',
        type: 'line',
        source: 'ai-routes',
        filter: ['==', ['get', 'isSelected'], true],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': 9,
          'line-opacity': 0.28,
        },
      });
      map.addLayer({
        id: 'ai-routes-active',
        type: 'line',
        source: 'ai-routes',
        filter: ['==', ['get', 'isSelected'], true],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': 4.5,
          'line-opacity': 0.96,
        },
      });
    }

    if (!map.getSource('pois')) {
      map.addSource('pois', {
        type: 'geojson',
        data: buildPoisGeoJson(latestPoisRef.current, latestSelectedPoiRef.current),
      });
      map.addLayer({
        id: 'pois-circle',
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'isSelected'], true], 9, 6.5],
          'circle-color': [
            'match',
            ['get', 'category'],
            'charging',
            '#22c55e',
            'fuel',
            '#f59e0b',
            'hospital',
            '#ef4444',
            'transit',
            '#38bdf8',
            '#a855f7',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    if (!map.getSource('incidents')) {
      map.addSource('incidents', {
        type: 'geojson',
        data: buildIncidentsGeoJson(latestIncidentsRef.current),
      });
      map.addLayer({
        id: 'incidents-symbol',
        type: 'symbol',
        source: 'incidents',
        layout: {
          'icon-image': 'incident-badge',
          'icon-size': 0.56,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }

    if (!map.getSource('ai-route-endpoints')) {
      map.addSource('ai-route-endpoints', {
        type: 'geojson',
        data: buildRouteEndpointsGeoJson(
          latestRoutePlanRef.current,
          latestSelectedRouteIdRef.current,
          latestDroppedPinRef.current,
          latestUserNavRef.current,
          latestWatchedTripRef.current
        ),
      });
      map.addLayer({
        id: 'ai-route-pins',
        type: 'circle',
        source: 'ai-route-endpoints',
        paint: {
          'circle-radius': [
            'match',
            ['get', 'kind'],
            'waypoint',
            5,
            'user_nav',
            10,
            8,
          ],
          'circle-color': [
            'match',
            ['get', 'kind'],
            'origin',
            '#22c55e',
            'destination',
            '#ef4444',
            'dropped',
            '#f59e0b',
            'user_nav',
            '#0ea5e9',
            '#38bdf8',
          ],
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    if (!map.getSource('vehicles')) {
      map.addSource('vehicles', {
        type: 'geojson',
        data: buildVehicleGeoJson(
          latestVehiclesRef.current,
          latestSelectedIdRef.current,
          latestFilterRef.current
        ),
      });
      map.addLayer({
        id: 'vehicles-selected-ring',
        type: 'circle',
        source: 'vehicles',
        filter: ['==', ['get', 'isSelected'], true],
        paint: {
          'circle-radius': 17,
          'circle-color': 'rgba(56, 189, 248, 0.16)',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#38bdf8',
        },
      });
      map.addLayer({
        id: 'vehicles-symbol',
        type: 'symbol',
        source: 'vehicles',
        filter: ['!=', ['get', 'isAnomaly'], true],
        layout: {
          'icon-image': 'vehicle-arrow',
          'icon-size': ['case', ['==', ['get', 'isSelected'], true], 0.56, 0.44],
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': [
            'case',
            ['==', ['get', 'isSelected'], true],
            '#38bdf8',
            ['<', ['get', 'speed'], 22],
            '#f59e0b',
            '#22c55e',
          ],
        },
      });
      map.addLayer({
        id: 'vehicles-anomaly-badge',
        type: 'symbol',
        source: 'vehicles',
        filter: ['==', ['get', 'isAnomaly'], true],
        layout: {
          'icon-image': 'anomaly-badge',
          'icon-size': ['case', ['==', ['get', 'isSelected'], true], 0.62, 0.5],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
      map.addLayer({
        id: 'vehicles-label',
        type: 'symbol',
        source: 'vehicles',
        minzoom: 11,
        filter: [
          'all',
          ['!=', ['get', 'isSelected'], true],
          ['!=', ['get', 'isAnomaly'], true],
        ],
        layout: {
          visibility: latestVehicleLabelsRef.current ? 'visible' : 'none',
          'text-field': ['get', 'vehicleId'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-optional': true,
          'text-padding': 4,
        },
        paint: {
          'text-color':
            appliedThemeRef.current === 'day' ? '#0f172a' : '#e2e8f0',
          'text-halo-color':
            appliedThemeRef.current === 'day' ? '#ffffff' : '#090d13',
          'text-halo-width': 1.8,
        },
      });
      map.addLayer({
        id: 'vehicles-label-priority',
        type: 'symbol',
        source: 'vehicles',
        filter: [
          'any',
          ['==', ['get', 'isSelected'], true],
          ['==', ['get', 'isAnomaly'], true],
        ],
        layout: {
          visibility: latestVehicleLabelsRef.current ? 'visible' : 'none',
          'text-field': [
            'concat',
            ['get', 'vehicleId'],
            ' · ',
            ['to-string', ['round', ['get', 'speed']]],
            ' km/h',
          ],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.25],
          'text-anchor': 'top',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': [
            'case',
            ['==', ['get', 'isSelected'], true],
            '#38bdf8',
            '#fca5a5',
          ],
          'text-halo-color':
            appliedThemeRef.current === 'day' ? '#0f172a' : '#090d13',
          'text-halo-width': 2,
        },
      });
    }

    if (!map.getSource('measure-line')) {
      map.addSource('measure-line', {
        type: 'geojson',
        data: buildMeasureLinesGeoJson(latestMeasurePointsRef.current),
      });
      map.addLayer({
        id: 'measure-line-layer',
        type: 'line',
        source: 'measure-line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#f59e0b',
          'line-width': 3,
          'line-dasharray': [2, 1.5],
        },
      });
    }

    if (!map.getSource('measure-points')) {
      map.addSource('measure-points', {
        type: 'geojson',
        data: buildMeasurePointsGeoJson(latestMeasurePointsRef.current),
      });
      map.addLayer({
        id: 'measure-points-circle',
        type: 'circle',
        source: 'measure-points',
        paint: {
          'circle-radius': 5.5,
          'circle-color': '#fbbf24',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0f172a',
        },
      });
    }

    if (!map.getSource('live-gps-accuracy')) {
      map.addSource('live-gps-accuracy', {
        type: 'geojson',
        data: buildLiveGpsAccuracyGeoJson(latestGpsRef.current),
      });
      map.addLayer({
        id: 'live-gps-accuracy-fill',
        type: 'fill',
        source: 'live-gps-accuracy',
        paint: {
          'fill-color': '#0ea5e9',
          'fill-opacity': 0.14,
        },
      });
      map.addLayer({
        id: 'live-gps-accuracy-ring',
        type: 'line',
        source: 'live-gps-accuracy',
        paint: {
          'line-color': '#38bdf8',
          'line-width': 1.5,
          'line-opacity': 0.55,
        },
      });
    }

    if (!map.getSource('live-gps-point')) {
      map.addSource('live-gps-point', {
        type: 'geojson',
        data: buildLiveGpsPointGeoJson(latestGpsRef.current),
      });
      map.addLayer({
        id: 'live-gps-halo',
        type: 'circle',
        source: 'live-gps-point',
        paint: {
          'circle-radius': 15,
          'circle-color': 'rgba(14, 165, 233, 0.25)',
        },
      });
      map.addLayer({
        id: 'live-gps-core',
        type: 'circle',
        source: 'live-gps-point',
        paint: {
          'circle-radius': 7.5,
          'circle-color': '#0284c7',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
  };

  useEffect(() => {
    if (useCanvasFallback || !containerRef.current || mapRef.current) return;

    let map: maplibregl.Map;
    let fallbackApplied = false;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: getStyleForTheme(basemapTheme),
        center: [activeCity.lng, activeCity.lat],
        zoom: 12.6,
        minZoom: 2,
        maxZoom: 18,
        attributionControl: { compact: true },
      });
    } catch {
      setUseCanvasFallback(true);
      return;
    }

    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }),
      'bottom-right'
    );

    const emitBounds = () => {
      const b = map.getBounds();
      const c = map.getCenter();
      onViewportRef.current({
        north: Number(b.getNorth().toFixed(6)),
        south: Number(b.getSouth().toFixed(6)),
        east: Number(b.getEast().toFixed(6)),
        west: Number(b.getWest().toFixed(6)),
        zoom: Number(map.getZoom().toFixed(2)),
      });
      onCenterRef.current?.({
        lat: Number(c.lat.toFixed(6)),
        lng: Number(c.lng.toFixed(6)),
      });
    };

    map.on('error', (ev) => {
      const msg = ev?.error?.message || '';
      if (msg.toLowerCase().includes('webgl')) {
        setUseCanvasFallback(true);
        return;
      }
      if (!mapReadyRef.current && !fallbackApplied) {
        fallbackApplied = true;
        map.setStyle(DARK_FALLBACK_STYLE);
      }
    });

    map.on('style.load', () => {
      syncAllOverlayLayers(map);
    });

    map.on('load', () => {
      syncAllOverlayLayers(map);

      const handleVehicleClick = (e: maplibregl.MapLayerMouseEvent) => {
        const vid = e.features?.[0]?.properties?.vehicleId;
        if (typeof vid === 'string') {
          onSelectRef.current(vid);
        }
      };

      const handlePoiClick = (e: maplibregl.MapLayerMouseEvent) => {
        const pid = e.features?.[0]?.properties?.poiId;
        if (typeof pid === 'string') {
          const hit = latestPoisRef.current.find((p) => p.id === pid);
          if (hit) onSelectPoiRef.current?.(hit);
        }
      };

      map.on('click', 'vehicles-symbol', handleVehicleClick);
      map.on('click', 'vehicles-anomaly-badge', handleVehicleClick);
      map.on('click', 'vehicles-label', handleVehicleClick);
      map.on('click', 'vehicles-label-priority', handleVehicleClick);
      map.on('click', 'pois-circle', handlePoiClick);

      map.on('click', (e) => {
        if (measureActiveRef.current) {
          setMeasurePoints((prev) => [
            ...prev,
            [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))],
          ]);
          return;
        }
        const hits = map.queryRenderedFeatures(e.point, {
          layers: [
            'vehicles-symbol',
            'vehicles-anomaly-badge',
            'vehicles-label',
            'vehicles-label-priority',
            'pois-circle',
          ].filter((l) => Boolean(map.getLayer(l))),
        });
        if (hits.length === 0) {
          onMapClickRef.current?.({
            lat: Number(e.lngLat.lat.toFixed(6)),
            lng: Number(e.lngLat.lng.toFixed(6)),
          });
        }
      });

      for (const layerId of [
        'vehicles-symbol',
        'vehicles-anomaly-badge',
        'vehicles-label',
        'vehicles-label-priority',
        'pois-circle',
      ]) {
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = measureActiveRef.current ? 'crosshair' : '';
        });
      }

      mapReadyRef.current = true;
      map.resize();
      emitBounds();
    });

    map.on('dragstart', () => {
      onSetGpsFollowRef.current?.(false);
    });
    map.on('mousemove', (e) => {
      setCursorCoords({
        lat: Number(e.lngLat.lat.toFixed(5)),
        lng: Number(e.lngLat.lng.toFixed(5)),
      });
    });
    map.on('move', () => {
      setMapBearing(Math.round(map.getBearing()));
      setMapPitch(Math.round(map.getPitch()));
      setMapZoom(Number(map.getZoom().toFixed(1)));
    });
    map.on('moveend', emitBounds);
    map.on('zoomend', emitBounds);

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(containerRef.current);

    mapRef.current = map;

    return () => {
      resizeObserver.disconnect();
      mapReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCanvasFallback]);

  // Switch basemap theme live (Dark / Day / Satellite)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    if (appliedThemeRef.current === basemapTheme) return;
    appliedThemeRef.current = basemapTheme;
    map.setStyle(getStyleForTheme(basemapTheme));
  }, [basemapTheme]);

  // Toggle 3D extruded buildings
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    if (show3DBuildings) {
      map.easeTo({ pitch: 48, duration: 550 });
      syncAllOverlayLayers(map);
    } else {
      map.easeTo({ pitch: 0, duration: 450 });
      if (map.getLayer('3d-buildings-extrusion')) {
        map.removeLayer('3d-buildings-extrusion');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show3DBuildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    map.flyTo({
      center: [activeCity.lng, activeCity.lat],
      zoom: 12.6,
      duration: 900,
    });
  }, [activeCity.lat, activeCity.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const source = map.getSource('vehicles') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (source) {
      source.setData(
        buildVehicleGeoJson(
          vehicles,
          selectedVehicle?.meta.vehicleId ?? null,
          vehicleFilter
        )
      );
    }
    const trafficSource = map.getSource('traffic-flow') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (trafficSource) {
      trafficSource.setData(buildTrafficFlowGeoJson(vehicles, showTrafficFlow));
    }
  }, [vehicles, selectedVehicle?.meta.vehicleId, vehicleFilter, showTrafficFlow]);

  // Toggle vehicle registration number labels
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const vis = showVehicleLabels ? 'visible' : 'none';
    if (map.getLayer('vehicles-label')) {
      map.setLayoutProperty('vehicles-label', 'visibility', vis);
    }
    if (map.getLayer('vehicles-label-priority')) {
      map.setLayoutProperty('vehicles-label-priority', 'visibility', vis);
    }
  }, [showVehicleLabels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const source = map.getSource('spatial-tiles') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (source) {
      source.setData(buildTilesGeoJson(subscribedTiles, showSpatialGrid));
    }
  }, [subscribedTiles, showSpatialGrid]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const poiSource = map.getSource('pois') as maplibregl.GeoJSONSource | undefined;
    if (poiSource) {
      poiSource.setData(buildPoisGeoJson(pois, selectedPoi));
    }
  }, [pois, selectedPoi]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const incSource = map.getSource('incidents') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (incSource) {
      incSource.setData(buildIncidentsGeoJson(incidents));
    }
  }, [incidents]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const lineSource = map.getSource('ai-routes') as
      | maplibregl.GeoJSONSource
      | undefined;
    const pinSource = map.getSource('ai-route-endpoints') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (lineSource) {
      lineSource.setData(
        buildRouteLinesGeoJson(routePlan, selectedRouteId, watchedTrip)
      );
    }
    if (pinSource) {
      pinSource.setData(
        buildRouteEndpointsGeoJson(
          routePlan,
          selectedRouteId,
          droppedPin,
          userNavPos,
          watchedTrip
        )
      );
    }
  }, [routePlan, selectedRouteId, droppedPin, userNavPos, watchedTrip]);

  // Fit bounds when a new route plan is generated or switched
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current || !routePlan || navigatingRoute) return;
    const active =
      routePlan.routes.find((r) => r.id === selectedRouteId) ||
      routePlan.routes[0];
    const pts =
      active && active.geometry.length >= 2
        ? active.geometry
        : [
            [routePlan.origin.lng, routePlan.origin.lat],
            [routePlan.destination.lng, routePlan.destination.lat],
          ];
    const bounds = new maplibregl.LngLatBounds(
      pts[0] as [number, number],
      pts[0] as [number, number]
    );
    for (const p of pts) {
      bounds.extend(p as [number, number]);
    }
    map.fitBounds(bounds, { padding: 54, maxZoom: 14.4, duration: 750 });
  }, [routePlan, selectedRouteId, navigatingRoute]);

  // Heading-up camera tracking while in active Turn-by-Turn Navigation Mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !navigatingRoute || !userNavPos) return;
    map.easeTo({
      center: [userNavPos.lng, userNavPos.lat],
      zoom: 15.6,
      pitch: 50,
      bearing: userNavPos.heading,
      duration: 500,
    });
  }, [navigatingRoute, userNavPos]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followedVehicleId) return;
    const target = vehicles.find((v) => v.meta.vehicleId === followedVehicleId);
    if (target) {
      map.easeTo({
        center: target.location.coordinates,
        duration: 420,
      });
    }
  }, [vehicles, followedVehicleId]);

  // Sync Live GPS blue dot & accuracy ring + camera follow
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const accSource = map.getSource('live-gps-accuracy') as
      | maplibregl.GeoJSONSource
      | undefined;
    const ptSource = map.getSource('live-gps-point') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (accSource) accSource.setData(buildLiveGpsAccuracyGeoJson(gpsPosition));
    if (ptSource) ptSource.setData(buildLiveGpsPointGeoJson(gpsPosition));

    if (gpsPosition && gpsFollow && !navigatingRoute) {
      map.easeTo({
        center: [gpsPosition.lng, gpsPosition.lat],
        zoom: Math.max(map.getZoom(), 15.2),
        duration: 650,
      });
    }
  }, [gpsPosition, gpsFollow, navigatingRoute]);

  // Sync Distance Measurement overlay & cursor style
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    map.getCanvas().style.cursor = measureActive ? 'crosshair' : '';
    const lineSource = map.getSource('measure-line') as
      | maplibregl.GeoJSONSource
      | undefined;
    const ptsSource = map.getSource('measure-points') as
      | maplibregl.GeoJSONSource
      | undefined;
    if (lineSource) lineSource.setData(buildMeasureLinesGeoJson(measurePoints));
    if (ptsSource) ptsSource.setData(buildMeasurePointsGeoJson(measurePoints));
  }, [measureActive, measurePoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToTarget) return;
    map.flyTo({
      center: [flyToTarget.lng, flyToTarget.lat],
      zoom: 14.3,
      duration: 700,
    });
  }, [flyToTarget]);

  const measuredMeters = useMemo(() => {
    let total = 0;
    for (let i = 1; i < measurePoints.length; i++) {
      const [lng1, lat1] = measurePoints[i - 1];
      const [lng2, lat2] = measurePoints[i];
      total += haversineMeters(lat1, lng1, lat2, lng2);
    }
    return total;
  }, [measurePoints]);

  const handleToggleGps = () => {
    if (gpsStatus === 'off' || gpsStatus === 'denied' || gpsStatus === 'unavailable') {
      setGpsCardDismissed(false);
      onStartGps?.();
      return;
    }
    setGpsCardDismissed(false);
    if (gpsPosition && mapRef.current) {
      mapRef.current.flyTo({
        center: [gpsPosition.lng, gpsPosition.lat],
        zoom: Math.max(mapRef.current.getZoom(), 15.4),
        duration: 650,
      });
    }
    onSetGpsFollow?.(!gpsFollow);
  };

  const handleDeployToMapCenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    onSelectCity({
      name: `Custom Sector (${c.lat.toFixed(2)}, ${c.lng.toFixed(2)})`,
      lat: Number(c.lat.toFixed(5)),
      lng: Number(c.lng.toFixed(5)),
    });
  };

  const filterLabel: Record<MapVehicleFilter, string> = {
    all: 'All Vehicles',
    normal: 'Normal Only',
    delayed: 'Delayed Only',
    anomaly: 'Over Speed',
  };

  return (
    <div className="relative w-full h-full bg-[#090d13] overflow-hidden rounded-xl border border-white/[0.08]">
      {useCanvasFallback ? (
        <CanvasFallbackMap
          vehicles={vehicles}
          subscribedTiles={subscribedTiles}
          showSpatialGrid={showSpatialGrid}
          vehicleFilter={vehicleFilter}
          activeCity={activeCity}
          selectedVehicleId={selectedVehicle?.meta.vehicleId ?? null}
          routePlan={routePlan}
          selectedRouteId={selectedRouteId}
          onSelectVehicle={onSelectVehicle}
          onViewportChange={onViewportChange}
          flyToTarget={flyToTarget}
        />
      ) : (
        <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      )}

      {/* Live Turn-by-Turn Navigation HUD Overlay */}
      {navigatingRoute && routePlan && onExitNavigation && onRerouteFromNav && onPublishTripPosition && (
        <NavigationHud
          plan={routePlan}
          route={navigatingRoute}
          incidents={incidents}
          roadSpeedLimitKmh={droppedPin?.maxSpeedKmh ?? speedLimitKmh}
          onUserPositionChange={setUserNavPos}
          onReroute={onRerouteFromNav}
          onPublishTripPosition={onPublishTripPosition}
          onExitNavigation={() => {
            setUserNavPos(null);
            mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 500 });
            onExitNavigation();
          }}
        />
      )}

      {/* Top-Left Filter Dropdown + Legend (hidden during Navigation HUD) */}
      {!navigatingRoute && (
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2 z-10 pointer-events-none">
          <div className="pointer-events-auto relative">
            <button
              type="button"
              onClick={() => setFilterOpen((o) => !o)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[#121720]/90 backdrop-blur-md border border-white/10 rounded-lg text-slate-100 hover:bg-[#19202c] transition-colors shadow-lg cursor-pointer whitespace-nowrap"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  vehicleFilter === 'anomaly'
                    ? 'bg-red-500'
                    : vehicleFilter === 'delayed'
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                }`}
              />
              {filterLabel[vehicleFilter]}
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {filterOpen && (
              <div className="absolute left-0 mt-1.5 w-40 bg-[#121720]/95 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl overflow-hidden z-20">
                {(['all', 'normal', 'delayed', 'anomaly'] as MapVehicleFilter[]).map(
                  (opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        onChangeVehicleFilter(opt);
                        setFilterOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                        vehicleFilter === opt
                          ? 'bg-emerald-500/15 text-emerald-300 font-medium'
                          : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      {filterLabel[opt]}
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          <div className="pointer-events-auto hidden sm:flex items-center gap-4 px-3 py-1.5 bg-[#121720]/90 backdrop-blur-md border border-white/10 rounded-lg text-xs text-slate-200 shadow-lg">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Normal
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Delayed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              Over Speed
            </span>
          </div>
        </div>
      )}

      {/* Top-Right Map Tools + Layer Switcher */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-2 z-10 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1.5">
          {!useCanvasFallback && !navigatingRoute && (
            <button
              type="button"
              onClick={handleDeployToMapCenter}
              title="Move fleet simulation to current map view"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#121720]/90 backdrop-blur-md border border-white/10 text-emerald-300 hover:bg-emerald-500/20 rounded-lg transition-colors shadow-lg cursor-pointer whitespace-nowrap"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              Deploy Here
            </button>
          )}

          {/* Basemap / 3D / Traffic Layers Menu */}
          {!useCanvasFallback && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setLayersOpen((o) => !o)}
                title="Map styles, 3D buildings & traffic layer"
                className={`p-1.5 rounded-lg border backdrop-blur-md shadow-lg transition-colors cursor-pointer ${
                  layersOpen
                    ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                    : 'bg-[#121720]/90 border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                <Layers className="w-4 h-4" />
              </button>

              {layersOpen && (
                <div className="absolute right-0 mt-1.5 w-48 bg-[#121720]/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl p-2 space-y-2 z-30">
                  <div className="text-[10px] font-medium text-slate-400 px-1">
                    Basemap Style
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        { id: 'dark', label: 'Dark', icon: Moon },
                        { id: 'day', label: 'Day', icon: Sun },
                        { id: 'satellite', label: 'Sat', icon: Satellite },
                      ] as Array<{
                        id: MapBasemapTheme;
                        label: string;
                        icon: typeof Moon;
                      }>
                    ).map((opt) => {
                      const Icon = opt.icon;
                      const active = basemapTheme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            onChangeBasemapTheme?.(opt.id);
                          }}
                          className={`py-1.5 rounded-lg text-[10px] font-medium flex flex-col items-center gap-0.5 border cursor-pointer ${
                            active
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                              : 'bg-[#0B0F17] border-white/[0.06] text-slate-300 hover:text-white'
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="border-t border-white/[0.08] pt-1.5 space-y-1">
                    <button
                      type="button"
                      onClick={() => setShowTrafficFlow((t) => !t)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs flex items-center justify-between hover:bg-white/[0.05] text-slate-200 cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                        Live Traffic Flow
                      </span>
                      <span
                        className={`text-[10px] font-mono ${
                          showTrafficFlow ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {showTrafficFlow ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShow3DBuildings((b) => !b)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs flex items-center justify-between hover:bg-white/[0.05] text-slate-200 cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Box className="w-3.5 h-3.5 text-sky-400" />
                        3D Buildings
                      </span>
                      <span
                        className={`text-[10px] font-mono ${
                          show3DBuildings ? 'text-sky-400' : 'text-slate-500'
                        }`}
                      >
                        {show3DBuildings ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowVehicleLabels((l) => !l)}
                      className="w-full px-2 py-1.5 rounded-lg text-xs flex items-center justify-between hover:bg-white/[0.05] text-slate-200 cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-amber-400" />
                        Vehicle Numbers
                      </span>
                      <span
                        className={`text-[10px] font-mono ${
                          showVehicleLabels ? 'text-amber-400' : 'text-slate-500'
                        }`}
                      >
                        {showVehicleLabels ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!useCanvasFallback && !navigatingRoute && (
            <button
              type="button"
              onClick={handleToggleGps}
              title={
                gpsStatus === 'active'
                  ? gpsFollow
                    ? 'Live GPS active (following). Click to view/unlock'
                    : 'Live GPS active. Click to re-center'
                  : 'Track my live GPS location on map'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border backdrop-blur-md shadow-lg transition-colors cursor-pointer whitespace-nowrap ${
                gpsStatus === 'active'
                  ? gpsFollow
                    ? 'bg-sky-500/25 border-sky-400/60 text-sky-200'
                    : 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                  : gpsStatus === 'locating'
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'bg-[#121720]/90 border-white/10 text-slate-200 hover:bg-white/10'
              }`}
            >
              <span className="relative flex h-2 w-2">
                {gpsStatus === 'active' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    gpsStatus === 'active'
                      ? 'bg-sky-400'
                      : gpsStatus === 'locating'
                        ? 'bg-amber-400'
                        : gpsStatus === 'denied'
                          ? 'bg-red-400'
                          : 'bg-slate-500'
                  }`}
                />
              </span>
              {gpsStatus === 'locating'
                ? 'Locating...'
                : gpsStatus === 'active'
                  ? gpsFollow
                    ? 'GPS Follow'
                    : 'My GPS'
                  : 'My GPS'}
            </button>
          )}

          {!useCanvasFallback && !navigatingRoute && (
            <button
              type="button"
              onClick={() => {
                setMeasureActive((m) => {
                  const next = !m;
                  if (!next) setMeasurePoints([]);
                  return next;
                });
              }}
              title="Measure distance on map"
              className={`p-1.5 rounded-lg border backdrop-blur-md shadow-lg transition-colors cursor-pointer ${
                measureActive
                  ? 'bg-amber-500/25 border-amber-400/50 text-amber-300'
                  : 'bg-[#121720]/90 border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              <Ruler className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onToggleSpatialGrid}
            title="Toggle Socket.IO spatial tile grid"
            className={`p-1.5 rounded-lg border backdrop-blur-md shadow-lg transition-colors cursor-pointer ${
              showSpatialGrid
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-[#121720]/90 border-white/10 text-slate-300 hover:text-white'
            }`}
          >
            <Grid3x3 className="w-4 h-4" />
          </button>

          {!useCanvasFallback && (mapBearing !== 0 || mapPitch !== 0) && (
            <button
              type="button"
              onClick={() =>
                mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 450 })
              }
              title="Reset North-up 2D view"
              className="p-1.5 rounded-lg bg-[#121720]/90 border border-white/10 text-sky-300 hover:text-white backdrop-blur-md shadow-lg transition-colors cursor-pointer"
            >
              <Compass
                className="w-4 h-4 transition-transform"
                style={{ transform: `rotate(${-mapBearing}deg)` }}
              />
            </button>
          )}

          {!useCanvasFallback && (
            <button
              type="button"
              onClick={() =>
                mapRef.current?.flyTo({
                  center: [activeCity.lng, activeCity.lat],
                  zoom: 12.6,
                  duration: 600,
                })
              }
              title="Center on active city"
              className="p-1.5 rounded-lg bg-[#121720]/90 border border-white/10 text-slate-300 hover:text-white backdrop-blur-md shadow-lg transition-colors cursor-pointer"
            >
              <Crosshair className="w-4 h-4" />
            </button>
          )}
        </div>

        {!useCanvasFallback && (
          <div className="pointer-events-auto flex flex-col bg-[#121720]/90 backdrop-blur-md border border-white/10 rounded-lg shadow-lg overflow-hidden">
            <button
              type="button"
              onClick={() => mapRef.current?.zoomIn()}
              aria-label="Zoom in"
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
            <div className="h-px bg-white/10" />
            <button
              type="button"
              onClick={() => mapRef.current?.zoomOut()}
              aria-label="Zoom out"
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Live Cursor Coordinates & Zoom Readout */}
      {!useCanvasFallback && cursorCoords && (
        <div className="pointer-events-none hidden sm:flex items-center gap-2 absolute bottom-2.5 right-32 z-10 px-2.5 py-1 rounded-md bg-[#0B0F17]/80 backdrop-blur-sm border border-white/[0.06] text-[10px] font-mono text-slate-400">
          <span>
            {cursorCoords.lat.toFixed(4)}, {cursorCoords.lng.toFixed(4)}
          </span>
          <span aria-hidden="true">·</span>
          <span>z{mapZoom.toFixed(1)}</span>
        </div>
      )}

      {/* Distance Measure Floating Bar */}
      {measureActive && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-3.5 py-2 bg-[#121720]/95 backdrop-blur-md border border-amber-500/40 rounded-xl shadow-2xl">
          <div className="flex items-center gap-2">
            <Ruler className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="text-xs leading-tight">
              <div className="font-mono font-semibold text-white">
                {measuredMeters >= 1000
                  ? `${(measuredMeters / 1000).toFixed(2)} km`
                  : `${Math.round(measuredMeters)} m`}
              </div>
              <div className="text-[10px] text-slate-400">
                {measurePoints.length === 0
                  ? 'Click map to start measuring'
                  : `${measurePoints.length} pts · ~${Math.max(1, Math.round(measuredMeters / 83))}m walk · ~${Math.max(1, Math.round(measuredMeters / 660))}m drive`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {measurePoints.length > 0 && (
              <button
                type="button"
                onClick={() => setMeasurePoints((p) => p.slice(0, -1))}
                title="Undo last point"
                className="p-1.5 rounded-lg bg-[#0B0F17] border border-white/10 text-slate-300 hover:text-white cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMeasurePoints([]);
                setMeasureActive(false);
              }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-500 text-slate-950 hover:bg-amber-400 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Live GPS Status & Quick Action Card */}
      {!navigatingRoute &&
        !measureActive &&
        !selectedVehicle &&
        !droppedPin &&
        !droppingPinLoading &&
        !selectedPoi &&
        !gpsCardDismissed &&
        (gpsPosition || gpsError || gpsStatus === 'locating') && (
          <div className="absolute bottom-3 left-3 w-[340px] max-w-[calc(100%-1.5rem)] bg-[#121720]/95 backdrop-blur-md border border-sky-500/40 rounded-xl p-3.5 shadow-2xl z-20 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
                  <h4 className="text-xs font-semibold text-white">
                    {gpsStatus === 'locating'
                      ? 'Acquiring Live GPS Fix...'
                      : gpsError
                        ? 'GPS Location Notice'
                        : 'Live GPS Location'}
                  </h4>
                  {gpsPosition && (
                    <span className="text-[10px] font-mono text-sky-300">
                      ±{gpsPosition.accuracyMeters}m
                    </span>
                  )}
                </div>
                {gpsError ? (
                  <p className="text-[11px] text-amber-300 mt-1">{gpsError}</p>
                ) : gpsPosition ? (
                  <div className="text-[11px] font-mono text-slate-300 mt-1 flex items-center gap-2 flex-wrap">
                    <span>
                      {gpsPosition.lat.toFixed(5)}, {gpsPosition.lng.toFixed(5)}
                    </span>
                    <span>·</span>
                    <span className="text-emerald-400">
                      {gpsPosition.speedKmh !== null
                        ? `${gpsPosition.speedKmh} km/h`
                        : 'Stationary'}
                    </span>
                    {gpsPosition.heading !== null && (
                      <>
                        <span>·</span>
                        <span>{gpsPosition.heading}°</span>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Waiting for browser location permission & satellite lock...
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setGpsCardDismissed(true)}
                aria-label="Minimize GPS card"
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {gpsPosition && (
              <div className="flex flex-wrap items-center gap-1.5">
                {onSetOriginLocation && (
                  <button
                    type="button"
                    onClick={() =>
                      onSetOriginLocation({
                        name: `My Live GPS (${gpsPosition.lat.toFixed(4)}, ${gpsPosition.lng.toFixed(4)})`,
                        lat: gpsPosition.lat,
                        lng: gpsPosition.lng,
                      })
                    }
                    className="flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-semibold bg-sky-500 text-slate-950 hover:bg-sky-400 inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Navigation className="w-3 h-3" />
                    Route From Here
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onSelectCity({
                      name: `My Location (${gpsPosition.lat.toFixed(2)}, ${gpsPosition.lng.toFixed(2)})`,
                      lat: gpsPosition.lat,
                      lng: gpsPosition.lng,
                    })
                  }
                  className="py-1.5 px-2.5 rounded-lg text-[11px] font-medium bg-[#0B0F17] border border-white/10 text-emerald-300 hover:bg-emerald-500/15 cursor-pointer whitespace-nowrap"
                >
                  Deploy Fleet Here
                </button>
                {onMapClickCoord && (
                  <button
                    type="button"
                    onClick={() =>
                      onMapClickCoord({
                        lat: gpsPosition.lat,
                        lng: gpsPosition.lng,
                      })
                    }
                    title="Inspect street address & speed limit here"
                    className="py-1.5 px-2 rounded-lg text-[11px] font-medium bg-[#0B0F17] border border-white/10 text-slate-200 hover:bg-white/10 cursor-pointer"
                  >
                    Street Info
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onStopGps?.()}
                  className="py-1.5 px-2 rounded-lg text-[11px] font-medium bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 cursor-pointer"
                >
                  Stop
                </button>
              </div>
            )}
          </div>
        )}

      {/* Selected POI Inspector Card */}
      {!navigatingRoute && selectedPoi && !selectedVehicle && !droppedPin && (
        <div className="absolute bottom-3 left-3 w-[340px] max-w-[calc(100%-1.5rem)] bg-[#121720]/95 backdrop-blur-md border border-emerald-500/35 rounded-xl p-3.5 shadow-2xl z-20 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <h4 className="text-xs font-semibold text-white truncate">
                  {selectedPoi.name}
                </h4>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span className="capitalize">{selectedPoi.category}</span>
                <span>·</span>
                <span className="font-mono text-emerald-400">
                  {selectedPoi.distanceMeters >= 1000
                    ? `${(selectedPoi.distanceMeters / 1000).toFixed(1)} km`
                    : `${selectedPoi.distanceMeters} m`}
                </span>
                {selectedPoi.operator && (
                  <>
                    <span>·</span>
                    <span className="truncate">{selectedPoi.operator}</span>
                  </>
                )}
              </div>
              {selectedPoi.address && (
                <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                  {selectedPoi.address}
                </p>
              )}
            </div>
            {onSelectPoi && (
              <button
                type="button"
                onClick={() => onSelectPoi(null)}
                aria-label="Close place card"
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {(selectedPoi.openingHours ||
            selectedPoi.evConnectors ||
            selectedPoi.capacity ||
            selectedPoi.nextDepartures) && (
            <div className="text-[11px] text-slate-300 bg-[#0B0F17] border border-white/[0.06] rounded-lg p-2 space-y-1">
              {selectedPoi.openingHours && (
                <div className="truncate">Hours: {selectedPoi.openingHours}</div>
              )}
              {selectedPoi.evConnectors && (
                <div className="text-emerald-300">
                  Plugs: {selectedPoi.evConnectors}
                  {selectedPoi.capacity ? ` (${selectedPoi.capacity} stalls)` : ''}
                </div>
              )}
              {selectedPoi.nextDepartures && selectedPoi.nextDepartures.length > 0 && (
                <div className="text-sky-300 font-mono text-[10px]">
                  Next: {selectedPoi.nextDepartures.join(' | ')}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {onRouteToLocation && (
              <button
                type="button"
                onClick={() => {
                  if (gpsPosition && onSetOriginLocation) {
                    onSetOriginLocation({
                      name: `My Live GPS (${gpsPosition.lat.toFixed(4)}, ${gpsPosition.lng.toFixed(4)})`,
                      lat: gpsPosition.lat,
                      lng: gpsPosition.lng,
                    });
                  }
                  onRouteToLocation({
                    name: selectedPoi.name,
                    lat: selectedPoi.lat,
                    lng: selectedPoi.lng,
                  });
                }}
                className="flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 inline-flex items-center justify-center gap-1 cursor-pointer"
              >
                <Navigation className="w-3 h-3" />
                {gpsPosition ? 'Go From GPS' : 'Directions'}
              </button>
            )}
            {selectedPoi.phone && (
              <a
                href={`tel:${selectedPoi.phone}`}
                title={selectedPoi.phone}
                className="p-1.5 rounded-lg bg-[#0B0F17] border border-white/10 text-emerald-400 hover:text-emerald-300"
              >
                <Phone className="w-3.5 h-3.5" />
              </a>
            )}
            {onSavePlace && (
              <button
                type="button"
                onClick={() =>
                  onSavePlace({
                    label: selectedPoi.name,
                    tag: 'favorite',
                    name: selectedPoi.address || selectedPoi.name,
                    lat: selectedPoi.lat,
                    lng: selectedPoi.lng,
                  })
                }
                title="Save place"
                className="p-1.5 rounded-lg bg-[#0B0F17] border border-white/10 text-slate-300 hover:text-amber-300 cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5" />
              </button>
            )}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${selectedPoi.lat},${selectedPoi.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Google Maps"
              className="p-1.5 rounded-lg bg-[#0B0F17] border border-white/10 text-sky-400 hover:text-sky-300"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Shared Live Trip Viewer Banner */}
      {watchedTrip && (
        <div className="absolute top-14 left-3 z-20 bg-[#121720]/95 backdrop-blur-md border border-sky-500/40 rounded-xl px-3.5 py-2.5 shadow-2xl max-w-xs">
          <div className="text-[10px] font-mono text-sky-400 uppercase">
            Live Shared Trip
          </div>
          <div className="text-xs font-semibold text-white mt-0.5 truncate">
            {watchedTrip.originName} → {watchedTrip.destinationName}
          </div>
          <div className="text-[11px] font-mono text-emerald-400 mt-1">
            {watchedTrip.etaMinutes} min ETA · {watchedTrip.remainingKm} km ·{' '}
            {watchedTrip.speedKmh} km/h
          </div>
        </div>
      )}

      {/* Dropped Pin Card (Click Anywhere on Map) */}
      {!navigatingRoute && (droppedPin || droppingPinLoading) && !selectedVehicle && (
        <div className="absolute bottom-3 left-3 w-[340px] max-w-[calc(100%-1.5rem)] bg-[#121720]/95 backdrop-blur-md border border-amber-500/35 rounded-xl p-3.5 shadow-2xl z-20 space-y-2.5">
          {droppingPinLoading ? (
            <div className="text-xs text-slate-300 py-2">
              Resolving street address & speed limit...
            </div>
          ) : (
            droppedPin && (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <h4 className="text-xs font-semibold text-white truncate">
                        {droppedPin.name}
                      </h4>
                      {droppedPin.maxSpeedKmh && (
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded bg-white text-slate-950 shrink-0">
                          {droppedPin.maxSpeedKmh} km/h
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                      {droppedPin.displayName}
                    </p>
                  </div>
                  {onClearDroppedPin && (
                    <button
                      type="button"
                      onClick={onClearDroppedPin}
                      aria-label="Close pin card"
                      className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {droppedPin.photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {droppedPin.photos.map((ph, idx) => (
                      <a
                        key={idx}
                        href={ph.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block h-14 rounded-lg overflow-hidden border border-white/10"
                      >
                        <img
                          src={ph.thumbUrl}
                          alt={ph.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  {onRouteToLocation && (
                    <button
                      type="button"
                      onClick={() => {
                        if (gpsPosition && onSetOriginLocation) {
                          onSetOriginLocation({
                            name: `My Live GPS (${gpsPosition.lat.toFixed(4)}, ${gpsPosition.lng.toFixed(4)})`,
                            lat: gpsPosition.lat,
                            lng: gpsPosition.lng,
                          });
                        }
                        onRouteToLocation({
                          name: droppedPin.name,
                          lat: droppedPin.lat,
                          lng: droppedPin.lng,
                        });
                      }}
                      className="flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Navigation className="w-3 h-3" />
                      {gpsPosition ? 'Go From GPS' : 'Directions Here'}
                    </button>
                  )}
                  {onSetOriginLocation && (
                    <button
                      type="button"
                      onClick={() =>
                        onSetOriginLocation({
                          name: droppedPin.name,
                          lat: droppedPin.lat,
                          lng: droppedPin.lng,
                        })
                      }
                      className="py-1.5 px-2 rounded-lg text-[11px] font-medium bg-[#0B0F17] border border-white/10 text-slate-200 hover:bg-white/10 cursor-pointer"
                    >
                      Origin
                    </button>
                  )}
                  {onSavePlace && (
                    <button
                      type="button"
                      onClick={() =>
                        onSavePlace({
                          label: droppedPin.name,
                          tag: 'favorite',
                          name: droppedPin.displayName,
                          lat: droppedPin.lat,
                          lng: droppedPin.lng,
                        })
                      }
                      title="Save place"
                      className="p-1.5 rounded-lg bg-[#0B0F17] border border-white/10 text-slate-300 hover:text-amber-300 cursor-pointer"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {onReportIncidentAt && (
                    <button
                      type="button"
                      onClick={() =>
                        onReportIncidentAt({
                          lat: droppedPin.lat,
                          lng: droppedPin.lng,
                          label: droppedPin.roadName || droppedPin.name,
                        })
                      }
                      title="Report road hazard here"
                      className="p-1.5 rounded-lg bg-[#0B0F17] border border-white/10 text-amber-400 hover:bg-amber-500/15 cursor-pointer"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${droppedPin.lat},${droppedPin.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open pin in Google Maps"
                    className="p-1.5 rounded-lg bg-[#0B0F17] border border-white/10 text-sky-400 hover:text-sky-300"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </>
            )
          )}
        </div>
      )}

      {/* Floating Active Hub / Selected Vehicle Callout */}
      {!navigatingRoute && !selectedVehicle && !droppedPin && !droppingPinLoading && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none hidden md:flex items-center gap-2.5 px-3 py-2 bg-[#141A24]/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl z-10">
          <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            <TrainFront className="w-4 h-4" />
          </div>
          <div className="text-xs leading-tight">
            <div className="font-semibold text-white">{activeCity.name}</div>
            <div className="text-[11px] text-slate-400">
              {activeCity.corridorSource === 'openstreetmap'
                ? `${activeCity.corridorCount} live OSM corridors`
                : `${activeCity.corridorCount} urban corridors`}{' '}
              · Click anywhere to drop pin
            </div>
          </div>
        </div>
      )}

      {!navigatingRoute && selectedVehicle && (
        <div className="absolute bottom-3 left-3 w-[340px] max-w-[calc(100%-1.5rem)] bg-[#121720]/95 backdrop-blur-md border border-white/12 rounded-xl p-3.5 shadow-2xl z-10">
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-white/[0.08]">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white font-mono">
                  {selectedVehicle.meta.vehicleId}
                </h3>
                <span
                  className={`text-xs font-medium ${
                    selectedVehicle.isAnomaly
                      ? 'text-red-400'
                      : selectedVehicle.speed < 22
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                  }`}
                >
                  {selectedVehicle.isAnomaly
                    ? selectedVehicle.anomalyReason || 'Over Speed'
                    : selectedVehicle.speed < 22
                      ? 'Delayed'
                      : 'Normal'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {selectedVehicle.meta.corridor} ·{' '}
                {selectedVehicle.meta.fleetType}
              </p>
            </div>

            <div className="flex items-center gap-1">
              {onPlanRouteFromVehicle && (
                <button
                  type="button"
                  onClick={() => onPlanRouteFromVehicle(selectedVehicle)}
                  title="Suggest AI route from this vehicle"
                  className="px-2 py-1 rounded-md text-[10px] font-medium bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 transition-colors cursor-pointer"
                >
                  AI Route
                </button>
              )}
              <button
                type="button"
                onClick={() => onToggleFollow(selectedVehicle.meta.vehicleId)}
                title={
                  followedVehicleId === selectedVehicle.meta.vehicleId
                    ? 'Stop camera follow'
                    : 'Follow vehicle'
                }
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  followedVehicleId === selectedVehicle.meta.vehicleId
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onSelectVehicle(null)}
                aria-label="Close vehicle inspector"
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 py-2.5 border-b border-white/[0.08] text-xs">
            <div>
              <div className="text-slate-400 text-[11px]">Speed</div>
              <div className="text-sm font-semibold text-white font-mono mt-0.5">
                {selectedVehicle.speed.toFixed(1)}{' '}
                <span className="text-[10px] text-slate-400">km/h</span>
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-[11px]">Moving Avg</div>
              <div className="text-sm font-semibold text-emerald-400 font-mono mt-0.5">
                {selectedVehicle.movingAvgSpeed.toFixed(1)}{' '}
                <span className="text-[10px] text-slate-400">km/h</span>
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-[11px]">Heading</div>
              <div className="text-sm font-semibold text-slate-200 font-mono mt-0.5 inline-flex items-center gap-1">
                <Navigation
                  className="w-3 h-3 text-slate-400"
                  style={{ transform: `rotate(${selectedVehicle.heading}deg)` }}
                />
                {selectedVehicle.heading}°
              </div>
            </div>
          </div>

          <div className="pt-2.5">
            <SpeedHistoryChart
              history={selectedHistory}
              speedLimitKmh={speedLimitKmh}
            />
          </div>
        </div>
      )}
    </div>
  );
}
