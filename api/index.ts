import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { telemetryStore } from '../server/config/db.ts';
import {
  generateAiRouteSuggestions,
  type RouteStopInput,
} from '../server/engine/aiRouter.ts';
import {
  communityStore,
  fetchNearbyPois,
  reverseGeocodeWithRoadLimit,
} from '../server/engine/communityStore.ts';
import type {
  IncidentType,
  PoiCategory,
  RoutePriority,
  TravelMode,
} from '../server/types.ts';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

let initPromise: Promise<void> | null = null;
async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await telemetryStore.connect();
      await communityStore.hydrateFromMongo();
    })();
  }
  await initPromise;
}

app.use(async (_req, _res, next) => {
  await ensureInitialized();
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    runtime: 'vercel-serverless',
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
  });
});

app.get('/api/analytics/mongo-summary', async (_req, res) => {
  try {
    const summary = await telemetryStore.getMongoAnalyticsSummary(
      [],
      communityStore.getMemoryCounts()
    );
    res.json(summary);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to compute summary',
    });
  }
});

app.get('/api/telemetry/anomalies', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
    const anomalies = await telemetryStore.getRecentAnomaliesAsync(limit);
    res.json({ count: anomalies.length, anomalies });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load anomalies',
      anomalies: [],
    });
  }
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
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load history',
    });
  }
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
    res.status(400).json({
      error: 'originName, destinationName, and googleMapsUrl are required.',
    });
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

app.get('/api/trips/:token', async (req, res) => {
  const session = await communityStore.getSharedTripAsync(req.params.token);
  if (!session) {
    res.status(404).json({ error: 'Shared trip session expired or not found.' });
    return;
  }
  res.json({ session });
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
  res.status(201).json({ ok: true, incident });
});

app.post('/api/incidents/:id/upvote', (req, res) => {
  const updated = communityStore.upvoteIncident(req.params.id);
  if (!updated) {
    res.status(404).json({ error: 'Incident not found.' });
    return;
  }
  res.json({ ok: true, incident: updated });
});

app.delete('/api/incidents/:id', (req, res) => {
  const removed = communityStore.removeIncident(req.params.id);
  if (!removed) {
    res.status(404).json({ error: 'Incident not found.' });
    return;
  }
  res.json({ ok: true });
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
      activeCity?: { name: string; lat: number; lng: number };
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

    const plan = await generateAiRouteSuggestions({
      originQuery,
      destinationQuery,
      originCoords: body.originCoords ?? null,
      destinationCoords: body.destinationCoords ?? null,
      stops: Array.isArray(body.stops) ? body.stops : [],
      travelMode: body.travelMode ?? 'driving',
      priority: body.priority ?? 'recommended',
      userNotes: body.userNotes,
      activeCity: {
        name: body.activeCity?.name || 'San Francisco, CA',
        lat: body.activeCity?.lat ?? 37.7749,
        lng: body.activeCity?.lng ?? -122.4194,
        corridorSource: 'urban-grid',
        corridorCount: 10,
      },
      vehicles: [],
      recentAnomalies: await telemetryStore.getRecentAnomaliesAsync(20),
      activeIncidents: communityStore.getActiveIncidents(),
      speedLimitKmh: 68,
    });
    res.json(plan);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to generate AI route suggestions.';
    const statusCode = message.includes('Could not locate') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

export default function handler(req: Request, res: Response) {
  return app(req, res);
}
