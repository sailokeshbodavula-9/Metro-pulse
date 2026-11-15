import type {
  ActiveCityInfo,
  AnomalyReason,
  AnomalyRecord,
  FleetMetricsSnapshot,
  FleetType,
  GeocodeResult,
  TelemetryPoint,
} from '../types/telemetry';

interface CorridorPath {
  name: string;
  baseSpeedKmh: number;
  waypoints: Array<[number, number]>;
}

interface SimVehicle {
  vehicleId: string;
  fleetType: FleetType;
  corridorIdx: number;
  segmentIdx: number;
  progress: number;
  direction: 1 | -1;
  latOffset: number;
  lngOffset: number;
  currentSpeed: number;
  targetSpeed: number;
  surgeTicksRemaining: number;
  recentSpeeds: number[];
}

const FLEET_TYPES: FleetType[] = ['sedan', 'van', 'truck', 'bus', 'ev_shuttle'];
const LETTERS_SAFE = 'ABCDEFGHJKLMNPRSTUVWXYZ';

function generateVehicleRegistration(
  index: number,
  fleetType: FleetType,
  cityName: string,
  lat: number,
  lng: number
): string {
  const c = cityName.toLowerCase();
  const n = index + 1;
  const num4 = String(1000 + ((n * 739 + 1427) % 8999));
  const num3 = String(100 + ((n * 271 + 413) % 899));
  const l1 = LETTERS_SAFE[(n * 5 + 3) % LETTERS_SAFE.length];
  const l2 = LETTERS_SAFE[(n * 11 + 7) % LETTERS_SAFE.length];
  const l3 = LETTERS_SAFE[(n * 17 + 13) % LETTERS_SAFE.length];

  if (
    c.includes('visakhapatnam') ||
    c.includes('vizag') ||
    c.includes('vijayawada') ||
    c.includes('andhra') ||
    (lat >= 13.5 && lat <= 19.2 && lng >= 78.2 && lng <= 84.9)
  ) {
    const rto = n % 3 === 0 ? 'AP31' : 'AP39';
    const seriesByType: Record<FleetType, string> = {
      sedan: `${l1}${l2}`,
      van: `T${l2}`,
      truck: 'TC',
      bus: `Z${l1}`,
      ev_shuttle: 'EV',
    };
    return `${rto} ${seriesByType[fleetType]} ${num4}`;
  }

  if (
    c.includes('bengaluru') ||
    c.includes('bangalore') ||
    c.includes('mysuru') ||
    (lat >= 11.5 && lat <= 18.2 && lng >= 74.0 && lng <= 78.2)
  ) {
    const rtos = ['KA01', 'KA03', 'KA05', 'KA02'];
    const rto = rtos[index % rtos.length];
    const series =
      fleetType === 'ev_shuttle' ? 'EV' : fleetType === 'bus' ? 'FA' : `${l1}${l2}`;
    return `${rto} ${series} ${num4}`;
  }

  if (
    c.includes('india') ||
    c.includes('hyderabad') ||
    c.includes('mumbai') ||
    c.includes('delhi') ||
    c.includes('chennai') ||
    (lat >= 6.5 && lat <= 35.8 && lng >= 68.0 && lng <= 97.5)
  ) {
    const state =
      c.includes('hyderabad') || c.includes('telangana')
        ? 'TS09'
        : c.includes('mumbai') || c.includes('pune')
          ? 'MH12'
          : c.includes('delhi')
            ? 'DL01'
            : c.includes('chennai')
              ? 'TN09'
              : ['MH12', 'TS09', 'TN09', 'DL01'][index % 4];
    const series = fleetType === 'ev_shuttle' ? 'EV' : `${l1}${l2}`;
    return `${state} ${series} ${num4}`;
  }

  if (
    c.includes('san francisco') ||
    c.includes('los angeles') ||
    c.includes('california') ||
    c.includes(', ca') ||
    (lat >= 32.5 && lat <= 42.0 && lng >= -124.5 && lng <= -114.1)
  ) {
    return `${(n % 4) + 6}${l1}${l2}${l3}${num3}`;
  }

  if (
    c.includes('new york') ||
    c.includes(', ny') ||
    (lat >= 40.4 && lat <= 45.0 && lng >= -79.8 && lng <= -71.8)
  ) {
    return `${l1}${l2}${l3}-${num4}`;
  }

  if (lat >= 24.0 && lat <= 50.0 && lng >= -125.0 && lng <= -66.0) {
    return `${(n % 9) + 1}${l1}${l2}-${num4}`;
  }

  if (
    c.includes('london') ||
    c.includes('uk') ||
    (lat >= 49.5 && lat <= 60.0 && lng >= -8.5 && lng <= 2.0)
  ) {
    const yr = n % 2 === 0 ? '24' : '73';
    return `L${l1}${yr} ${l2}${l3}${LETTERS_SAFE[(n * 3) % LETTERS_SAFE.length]}`;
  }

  if (
    c.includes('tokyo') ||
    c.includes('osaka') ||
    c.includes('japan') ||
    (lat >= 30.0 && lat <= 46.0 && lng >= 129.0 && lng <= 146.0)
  ) {
    return `TYO ${300 + (n % 99)}-${num4}`;
  }

  return `${l1}${l2}-${num4}${l3}`;
}

function buildCityCorridors(lat: number, lng: number): CorridorPath[] {
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  const dLat = 0.022;
  const dLng = 0.026 / cosLat;

  return [
    {
      name: 'Central Arterial Blvd',
      baseSpeedKmh: 46,
      waypoints: [
        [lng - dLng, lat],
        [lng - dLng * 0.4, lat + 0.002],
        [lng + dLng * 0.4, lat - 0.001],
        [lng + dLng, lat],
      ],
    },
    {
      name: 'North-South Spine',
      baseSpeedKmh: 44,
      waypoints: [
        [lng, lat - dLat],
        [lng + 0.002, lat - dLat * 0.3],
        [lng - 0.002, lat + dLat * 0.3],
        [lng, lat + dLat],
      ],
    },
    {
      name: 'Northern Ring Corridor',
      baseSpeedKmh: 54,
      waypoints: [
        [lng - dLng * 0.9, lat + dLat * 0.65],
        [lng, lat + dLat * 0.78],
        [lng + dLng * 0.9, lat + dLat * 0.65],
      ],
    },
    {
      name: 'Southern Express Loop',
      baseSpeedKmh: 56,
      waypoints: [
        [lng - dLng * 0.9, lat - dLat * 0.65],
        [lng, lat - dLat * 0.78],
        [lng + dLng * 0.9, lat - dLat * 0.65],
      ],
    },
    {
      name: 'Eastbound Transit Link',
      baseSpeedKmh: 42,
      waypoints: [
        [lng + dLng * 0.55, lat - dLat * 0.85],
        [lng + dLng * 0.72, lat],
        [lng + dLng * 0.55, lat + dLat * 0.85],
      ],
    },
    {
      name: 'Westside Collector',
      baseSpeedKmh: 40,
      waypoints: [
        [lng - dLng * 0.55, lat - dLat * 0.85],
        [lng - dLng * 0.72, lat],
        [lng - dLng * 0.55, lat + dLat * 0.85],
      ],
    },
  ];
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

function computeBearing(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const y =
    Math.sin(((lng2 - lng1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lng2 - lng1) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export class ClientTelemetryFallback {
  private activeCity: ActiveCityInfo = {
    name: 'San Francisco, CA',
    lat: 37.7749,
    lng: -122.4194,
    corridorSource: 'urban-grid',
    corridorCount: 6,
  };
  private corridors: CorridorPath[] = buildCityCorridors(37.7749, -122.4194);
  private vehicles: SimVehicle[] = [];
  private latestPoints: TelemetryPoint[] = [];
  private historyByVehicle = new Map<string, TelemetryPoint[]>();
  private vehicleCount = 140;
  private speedLimitKmh = 68;
  private isPaused = false;
  private totalIngested = 0;

  constructor(initialCount = 140) {
    this.vehicleCount = initialCount;
    this.rebuildFleet(initialCount);
  }

  private createVehicle(index: number): SimVehicle {
    const fleetType = FLEET_TYPES[index % FLEET_TYPES.length];
    const corridorIdx = index % this.corridors.length;
    const path = this.corridors[corridorIdx];
    const segmentIdx = Math.floor(Math.random() * Math.max(1, path.waypoints.length - 1));
    const base = path.baseSpeedKmh + (Math.random() - 0.5) * 14;
    return {
      vehicleId: generateVehicleRegistration(
        index,
        fleetType,
        this.activeCity.name,
        this.activeCity.lat,
        this.activeCity.lng
      ),
      fleetType,
      corridorIdx,
      segmentIdx,
      progress: Math.random(),
      direction: Math.random() > 0.5 ? 1 : -1,
      latOffset: (Math.random() - 0.5) * 0.0005,
      lngOffset: (Math.random() - 0.5) * 0.0005,
      currentSpeed: Math.max(12, base),
      targetSpeed: Math.max(18, base),
      surgeTicksRemaining: 0,
      recentSpeeds: [Math.max(12, base)],
    };
  }

  private rebuildFleet(count: number): void {
    this.vehicles = Array.from({ length: count }, (_, i) => this.createVehicle(i));
    this.historyByVehicle.clear();
  }

  setCity(name: string, lat: number, lng: number): ActiveCityInfo {
    this.activeCity = {
      name,
      lat,
      lng,
      corridorSource: 'urban-grid',
      corridorCount: 6,
    };
    this.corridors = buildCityCorridors(lat, lng);
    this.rebuildFleet(this.vehicleCount);
    return this.activeCity;
  }

  updateConfig(patch: {
    vehicleCount?: number;
    speedLimitKmh?: number;
    isPaused?: boolean;
  }): void {
    if (typeof patch.isPaused === 'boolean') {
      this.isPaused = patch.isPaused;
    }
    if (typeof patch.speedLimitKmh === 'number') {
      this.speedLimitKmh = Math.min(120, Math.max(30, patch.speedLimitKmh));
    }
    if (typeof patch.vehicleCount === 'number') {
      const next = Math.min(300, Math.max(20, Math.round(patch.vehicleCount)));
      if (next !== this.vehicleCount) {
        this.vehicleCount = next;
        this.rebuildFleet(next);
      }
    }
  }

  injectAnomaly(): string | null {
    if (this.vehicles.length === 0) return null;
    const v = this.vehicles[Math.floor(Math.random() * this.vehicles.length)];
    v.surgeTicksRemaining = 16;
    v.targetSpeed = this.speedLimitKmh + 22;
    return v.vehicleId;
  }

  getVehicleHistory(vehicleId: string): TelemetryPoint[] {
    return this.historyByVehicle.get(vehicleId) ?? [];
  }

  step(): {
    points: TelemetryPoint[];
    metrics: FleetMetricsSnapshot;
    anomalies: AnomalyRecord[];
  } {
    const startMs = performance.now();
    const nowIso = new Date().toISOString();
    const points: TelemetryPoint[] = [];
    const anomalies: AnomalyRecord[] = [];
    let speedSum = 0;

    for (const v of this.vehicles) {
      const path = this.corridors[v.corridorIdx % this.corridors.length];
      if (!this.isPaused) {
        if (v.surgeTicksRemaining > 0) {
          v.surgeTicksRemaining -= 1;
          v.currentSpeed += (this.speedLimitKmh + 18 - v.currentSpeed) * 0.35;
        } else {
          if (Math.random() < 0.04) {
            v.targetSpeed = Math.max(15, path.baseSpeedKmh + (Math.random() - 0.5) * 24);
          }
          if (Math.random() < 0.004) {
            v.surgeTicksRemaining = 10;
          }
          v.currentSpeed += (v.targetSpeed - v.currentSpeed) * 0.2;
        }

        const p1 = path.waypoints[v.segmentIdx];
        const p2 = path.waypoints[v.segmentIdx + 1] ?? path.waypoints[0];
        const segLen = Math.max(60, haversineMeters(p1[1], p1[0], p2[1], p2[0]));
        const distMeters = ((v.currentSpeed * 1000) / 3600) * 0.5;
        v.progress += (distMeters / segLen) * v.direction;

        if (v.progress >= 1) {
          if (v.segmentIdx < path.waypoints.length - 2) {
            v.segmentIdx += 1;
            v.progress = 0;
          } else {
            v.direction = -1;
            v.progress = 1;
          }
        } else if (v.progress <= 0) {
          if (v.segmentIdx > 0) {
            v.segmentIdx -= 1;
            v.progress = 1;
          } else {
            v.direction = 1;
            v.progress = 0;
          }
        }
      }

      const a = path.waypoints[v.segmentIdx];
      const b = path.waypoints[v.segmentIdx + 1] ?? path.waypoints[0];
      const lng = a[0] + (b[0] - a[0]) * v.progress + v.lngOffset;
      const lat = a[1] + (b[1] - a[1]) * v.progress + v.latOffset;
      const heading =
        v.direction === 1
          ? computeBearing(a[0], a[1], b[0], b[1])
          : computeBearing(b[0], b[1], a[0], a[1]);

      const speed = Number(Math.max(4, v.currentSpeed).toFixed(1));
      v.recentSpeeds.push(speed);
      if (v.recentSpeeds.length > 12) v.recentSpeeds.shift();
      const movingAvgSpeed = Number(
        (v.recentSpeeds.reduce((acc, s) => acc + s, 0) / v.recentSpeeds.length).toFixed(1)
      );
      const prevSpeed = v.recentSpeeds[v.recentSpeeds.length - 2] ?? speed;
      const speedDelta = Number((speed - prevSpeed).toFixed(1));

      let anomalyReason: AnomalyReason | null = null;
      if (speed > this.speedLimitKmh) {
        anomalyReason = 'Speeding Threshold';
      } else if (movingAvgSpeed > this.speedLimitKmh * 0.94 && v.recentSpeeds.length >= 6) {
        anomalyReason = 'Sustained Overspeed';
      } else if (speedDelta >= 14) {
        anomalyReason = 'Sudden Acceleration';
      }

      const isAnomaly = anomalyReason !== null;
      speedSum += speed;

      const pt: TelemetryPoint = {
        timestamp: nowIso,
        meta: {
          vehicleId: v.vehicleId,
          fleetType: v.fleetType,
          corridor: path.name,
        },
        location: {
          type: 'Point',
          coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
        },
        speed,
        movingAvgSpeed,
        speedDelta,
        heading: Math.round(heading),
        isAnomaly,
        anomalyReason,
        tileRoom: 'edge:local',
      };
      points.push(pt);

      const hist = this.historyByVehicle.get(v.vehicleId) ?? [];
      hist.push(pt);
      if (hist.length > 60) hist.shift();
      this.historyByVehicle.set(v.vehicleId, hist);

      if (isAnomaly && anomalyReason) {
        anomalies.push({
          id: `${v.vehicleId}-${nowIso}`,
          timestamp: nowIso,
          vehicleId: v.vehicleId,
          fleetType: v.fleetType,
          corridor: path.name,
          speed,
          movingAvgSpeed,
          speedLimit: this.speedLimitKmh,
          reason: anomalyReason,
          coordinates: pt.location.coordinates,
        });
      }
    }

    if (!this.isPaused) {
      this.totalIngested += points.length;
    }
    this.latestPoints = points;

    const metrics: FleetMetricsSnapshot = {
      timestamp: nowIso,
      totalFleet: this.vehicles.length,
      avgFleetSpeed:
        points.length > 0 ? Number((speedSum / points.length).toFixed(1)) : 0,
      activeAnomalies: anomalies.length,
      totalIngested: this.totalIngested,
      writesPerSec: this.isPaused ? 0 : this.vehicles.length * 2,
      storageMode: 'in-memory-timeseries',
      subscribedClients: 1,
      tickDurationMs: Number((performance.now() - startMs).toFixed(1)),
      isPaused: this.isPaused,
      speedLimitKmh: this.speedLimitKmh,
      tileCount: this.corridors.length,
      activeCity: this.activeCity,
    };

    return { points, metrics, anomalies };
  }

  getLatestPoints(): TelemetryPoint[] {
    return this.latestPoints;
  }
}

export async function geocodeDirectNominatim(q: string): Promise<GeocodeResult[]> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`,
      { headers: { 'Accept-Language': 'en' } }
    );
    if (!res.ok) return [];
    const raw = (await res.json()) as Array<{
      display_name: string;
      name?: string;
      lat: string;
      lon: string;
    }>;
    return raw.map((item) => ({
      name: item.name || item.display_name.split(',')[0].trim(),
      displayName: item.display_name,
      lat: Number(item.lat),
      lng: Number(item.lon),
    }));
  } catch {
    return [];
  }
}
