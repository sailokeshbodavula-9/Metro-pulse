export type FleetType = 'sedan' | 'van' | 'truck' | 'bus' | 'ev_shuttle';

export type AnomalyReason =
  | 'Speeding Threshold'
  | 'Sustained Overspeed'
  | 'Sudden Acceleration';

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom?: number;
}

export interface ActiveCityInfo {
  name: string;
  lat: number;
  lng: number;
  corridorSource: 'openstreetmap' | 'urban-grid';
  corridorCount: number;
}

export interface GeocodeResult {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
}

export interface TelemetryPoint {
  timestamp: string;
  meta: {
    vehicleId: string;
    fleetType: FleetType;
    corridor: string;
  };
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  speed: number;
  movingAvgSpeed: number;
  speedDelta: number;
  heading: number;
  isAnomaly: boolean;
  anomalyReason: AnomalyReason | null;
  tileRoom: string;
}

export interface AnomalyRecord {
  id: string;
  timestamp: string;
  vehicleId: string;
  fleetType: FleetType;
  corridor: string;
  speed: number;
  movingAvgSpeed: number;
  speedLimit: number;
  reason: AnomalyReason;
  coordinates: [number, number];
}

export interface FleetMetricsSnapshot {
  timestamp: string;
  totalFleet: number;
  avgFleetSpeed: number;
  activeAnomalies: number;
  totalIngested: number;
  writesPerSec: number;
  storageMode: 'mongodb-timeseries' | 'in-memory-timeseries';
  subscribedClients: number;
  tickDurationMs: number;
  isPaused: boolean;
  speedLimitKmh: number;
  tileCount: number;
  activeCity: ActiveCityInfo;
}

export interface SubscribedTile {
  roomId: string;
  bounds: BoundingBox;
}

export type TravelMode = 'driving' | 'walking' | 'bicycling' | 'transit';

export type RoutePriority =
  | 'recommended'
  | 'fastest'
  | 'avoid_anomalies'
  | 'eco';

export interface RouteLocationEndpoint {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
}

export interface RouteSuggestionWaypoint {
  name: string;
  lat: number;
  lng: number;
  note: string;
}

export interface RouteStep {
  instruction: string;
  roadName: string;
  distanceMeters: number;
  durationSec: number;
  maneuverType: string;
  maneuverModifier?: string;
  location: [number, number];
}

export interface AiRouteSuggestion {
  id: string;
  title: string;
  strategy: RoutePriority;
  summary: string;
  distanceKm: number;
  durationMin: number;
  estimatedAvgSpeedKmh: number;
  riskLevel: 'low' | 'moderate' | 'elevated';
  avoidedHotspots: string[];
  corridorsUsed: string[];
  turnHints: string[];
  steps: RouteStep[];
  waypoints: RouteSuggestionWaypoint[];
  geometry: Array<[number, number]>;
  googleMapsUrl: string;
}

export interface AiRoutePlanResponse {
  generatedAt: string;
  origin: RouteLocationEndpoint;
  destination: RouteLocationEndpoint;
  stops: RouteLocationEndpoint[];
  travelMode: TravelMode;
  trafficBrief: string;
  routes: AiRouteSuggestion[];
  googleMapsOverviewUrl: string;
}

export type IncidentType =
  | 'accident'
  | 'closure'
  | 'construction'
  | 'hazard'
  | 'speed_trap'
  | 'flooding';

export interface RoadIncident {
  id: string;
  type: IncidentType;
  title: string;
  description: string;
  lat: number;
  lng: number;
  corridor: string;
  upvotes: number;
  createdAt: string;
  expiresAt: string;
}

export type PoiCategory =
  | 'fuel'
  | 'charging'
  | 'parking'
  | 'restaurant'
  | 'hospital'
  | 'transit';

export interface PoiPlace {
  id: string;
  name: string;
  category: PoiCategory;
  lat: number;
  lng: number;
  distanceMeters: number;
  address?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  operator?: string;
  evConnectors?: string;
  capacity?: string;
  transitLines?: string[];
  nextDepartures?: string[];
}

export interface StreetPhotoItem {
  title: string;
  imageUrl: string;
  thumbUrl: string;
  pageUrl: string;
  distanceMeters: number;
}

export interface SharedTripSession {
  token: string;
  routeTitle: string;
  originName: string;
  destinationName: string;
  destinationLat: number;
  destinationLng: number;
  currentLat: number;
  currentLng: number;
  heading: number;
  speedKmh: number;
  etaMinutes: number;
  remainingKm: number;
  geometry: Array<[number, number]>;
  updatedAt: string;
  expiresAt: string;
}

export interface SavedPlace {
  id: string;
  label: string;
  tag: 'home' | 'work' | 'favorite';
  name: string;
  lat: number;
  lng: number;
  createdAt: string;
}

export interface TripHistoryEntry {
  id: string;
  originName: string;
  destinationName: string;
  distanceKm: number;
  durationMin: number;
  travelMode: TravelMode;
  googleMapsUrl: string;
  createdAt: string;
}

export interface DroppedPinInfo {
  lat: number;
  lng: number;
  name: string;
  displayName: string;
  roadName?: string;
  maxSpeedKmh?: number | null;
  photos: StreetPhotoItem[];
}

export type MapBasemapTheme = 'dark' | 'day' | 'satellite';

export interface MongoCollectionStatusItem {
  name: string;
  purpose: string;
  indexes: string[];
  documents: number;
}

export interface CorridorHotspotSummary {
  corridor: string;
  telemetryCount: number;
  avgSpeedKmh: number;
  anomalyCount: number;
}

export interface FleetAnomalyBreakdown {
  fleetType: string;
  anomalyCount: number;
  avgAnomalySpeedKmh: number;
}

export interface MongoAnalyticsSummary {
  storageMode: 'mongodb-timeseries' | 'in-memory-timeseries';
  mongoConnected: boolean;
  generatedAt: string;
  collections: MongoCollectionStatusItem[];
  corridorHotspots: CorridorHotspotSummary[];
  fleetBreakdown: FleetAnomalyBreakdown[];
}

