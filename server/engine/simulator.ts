import { telemetryStore } from '../config/db.ts';
import type {
  ActiveCityInfo,
  FleetType,
  SimulationConfigPayload,
  TelemetryPoint,
} from '../types.ts';
import { getTileRoomForPoint } from '../utils/spatialGrid.ts';
import { SlidingWindowTracker } from './slidingWindow.ts';

interface CorridorPath {
  name: string;
  baseSpeedKmh: number;
  waypoints: Array<[number, number]>; // [lng, lat]
}

interface SimulatedVehicle {
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

  // Andhra Pradesh / Visakhapatnam
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
      truck: `TC`,
      bus: `Z${l1}`,
      ev_shuttle: `EV`,
    };
    return `${rto} ${seriesByType[fleetType]} ${num4}`;
  }

  // Karnataka / Bengaluru
  if (
    c.includes('bengaluru') ||
    c.includes('bangalore') ||
    c.includes('mysuru') ||
    (lat >= 11.5 && lat <= 18.2 && lng >= 74.0 && lng <= 78.2)
  ) {
    const rtos = ['KA01', 'KA03', 'KA05', 'KA02'];
    const rto = rtos[index % rtos.length];
    const series = fleetType === 'ev_shuttle' ? 'EV' : fleetType === 'bus' ? 'FA' : `${l1}${l2}`;
    return `${rto} ${series} ${num4}`;
  }

  // Rest of India
  if (
    c.includes('india') ||
    c.includes('hyderabad') ||
    c.includes('mumbai') ||
    c.includes('delhi') ||
    c.includes('chennai') ||
    (lat >= 6.5 && lat <= 35.8 && lng >= 68.0 && lng <= 97.5)
  ) {
    const state = c.includes('hyderabad') || c.includes('telangana')
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

  // California / SF
  if (
    c.includes('san francisco') ||
    c.includes('los angeles') ||
    c.includes('california') ||
    c.includes(', ca') ||
    (lat >= 32.5 && lat <= 42.0 && lng >= -124.5 && lng <= -114.1)
  ) {
    const lead = ((n % 4) + 6).toString();
    return `${lead}${l1}${l2}${l3}${num3}`;
  }

  // New York
  if (
    c.includes('new york') ||
    c.includes(', ny') ||
    (lat >= 40.4 && lat <= 45.0 && lng >= -79.8 && lng <= -71.8)
  ) {
    return `${l1}${l2}${l3}-${num4}`;
  }

  // United States general
  if (lat >= 24.0 && lat <= 50.0 && lng >= -125.0 && lng <= -66.0) {
    return `${(n % 9) + 1}${l1}${l2}-${num4}`;
  }

  // UK
  if (
    c.includes('london') ||
    c.includes('uk') ||
    (lat >= 49.5 && lat <= 60.0 && lng >= -8.5 && lng <= 2.0)
  ) {
    const yr = n % 2 === 0 ? '24' : '73';
    return `L${l1}${yr} ${l2}${l3}${LETTERS_SAFE[(n * 3) % LETTERS_SAFE.length]}`;
  }

  // Japan
  if (
    c.includes('tokyo') ||
    c.includes('osaka') ||
    c.includes('japan') ||
    (lat >= 30.0 && lat <= 46.0 && lng >= 129.0 && lng <= 146.0)
  ) {
    return `TYO ${300 + (n % 99)}-${num4}`;
  }

  // Global clean license plate format
  return `${l1}${l2}-${num4}${l3}`;
}

function haversineMeters(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
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

function computeBearing(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const y =
    Math.sin(((lng2 - lng1) * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lng2 - lng1) * Math.PI) / 180);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/**
 * Generates a latitude-calibrated arterial road & ring network around ANY (lat, lng)
 * on Earth so switching cities is instantaneous (<5ms) while Overpass OSM roads load.
 */
function generateUrbanGridCorridors(
  centerLat: number,
  centerLng: number
): CorridorPath[] {
  const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));
  const kmToLat = 1 / 111.32;
  const kmToLng = 1 / (111.32 * cosLat);

  const pt = (dxKm: number, dyKm: number): [number, number] => [
    Number((centerLng + dxKm * kmToLng).toFixed(6)),
    Number((centerLat + dyKm * kmToLat).toFixed(6)),
  ];

  return [
    {
      name: 'Central Arterial E-W',
      baseSpeedKmh: 38,
      waypoints: [
        pt(-5.2, 0.1),
        pt(-2.6, 0.25),
        pt(0.0, 0.0),
        pt(2.5, -0.15),
        pt(5.2, 0.2),
      ],
    },
    {
      name: 'North Crosstown Blvd',
      baseSpeedKmh: 42,
      waypoints: [
        pt(-4.8, 2.2),
        pt(-2.1, 2.35),
        pt(0.2, 2.15),
        pt(2.6, 2.4),
        pt(4.9, 2.1),
      ],
    },
    {
      name: 'South Crosstown Ave',
      baseSpeedKmh: 44,
      waypoints: [
        pt(-4.9, -2.1),
        pt(-2.2, -2.25),
        pt(0.3, -2.05),
        pt(2.8, -2.2),
        pt(4.8, -1.95),
      ],
    },
    {
      name: 'Central Spine N-S',
      baseSpeedKmh: 40,
      waypoints: [
        pt(0.05, -4.8),
        pt(-0.1, -2.2),
        pt(0.0, 0.1),
        pt(0.15, 2.4),
        pt(-0.05, 4.8),
      ],
    },
    {
      name: 'West Ring Corridor',
      baseSpeedKmh: 52,
      waypoints: [
        pt(-2.6, -4.4),
        pt(-2.8, -1.8),
        pt(-2.5, 0.4),
        pt(-2.7, 2.6),
        pt(-2.4, 4.4),
      ],
    },
    {
      name: 'East Ring Corridor',
      baseSpeedKmh: 50,
      waypoints: [
        pt(2.5, -4.3),
        pt(2.7, -1.7),
        pt(2.4, 0.5),
        pt(2.6, 2.5),
        pt(2.3, 4.3),
      ],
    },
    {
      name: 'Northwest Expressway',
      baseSpeedKmh: 68,
      waypoints: [
        pt(-5.6, 4.2),
        pt(-3.3, 2.4),
        pt(-1.1, 0.9),
        pt(1.2, -0.8),
        pt(3.8, -2.9),
      ],
    },
    {
      name: 'Northeast Connector',
      baseSpeedKmh: 64,
      waypoints: [
        pt(-3.9, -3.1),
        pt(-1.6, -1.3),
        pt(0.6, 0.5),
        pt(2.9, 2.3),
        pt(5.2, 4.0),
      ],
    },
    {
      name: 'Inner Beltway Loop',
      baseSpeedKmh: 35,
      waypoints: [
        pt(-1.5, -1.4),
        pt(1.5, -1.4),
        pt(1.6, 1.4),
        pt(-1.5, 1.5),
        pt(-1.5, -1.4),
      ],
    },
    {
      name: 'Outer Ring Road',
      baseSpeedKmh: 62,
      waypoints: [
        pt(-3.8, -3.2),
        pt(3.6, -3.3),
        pt(3.8, 3.2),
        pt(-3.7, 3.3),
        pt(-3.8, -3.2),
      ],
    },
  ];
}

/**
 * Queries OpenStreetMap Overpass API for real arterial roadways around (lat, lng).
 * Falls back gracefully if Overpass is rate-limited or times out.
 */
async function fetchOverpassCorridors(
  lat: number,
  lng: number,
  radiusMeters = 4800
): Promise<CorridorPath[]> {
  const query = `[out:json][timeout:4];(way["highway"~"^(motorway|trunk|primary|secondary)$"](around:${radiusMeters},${lat},${lng}););out geom qt 40;`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'MetroPulseTelemetry/1.0',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      elements?: Array<{
        type?: string;
        tags?: { name?: string; highway?: string; maxspeed?: string };
        geometry?: Array<{ lat: number; lon: number }>;
      }>;
    };

    const corridors: CorridorPath[] = [];
    for (const el of data.elements ?? []) {
      if (
        el.type === 'way' &&
        Array.isArray(el.geometry) &&
        el.geometry.length >= 2
      ) {
        const hw = el.tags?.highway ?? 'primary';
        const baseSpeedKmh =
          hw === 'motorway'
            ? 74
            : hw === 'trunk'
              ? 62
              : hw === 'primary'
                ? 44
                : 36;
        corridors.push({
          name: el.tags?.name || `${hw.charAt(0).toUpperCase() + hw.slice(1)} Corridor`,
          baseSpeedKmh,
          waypoints: el.geometry.map((p) => [p.lon, p.lat]),
        });
      }
    }
    return corridors.slice(0, 28);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export class TelemetrySimulator {
  private vehicles: SimulatedVehicle[] = [];
  private corridors: CorridorPath[] = [];
  private activeCity: ActiveCityInfo;
  private cityEpoch = 0;
  private latestSnapshot = new Map<string, TelemetryPoint>();
  private tracker = new SlidingWindowTracker(12, 68);
  private tickInterval: NodeJS.Timeout | null = null;
  private isPaused = false;
  private lastTickDurationMs = 0;
  private tickCount = 0;
  private onBatchCallback:
    | ((batch: TelemetryPoint[], durationMs: number) => void)
    | null = null;

  constructor(
    initialVehicleCount = 140,
    initialCity = { name: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 }
  ) {
    this.corridors = generateUrbanGridCorridors(
      initialCity.lat,
      initialCity.lng
    );
    this.activeCity = {
      name: initialCity.name,
      lat: initialCity.lat,
      lng: initialCity.lng,
      corridorSource: 'urban-grid',
      corridorCount: this.corridors.length,
    };
    this.setVehicleCount(initialVehicleCount);
    void this.upgradeToOpenStreetMapRoads(
      initialCity.lat,
      initialCity.lng,
      this.cityEpoch
    );
  }

  private async upgradeToOpenStreetMapRoads(
    lat: number,
    lng: number,
    epoch: number
  ): Promise<void> {
    const osmCorridors = await fetchOverpassCorridors(lat, lng);
    if (epoch !== this.cityEpoch || osmCorridors.length < 6) {
      return;
    }
    this.corridors = osmCorridors;
    this.activeCity = {
      ...this.activeCity,
      corridorSource: 'openstreetmap',
      corridorCount: osmCorridors.length,
    };
    this.reseedVehiclesOntoCorridors();
  }

  private reseedVehiclesOntoCorridors(): void {
    const count = this.vehicles.length;
    this.latestSnapshot.clear();
    this.vehicles = Array.from({ length: count }, (_, i) =>
      this.createVehicle(i)
    );
  }

  setCity(name: string, lat: number, lng: number): ActiveCityInfo {
    this.cityEpoch += 1;
    const epoch = this.cityEpoch;

    this.corridors = generateUrbanGridCorridors(lat, lng);
    this.activeCity = {
      name: name.trim() || `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      lat,
      lng,
      corridorSource: 'urban-grid',
      corridorCount: this.corridors.length,
    };

    this.reseedVehiclesOntoCorridors();
    // Immediately compute one fresh frame so clients get instant vehicles in the new city
    void this.step(500);

    // Asynchronously upgrade corridors to real OpenStreetMap roads for this city
    void this.upgradeToOpenStreetMapRoads(lat, lng, epoch);

    return this.activeCity;
  }

  getActiveCity(): ActiveCityInfo {
    return this.activeCity;
  }

  private externalLiveVehicles = new Map<
    string,
    { point: TelemetryPoint; expiresAt: number }
  >();

  private createVehicle(index: number): SimulatedVehicle {
    const fleetType = FLEET_TYPES[index % FLEET_TYPES.length];
    const vehicleId = generateVehicleRegistration(
      index,
      fleetType,
      this.activeCity.name,
      this.activeCity.lat,
      this.activeCity.lng
    );
    const corridorIdx = index % this.corridors.length;
    const corridor = this.corridors[corridorIdx];
    const maxSeg = Math.max(0, corridor.waypoints.length - 2);
    const segmentIdx = Math.floor(Math.random() * (maxSeg + 1));
    const speedJitter = (Math.random() - 0.5) * 14;
    const baseSpeed = Math.max(18, corridor.baseSpeedKmh + speedJitter);

    return {
      vehicleId,
      fleetType,
      corridorIdx,
      segmentIdx,
      progress: Math.random(),
      direction: Math.random() > 0.5 ? 1 : -1,
      latOffset: (Math.random() - 0.5) * 0.0005,
      lngOffset: (Math.random() - 0.5) * 0.0005,
      currentSpeed: Number(baseSpeed.toFixed(1)),
      targetSpeed: Number(baseSpeed.toFixed(1)),
      surgeTicksRemaining: 0,
    };
  }

  setVehicleCount(count: number): void {
    const clamped = Math.max(40, Math.min(300, Math.round(count)));
    if (clamped > this.vehicles.length) {
      for (let i = this.vehicles.length; i < clamped; i++) {
        this.vehicles.push(this.createVehicle(i));
      }
    } else if (clamped < this.vehicles.length) {
      this.vehicles.length = clamped;
      const activeIds = new Set(this.vehicles.map((v) => v.vehicleId));
      this.tracker.pruneExcept(activeIds);
      for (const key of this.latestSnapshot.keys()) {
        if (!activeIds.has(key)) this.latestSnapshot.delete(key);
      }
    }
  }

  updateConfig(config: SimulationConfigPayload): void {
    if (typeof config.vehicleCount === 'number') {
      this.setVehicleCount(config.vehicleCount);
    }
    if (typeof config.speedLimitKmh === 'number') {
      this.tracker.setSpeedLimit(config.speedLimitKmh);
    }
    if (typeof config.isPaused === 'boolean') {
      this.isPaused = config.isPaused;
    }
  }

  injectAnomaly(preferredVehicleIds?: string[]): string | null {
    if (this.vehicles.length === 0) return null;

    let candidate: SimulatedVehicle | undefined;
    if (preferredVehicleIds && preferredVehicleIds.length > 0) {
      const preferredSet = new Set(preferredVehicleIds);
      const pool = this.vehicles.filter((v) => preferredSet.has(v.vehicleId));
      if (pool.length > 0) {
        candidate = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    if (!candidate) {
      candidate =
        this.vehicles[Math.floor(Math.random() * this.vehicles.length)];
    }

    const limit = this.tracker.getSpeedLimit();
    candidate.targetSpeed = Number(
      (limit + 22 + Math.random() * 14).toFixed(1)
    );
    candidate.currentSpeed = candidate.targetSpeed;
    candidate.surgeTicksRemaining = 14;
    return candidate.vehicleId;
  }

  start(
    onBatch: (batch: TelemetryPoint[], durationMs: number) => void,
    tickMs = 500
  ): void {
    this.onBatchCallback = onBatch;
    void this.step(tickMs);

    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      if (!this.isPaused) {
        void this.step(tickMs);
      }
    }, tickMs);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private async step(tickMs: number): Promise<void> {
    const startNs = performance.now();
    this.tickCount += 1;
    const nowIso = new Date().toISOString();
    const dtHours = tickMs / 3_600_000;
    const batch: TelemetryPoint[] = [];

    for (const v of this.vehicles) {
      const corridor = this.corridors[v.corridorIdx % this.corridors.length];
      const waypoints = corridor.waypoints;
      if (waypoints.length < 2) continue;

      if (v.segmentIdx >= waypoints.length - 1) {
        v.segmentIdx = waypoints.length - 2;
      }

      if (v.surgeTicksRemaining > 0) {
        v.surgeTicksRemaining -= 1;
        if (v.surgeTicksRemaining === 0) {
          v.targetSpeed = corridor.baseSpeedKmh + (Math.random() - 0.5) * 12;
        }
      } else if (this.tickCount % 15 === 0 && Math.random() < 0.015) {
        v.surgeTicksRemaining = 8 + Math.floor(Math.random() * 8);
        v.targetSpeed = this.tracker.getSpeedLimit() + 14 + Math.random() * 16;
      } else if (Math.random() < 0.14) {
        const trafficWave = Math.sin(this.tickCount * 0.12 + v.corridorIdx) * 8;
        v.targetSpeed = Math.max(
          8,
          corridor.baseSpeedKmh + trafficWave + (Math.random() - 0.5) * 16
        );
      }

      v.currentSpeed += (v.targetSpeed - v.currentSpeed) * 0.32;
      const clampedSpeed = Math.max(0, Number(v.currentSpeed.toFixed(1)));

      const p1 = waypoints[v.segmentIdx];
      const p2 = waypoints[v.segmentIdx + 1];
      const segMeters = Math.max(
        50,
        haversineMeters(p1[0], p1[1], p2[0], p2[1])
      );
      const travelMeters = clampedSpeed * 1000 * dtHours;
      const progressDelta = (travelMeters / segMeters) * v.direction;

      v.progress += progressDelta;
      if (v.progress >= 1) {
        if (v.segmentIdx < waypoints.length - 2) {
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

      const curA = waypoints[v.segmentIdx];
      const curB = waypoints[v.segmentIdx + 1];
      const lng = Number(
        (curA[0] + (curB[0] - curA[0]) * v.progress + v.lngOffset).toFixed(6)
      );
      const lat = Number(
        (curA[1] + (curB[1] - curA[1]) * v.progress + v.latOffset).toFixed(6)
      );

      const heading =
        v.direction === 1
          ? computeBearing(curA[0], curA[1], curB[0], curB[1])
          : computeBearing(curB[0], curB[1], curA[0], curA[1]);

      const evaluation = this.tracker.evaluate(v.vehicleId, clampedSpeed);
      const tileRoom = getTileRoomForPoint(lat, lng);

      const point: TelemetryPoint = {
        timestamp: nowIso,
        meta: {
          vehicleId: v.vehicleId,
          fleetType: v.fleetType,
          corridor: corridor.name,
        },
        location: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        speed: clampedSpeed,
        movingAvgSpeed: evaluation.movingAvgSpeed,
        speedDelta: evaluation.speedDelta,
        heading,
        isAnomaly: evaluation.isAnomaly,
        anomalyReason: evaluation.anomalyReason,
        tileRoom,
      };

      this.latestSnapshot.set(v.vehicleId, point);
      batch.push(point);
    }

    const nowMs = Date.now();
    for (const [vid, ext] of this.externalLiveVehicles.entries()) {
      if (ext.expiresAt <= nowMs) {
        this.externalLiveVehicles.delete(vid);
        this.latestSnapshot.delete(vid);
      } else {
        this.latestSnapshot.set(vid, ext.point);
        batch.push(ext.point);
      }
    }

    await telemetryStore.ingestBatch(batch, this.tracker.getSpeedLimit());
    this.lastTickDurationMs = Number((performance.now() - startNs).toFixed(2));

    if (this.onBatchCallback) {
      this.onBatchCallback(batch, this.lastTickDurationMs);
    }
  }

  public async ingestExternalTelemetry(
    items: Array<{
      vehicleId: string;
      lat: number;
      lng: number;
      speed: number;
      heading?: number;
      fleetType?: FleetType;
      corridor?: string;
    }>
  ): Promise<TelemetryPoint[]> {
    const nowIso = new Date().toISOString();
    const expiresAt = Date.now() + 90_000;
    const ingested: TelemetryPoint[] = [];

    for (const item of items) {
      const vid = item.vehicleId.trim().toUpperCase();
      if (!vid) continue;
      const clampedSpeed = Math.max(0, Number(item.speed.toFixed(1)));
      const evaluation = this.tracker.evaluate(vid, clampedSpeed);
      const tileRoom = getTileRoomForPoint(item.lat, item.lng);
      const point: TelemetryPoint = {
        timestamp: nowIso,
        meta: {
          vehicleId: vid,
          fleetType: item.fleetType || 'sedan',
          corridor: item.corridor?.trim() || 'Live GPS Telemetry',
        },
        location: {
          type: 'Point',
          coordinates: [item.lng, item.lat],
        },
        speed: clampedSpeed,
        movingAvgSpeed: evaluation.movingAvgSpeed,
        speedDelta: evaluation.speedDelta,
        heading: Number.isFinite(item.heading) ? Math.round(item.heading!) : 0,
        isAnomaly: evaluation.isAnomaly,
        anomalyReason: evaluation.anomalyReason,
        tileRoom,
      };
      this.externalLiveVehicles.set(vid, { point, expiresAt });
      this.latestSnapshot.set(vid, point);
      ingested.push(point);
    }

    if (ingested.length > 0) {
      await telemetryStore.ingestBatch(ingested, this.tracker.getSpeedLimit());
    }
    return ingested;
  }

  getLatestVehicles(): TelemetryPoint[] {
    return Array.from(this.latestSnapshot.values());
  }

  getStatus() {
    const vehicles = this.getLatestVehicles();
    const totalSpeed = vehicles.reduce((acc, v) => acc + v.speed, 0);
    const activeAnomalies = vehicles.filter((v) => v.isAnomaly).length;

    return {
      totalFleet: this.vehicles.length,
      avgFleetSpeed:
        vehicles.length > 0
          ? Number((totalSpeed / vehicles.length).toFixed(1))
          : 0,
      activeAnomalies,
      tickDurationMs: this.lastTickDurationMs,
      isPaused: this.isPaused,
      speedLimitKmh: this.tracker.getSpeedLimit(),
      activeCity: this.activeCity,
    };
  }
}
