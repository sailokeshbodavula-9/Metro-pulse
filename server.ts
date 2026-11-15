import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { telemetryStore } from './server/config/db.ts';
import {
  generateAiRouteSuggestions,
  type RouteStopInput,
} from './server/engine/aiRouter.ts';
import {
  communityStore,
  fetchNearbyPois,
  reverseGeocodeWithRoadLimit,
} from './server/engine/communityStore.ts';
import { TelemetrySimulator } from './server/engine/simulator.ts';
import type {
  BoundingBox,
  FleetMetricsSnapshot,
  IncidentType,
  PoiCategory,
  RoutePriority,
  SimulationConfigPayload,
  TelemetryPoint,
  TravelMode,
} from './server/types.ts';
import {
  getIntersectingTileRooms,
  isPointInBbox,
  isValidBbox,
  OVERVIEW_ROOM,
  tileRoomToBounds,
} from './server/utils/spatialGrid.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
  perMessageDeflate: {
    threshold: 1024,
  },
});

const simulator = new TelemetrySimulator(140);
const telemetryNs = io.of('/telemetry');

telemetryNs.on('connection', (socket) => {
  socket.data.spatialRooms = new Set<string>();
  socket.data.bbox = null as BoundingBox | null;

  socket.on('viewport:update', (bbox: unknown, ack?: (res: unknown) => void) => {
    if (!isValidBbox(bbox)) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Invalid bounding box coordinates.' });
      }
      return;
    }

    const nextRooms = getIntersectingTileRooms(bbox);
    const prevRooms: Set<string> = socket.data.spatialRooms;

    for (const room of prevRooms) {
      if (!nextRooms.has(room)) {
        socket.leave(room);
      }
    }

    for (const room of nextRooms) {
      if (!prevRooms.has(room)) {
        socket.join(room);
      }
    }

    socket.data.spatialRooms = nextRooms;
    socket.data.bbox = bbox;

    const allVehicles = simulator.getLatestVehicles();
    const isOverview = nextRooms.has(OVERVIEW_ROOM);
    const visibleVehicles = isOverview
      ? allVehicles
      : allVehicles.filter((v) => {
          const [lng, lat] = v.location.coordinates;
          return nextRooms.has(v.tileRoom) || isPointInBbox(lat, lng, bbox);
        });

    const activeTileBounds = isOverview
      ? []
      : Array.from(nextRooms)
          .map((roomId) => ({
            roomId,
            bounds: tileRoomToBounds(roomId),
          }))
          .filter((item) => item.bounds !== null);

    socket.emit('telemetry:snapshot', {
      vehicles: visibleVehicles,
      totalFleet: allVehicles.length,
      subscribedTiles: activeTileBounds,
      mode: isOverview ? 'overview' : 'spatial-tiles',
      activeCity: simulator.getActiveCity(),
    });

    if (typeof ack === 'function') {
      ack({
        ok: true,
        subscribedTiles: nextRooms.size,
        visibleCount: visibleVehicles.length,
        mode: isOverview ? 'overview' : 'spatial-tiles',
      });
    }
  });

  socket.emit('incidents:list', communityStore.getActiveIncidents());

  socket.on('vehicle:follow', (vehicleId: unknown) => {
    if (typeof vehicleId === 'string' && vehicleId.trim()) {
      socket.join(`vehicle:${vehicleId.trim()}`);
    }
  });

  socket.on('vehicle:unfollow', (vehicleId: unknown) => {
    if (typeof vehicleId === 'string' && vehicleId.trim()) {
      socket.leave(`vehicle:${vehicleId.trim()}`);
    }
  });

  socket.on('trip:join', (token: unknown) => {
    if (typeof token === 'string' && token.trim()) {
      const cleanToken = token.trim();
      socket.join(`trip:${cleanToken}`);
      const session = communityStore.getSharedTrip(cleanToken);
      if (session) {
        socket.emit('trip:update', session);
      }
    }
  });

  socket.on('trip:leave', (token: unknown) => {
    if (typeof token === 'string' && token.trim()) {
      socket.leave(`trip:${token.trim()}`);
    }
  });

  socket.on(
    'trip:position',
    (payload: {
      token?: string;
      currentLat?: number;
      currentLng?: number;
      heading?: number;
      speedKmh?: number;
      etaMinutes?: number;
      remainingKm?: number;
    }) => {
      if (
        !payload?.token ||
        typeof payload.currentLat !== 'number' ||
        typeof payload.currentLng !== 'number'
      ) {
        return;
      }
      const updated = communityStore.updateSharedTrip(payload.token, {
        currentLat: payload.currentLat,
        currentLng: payload.currentLng,
        heading: Number(payload.heading) || 0,
        speedKmh: Number(payload.speedKmh) || 0,
        etaMinutes: Math.max(0, Number(payload.etaMinutes) || 0),
        remainingKm: Math.max(0, Number(payload.remainingKm) || 0),
      });
      if (updated) {
        telemetryNs.to(`trip:${updated.token}`).emit('trip:update', updated);
      }
    }
  );

  socket.on('disconnect', () => {
    socket.data.spatialRooms.clear();
  });
});

function broadcastTelemetryBatch(
  batch: TelemetryPoint[],
  tickDurationMs: number
): void {
  const tileBuckets = new Map<string, TelemetryPoint[]>();
  const anomalies: TelemetryPoint[] = [];

  for (const v of batch) {
    let bucket = tileBuckets.get(v.tileRoom);
    if (!bucket) {
      bucket = [];
      tileBuckets.set(v.tileRoom, bucket);
    }
    bucket.push(v);

    if (v.isAnomaly) {
      anomalies.push(v);
    }

    const followRoom = `vehicle:${v.meta.vehicleId}`;
    if (telemetryNs.adapter.rooms.has(followRoom)) {
      telemetryNs.to(followRoom).emit('vehicle:update', v);
    }
  }

  const activeRooms = telemetryNs.adapter.rooms;
  for (const [room, roomBatch] of tileBuckets.entries()) {
    if (activeRooms.has(room)) {
      telemetryNs.to(room).emit('telemetry:batch', {
        room,
        vehicles: roomBatch,
      });
    }
  }

  if (activeRooms.has(OVERVIEW_ROOM)) {
    telemetryNs.to(OVERVIEW_ROOM).emit('telemetry:batch', {
      room: OVERVIEW_ROOM,
      vehicles: batch,
    });
  }

  if (anomalies.length > 0) {
    telemetryNs.emit('anomaly:alert', anomalies);
  }

  const status = simulator.getStatus();
  const metrics: FleetMetricsSnapshot = {
    timestamp: new Date().toISOString(),
    totalFleet: status.totalFleet,
    avgFleetSpeed: status.avgFleetSpeed,
    activeAnomalies: status.activeAnomalies,
    totalIngested: telemetryStore.getTotalIngested(),
    writesPerSec: telemetryStore.getWritesPerSec(status.totalFleet),
    storageMode: telemetryStore.getMode(),
    subscribedClients: telemetryNs.sockets.size,
    tickDurationMs,
    isPaused: status.isPaused,
    speedLimitKmh: status.speedLimitKmh,
    tileCount: tileBuckets.size,
    activeCity: status.activeCity,
  };

  telemetryNs.emit('fleet:metrics', metrics);
}

app.get('/api/health', (_req, res) => {
  const status = simulator.getStatus();
  res.json({
    status: 'ok',
    storageMode: telemetryStore.getMode(),
    mongoConnected: telemetryStore.isMongoConnected(),
    collections: [
      'telemetries',
      'anomalies',
      'roadincidents',
      'sharedtrips',
      'savedplaces',
      'triphistories',
    ],
    connectedClients: telemetryNs.sockets.size,
    totalFleet: status.totalFleet,
    activeCity: status.activeCity,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get('/api/telemetry/history/:vehicleId', async (req, res) => {
  try {
    const vehicleId = String(req.params.vehicleId || '').trim();
    const limit = Math.min(120, Math.max(10, Number(req.query.limit) || 60));
    if (!vehicleId) {
      res.status(400).json({ error: 'vehicleId is required' });
      return;
    }
    const history = await telemetryStore.getVehicleHistory(vehicleId, limit);
    res.json({ vehicleId, count: history.length, history });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load history';
    res.status(500).json({ error: msg });
  }
});

app.get('/api/telemetry/live', (_req, res) => {
  const vehicles = simulator.getLatestVehicles();
  res.json({
    timestamp: new Date().toISOString(),
    count: vehicles.length,
    vehicles,
  });
});

app.post('/api/telemetry/ingest', async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.vehicles)
      ? req.body.vehicles
      : Array.isArray(req.body)
        ? req.body
        : [req.body];

    const valid = raw.filter(
      (item: unknown): item is {
        vehicleId: string;
        lat: number;
        lng: number;
        speed: number;
        heading?: number;
        fleetType?: 'sedan' | 'van' | 'truck' | 'bus' | 'ev_shuttle';
        corridor?: string;
      } =>
        Boolean(item) &&
        typeof (item as Record<string, unknown>).vehicleId === 'string' &&
        typeof (item as Record<string, unknown>).lat === 'number' &&
        typeof (item as Record<string, unknown>).lng === 'number' &&
        typeof (item as Record<string, unknown>).speed === 'number'
    );

    if (valid.length === 0) {
      res.status(400).json({
        error: 'Provide vehicleId (string), lat (number), lng (number), and speed (number).',
      });
      return;
    }

    const ingested = await simulator.ingestExternalTelemetry(valid);
    broadcastTelemetryBatch(ingested, 0);
    res.status(201).json({ ok: true, count: ingested.length, vehicles: ingested });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to ingest telemetry';
    res.status(500).json({ error: msg });
  }
});

app.get('/api/telemetry/anomalies', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
    const anomalies = await telemetryStore.getRecentAnomaliesAsync(limit);
    res.json({ count: anomalies.length, anomalies });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load anomalies';
    res.status(500).json({ error: msg, anomalies: [] });
  }
});

app.get('/api/analytics/mongo-summary', async (_req, res) => {
  try {
    const summary = await telemetryStore.getMongoAnalyticsSummary(
      simulator.getLatestVehicles(),
      communityStore.getMemoryCounts()
    );
    res.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to compute summary';
    res.status(500).json({ error: msg });
  }
});

app.get('/api/simulation/status', (_req, res) => {
  const status = simulator.getStatus();
  res.json({
    ...status,
    storageMode: telemetryStore.getMode(),
    totalIngested: telemetryStore.getTotalIngested(),
    writesPerSec: telemetryStore.getWritesPerSec(status.totalFleet),
  });
});

app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MetroPulseTelemetry/1.0',
        'Accept-Language': 'en',
      },
    });
    if (!response.ok) {
      res.status(502).json({ error: 'Geocoding service unavailable', results: [] });
      return;
    }
    const raw = (await response.json()) as Array<{
      display_name: string;
      name?: string;
      lat: string;
      lon: string;
    }>;
    const results = raw.map((item) => ({
      name: item.name || item.display_name.split(',')[0].trim(),
      displayName: item.display_name,
      lat: Number(item.lat),
      lng: Number(item.lon),
    }));
    res.json({ results });
  } catch {
    res.status(500).json({ error: 'Failed to geocode query', results: [] });
  }
});

app.post('/api/simulation/city', (req, res) => {
  const { name, lat, lng } = (req.body || {}) as {
    name?: string;
    lat?: number;
    lng?: number;
  };
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    Number.isNaN(lat) ||
    Number.isNaN(lng) ||
    lat < -85 ||
    lat > 85 ||
    lng < -180 ||
    lng > 180
  ) {
    res.status(400).json({ error: 'Valid lat and lng coordinates are required.' });
    return;
  }

  telemetryStore.clearHistory();
  const city = simulator.setCity(
    typeof name === 'string' && name.trim()
      ? name.trim()
      : `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    lat,
    lng
  );
  telemetryNs.emit('simulation:city-changed', city);
  res.json({ ok: true, activeCity: city });
});

app.post('/api/simulation/config', (req, res) => {
  const payload = (req.body || {}) as SimulationConfigPayload;
  simulator.updateConfig(payload);
  const status = simulator.getStatus();
  telemetryNs.emit('fleet:metrics', {
    timestamp: new Date().toISOString(),
    ...status,
    totalIngested: telemetryStore.getTotalIngested(),
    writesPerSec: telemetryStore.getWritesPerSec(status.totalFleet),
    storageMode: telemetryStore.getMode(),
    subscribedClients: telemetryNs.sockets.size,
    tileCount: 0,
  } satisfies FleetMetricsSnapshot);
  res.json({ ok: true, status });
});

app.post('/api/simulation/inject-anomaly', (req, res) => {
  const bbox = req.body?.bbox;
  let preferredIds: string[] | undefined;

  if (isValidBbox(bbox)) {
    preferredIds = simulator
      .getLatestVehicles()
      .filter((v) => {
        const [lng, lat] = v.location.coordinates;
        return isPointInBbox(lat, lng, bbox);
      })
      .map((v) => v.meta.vehicleId);
  }

  const vehicleId = simulator.injectAnomaly(preferredIds);
  res.json({ ok: Boolean(vehicleId), vehicleId });
});

app.post('/api/routes/suggest', async (req, res) => {
  try {
    const body = (req.body || {}) as {
      originQuery?: string;
      destinationQuery?: string;
      originCoords?: { lat: number; lng: number; label?: string } | null;
      destinationCoords?: { lat: number; lng: number; label?: string } | null;
      stops?: RouteStopInput[];
      travelMode?: TravelMode;
      priority?: RoutePriority;
      userNotes?: string;
    };

    const originQuery = String(body.originQuery || '').trim();
    const destinationQuery = String(body.destinationQuery || '').trim();

    if (!originQuery && !body.originCoords) {
      res.status(400).json({ error: 'Please enter an origin or use GPS location.' });
      return;
    }
    if (!destinationQuery && !body.destinationCoords) {
      res.status(400).json({ error: 'Please enter a destination.' });
      return;
    }

    const validModes = new Set<TravelMode>([
      'driving',
      'walking',
      'bicycling',
      'transit',
    ]);
    const validPriorities = new Set<RoutePriority>([
      'recommended',
      'fastest',
      'avoid_anomalies',
      'eco',
    ]);

    const travelMode: TravelMode = validModes.has(body.travelMode as TravelMode)
      ? (body.travelMode as TravelMode)
      : 'driving';
    const priority: RoutePriority = validPriorities.has(
      body.priority as RoutePriority
    )
      ? (body.priority as RoutePriority)
      : 'recommended';

    const status = simulator.getStatus();
    const plan = await generateAiRouteSuggestions({
      originQuery,
      destinationQuery,
      originCoords: body.originCoords ?? null,
      destinationCoords: body.destinationCoords ?? null,
      stops: Array.isArray(body.stops) ? body.stops : [],
      travelMode,
      priority,
      userNotes: body.userNotes,
      activeCity: status.activeCity,
      vehicles: simulator.getLatestVehicles(),
      recentAnomalies: telemetryStore.getRecentAnomalies(20),
      activeIncidents: communityStore.getActiveIncidents(),
      speedLimitKmh: status.speedLimitKmh,
    });

    res.json(plan);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate AI route suggestions.';
    const statusCode = message.includes('Could not locate') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.get('/api/geocode/reverse', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
    return;
  }
  try {
    const info = await reverseGeocodeWithRoadLimit(lat, lng);
    res.json(info);
  } catch {
    res.status(500).json({ error: 'Reverse geocoding failed.' });
  }
});

app.get('/api/places/nearby', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const category = String(req.query.category || 'restaurant') as PoiCategory;
  const validCats = new Set<PoiCategory>([
    'fuel',
    'charging',
    'parking',
    'restaurant',
    'hospital',
    'transit',
  ]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !validCats.has(category)) {
    res.status(400).json({ error: 'Valid lat, lng, and category are required.' });
    return;
  }
  try {
    const places = await fetchNearbyPois(lat, lng, category);
    res.json({ category, count: places.length, places });
  } catch {
    res.status(500).json({ error: 'Failed to load nearby places.', places: [] });
  }
});

app.get('/api/incidents', (_req, res) => {
  res.json({ incidents: communityStore.getActiveIncidents() });
});

app.get('/api/incidents/near', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.min(25000, Math.max(250, Number(req.query.radius) || 5000));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
    return;
  }
  const incidents = await communityStore.getIncidentsNear(lat, lng, radius);
  res.json({ count: incidents.length, radiusMeters: radius, incidents });
});

app.post('/api/incidents', (req, res) => {
  const body = (req.body || {}) as {
    type?: IncidentType;
    title?: string;
    description?: string;
    lat?: number;
    lng?: number;
    corridor?: string;
  };
  const validTypes = new Set<IncidentType>([
    'accident',
    'closure',
    'construction',
    'hazard',
    'speed_trap',
    'flooding',
  ]);
  if (
    !body.type ||
    !validTypes.has(body.type) ||
    typeof body.lat !== 'number' ||
    typeof body.lng !== 'number'
  ) {
    res.status(400).json({ error: 'Valid incident type, lat, and lng are required.' });
    return;
  }
  const incident = communityStore.addIncident({
    type: body.type,
    title: body.title,
    description: body.description,
    lat: body.lat,
    lng: body.lng,
    corridor: body.corridor,
  });
  telemetryNs.emit('incidents:list', communityStore.getActiveIncidents());
  res.status(201).json({ ok: true, incident });
});

app.post('/api/incidents/:id/upvote', (req, res) => {
  const updated = communityStore.upvoteIncident(req.params.id);
  if (!updated) {
    res.status(404).json({ error: 'Incident not found.' });
    return;
  }
  telemetryNs.emit('incidents:list', communityStore.getActiveIncidents());
  res.json({ ok: true, incident: updated });
});

app.delete('/api/incidents/:id', (req, res) => {
  const removed = communityStore.removeIncident(req.params.id);
  if (!removed) {
    res.status(404).json({ error: 'Incident not found.' });
    return;
  }
  telemetryNs.emit('incidents:list', communityStore.getActiveIncidents());
  res.json({ ok: true });
});

app.post('/api/trips/share', (req, res) => {
  const body = (req.body || {}) as {
    routeTitle?: string;
    originName?: string;
    destinationName?: string;
    destinationLat?: number;
    destinationLng?: number;
    currentLat?: number;
    currentLng?: number;
    heading?: number;
    speedKmh?: number;
    etaMinutes?: number;
    remainingKm?: number;
    geometry?: Array<[number, number]>;
  };
  if (
    typeof body.currentLat !== 'number' ||
    typeof body.currentLng !== 'number' ||
    typeof body.destinationLat !== 'number' ||
    typeof body.destinationLng !== 'number'
  ) {
    res.status(400).json({ error: 'Valid current and destination coordinates are required.' });
    return;
  }
  const session = communityStore.createSharedTrip({
    routeTitle: body.routeTitle || 'Live Navigation Trip',
    originName: body.originName || 'Start',
    destinationName: body.destinationName || 'Destination',
    destinationLat: body.destinationLat,
    destinationLng: body.destinationLng,
    currentLat: body.currentLat,
    currentLng: body.currentLng,
    heading: Number(body.heading) || 0,
    speedKmh: Number(body.speedKmh) || 0,
    etaMinutes: Math.max(0, Number(body.etaMinutes) || 1),
    remainingKm: Math.max(0, Number(body.remainingKm) || 0.5),
    geometry: Array.isArray(body.geometry) ? body.geometry : [],
  });
  res.status(201).json({ ok: true, session });
});

app.get('/api/trips/history', async (_req, res) => {
  const history = await communityStore.listTripHistory();
  res.json({ count: history.length, history });
});

app.post('/api/trips/history', async (req, res) => {
  const body = (req.body || {}) as {
    id?: string;
    originName?: string;
    destinationName?: string;
    distanceKm?: number;
    durationMin?: number;
    travelMode?: TravelMode;
    googleMapsUrl?: string;
  };
  if (
    typeof body.originName !== 'string' ||
    typeof body.destinationName !== 'string' ||
    typeof body.googleMapsUrl !== 'string'
  ) {
    res.status(400).json({ error: 'originName, destinationName, and googleMapsUrl are required.' });
    return;
  }
  const entry = await communityStore.addTripHistory({
    id: body.id,
    originName: body.originName,
    destinationName: body.destinationName,
    distanceKm: Number(body.distanceKm) || 0,
    durationMin: Number(body.durationMin) || 0,
    travelMode: body.travelMode || 'driving',
    googleMapsUrl: body.googleMapsUrl,
  });
  res.status(201).json({ ok: true, entry });
});

app.delete('/api/trips/history', async (_req, res) => {
  await communityStore.clearTripHistory();
  res.json({ ok: true });
});

app.get('/api/trips/:token', async (req, res) => {
  const session = await communityStore.getSharedTripAsync(req.params.token);
  if (!session) {
    res.status(404).json({ error: 'Shared trip session expired or not found.' });
    return;
  }
  res.json({ session });
});

app.get('/api/places/saved', async (_req, res) => {
  const places = await communityStore.listSavedPlaces();
  res.json({ count: places.length, places });
});

app.post('/api/places/saved', async (req, res) => {
  const body = (req.body || {}) as {
    id?: string;
    label?: string;
    tag?: 'home' | 'work' | 'favorite';
    name?: string;
    lat?: number;
    lng?: number;
  };
  if (
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    typeof body.lat !== 'number' ||
    typeof body.lng !== 'number'
  ) {
    res.status(400).json({ error: 'Valid name, lat, and lng are required.' });
    return;
  }
  const tag =
    body.tag === 'home' || body.tag === 'work' || body.tag === 'favorite'
      ? body.tag
      : 'favorite';
  const place = await communityStore.upsertSavedPlace({
    id: body.id,
    label: body.label || body.name,
    tag,
    name: body.name.trim(),
    lat: body.lat,
    lng: body.lng,
  });
  res.status(201).json({ ok: true, place });
});

app.delete('/api/places/saved/:id', async (req, res) => {
  const removed = await communityStore.deleteSavedPlace(req.params.id);
  res.json({ ok: true, removed });
});

async function bootstrap() {
  await telemetryStore.connect();
  await communityStore.hydrateFromMongo();

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  simulator.start(broadcastTelemetryBatch, 500);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[MetroPulse] Server + Socket.IO (/telemetry) listening on http://0.0.0.0:${PORT}`
    );
  });
}

async function shutdown(signal: string) {
  console.log(`\n[MetroPulse] Received ${signal}, shutting down...`);
  simulator.stop();
  io.close();
  httpServer.close(async () => {
    await telemetryStore.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void bootstrap();
