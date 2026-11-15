import crypto from 'node:crypto';
import {
  RoadIncidentModel,
  SavedPlaceModel,
  SharedTripModel,
  telemetryStore,
  TripHistoryModel,
} from '../config/db.ts';
import type {
  IncidentType,
  PoiCategory,
  PoiPlace,
  RoadIncident,
  SharedTripSession,
  StreetPhotoItem,
  TravelMode,
} from '../types.ts';

export interface SavedPlaceRecord {
  id: string;
  label: string;
  tag: 'home' | 'work' | 'favorite';
  name: string;
  lat: number;
  lng: number;
  createdAt: string;
}

export interface TripHistoryRecord {
  id: string;
  originName: string;
  destinationName: string;
  distanceKm: number;
  durationMin: number;
  travelMode: TravelMode;
  googleMapsUrl: string;
  createdAt: string;
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

class CommunityMobilityStore {
  private incidents: RoadIncident[] = [];
  private sharedTrips = new Map<string, SharedTripSession>();
  private savedPlaces: SavedPlaceRecord[] = [];
  private tripHistory: TripHistoryRecord[] = [];

  public async hydrateFromMongo(): Promise<void> {
    if (!telemetryStore.isMongoConnected()) return;
    try {
      const now = new Date();
      const [incDocs, tripDocs, placeDocs, histDocs] = await Promise.all([
        RoadIncidentModel.find({ expiresAt: { $gt: now } })
          .sort({ createdAt: -1 })
          .limit(150)
          .lean(),
        SharedTripModel.find({ expiresAt: { $gt: now } })
          .sort({ updatedAt: -1 })
          .limit(100)
          .lean(),
        SavedPlaceModel.find().sort({ createdAt: -1 }).limit(50).lean(),
        TripHistoryModel.find().sort({ createdAt: -1 }).limit(50).lean(),
      ]);

      this.incidents = incDocs.map((doc) => ({
        id: doc.incidentId,
        type: doc.type as IncidentType,
        title: doc.title,
        description: doc.description ?? '',
        lat: doc.lat,
        lng: doc.lng,
        corridor: doc.corridor ?? 'Local Arterial',
        upvotes: doc.upvotes ?? 1,
        createdAt: new Date(doc.createdAt).toISOString(),
        expiresAt: new Date(doc.expiresAt).toISOString(),
      }));

      this.sharedTrips.clear();
      for (const doc of tripDocs) {
        this.sharedTrips.set(doc.token, {
          token: doc.token,
          routeTitle: doc.routeTitle,
          originName: doc.originName,
          destinationName: doc.destinationName,
          destinationLat: doc.destinationLat,
          destinationLng: doc.destinationLng,
          currentLat: doc.currentLat,
          currentLng: doc.currentLng,
          heading: doc.heading ?? 0,
          speedKmh: doc.speedKmh ?? 0,
          etaMinutes: doc.etaMinutes ?? 1,
          remainingKm: doc.remainingKm ?? 0.5,
          geometry: (doc.geometry ?? []) as Array<[number, number]>,
          updatedAt: new Date(doc.updatedAt).toISOString(),
          expiresAt: new Date(doc.expiresAt).toISOString(),
        });
      }

      this.savedPlaces = placeDocs.map((doc) => ({
        id: doc.placeId,
        label: doc.label,
        tag: (doc.tag ?? 'favorite') as 'home' | 'work' | 'favorite',
        name: doc.name,
        lat: doc.lat,
        lng: doc.lng,
        createdAt: new Date(doc.createdAt).toISOString(),
      }));

      this.tripHistory = histDocs.map((doc) => ({
        id: doc.tripId,
        originName: doc.originName,
        destinationName: doc.destinationName,
        distanceKm: doc.distanceKm,
        durationMin: doc.durationMin,
        travelMode: (doc.travelMode ?? 'driving') as TravelMode,
        googleMapsUrl: doc.googleMapsUrl,
        createdAt: new Date(doc.createdAt).toISOString(),
      }));

      console.log(
        `[MongoDB] Hydrated ${this.incidents.length} incidents, ${this.sharedTrips.size} shared trips, ${this.savedPlaces.length} saved places, ${this.tripHistory.length} trip history items`
      );
    } catch (err) {
      console.warn(
        '[MongoDB] Community store hydration warning:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  public getMemoryCounts() {
    return {
      incidents: this.getActiveIncidents().length,
      sharedTrips: this.sharedTrips.size,
      savedPlaces: this.savedPlaces.length,
      tripHistory: this.tripHistory.length,
    };
  }

  public getActiveIncidents(): RoadIncident[] {
    const now = Date.now();
    this.incidents = this.incidents.filter(
      (i) => new Date(i.expiresAt).getTime() > now
    );
    return [...this.incidents];
  }

  public async getIncidentsNear(
    lat: number,
    lng: number,
    radiusMeters = 5000
  ): Promise<RoadIncident[]> {
    if (telemetryStore.isMongoConnected()) {
      try {
        const docs = await RoadIncidentModel.find({
          expiresAt: { $gt: new Date() },
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [lng, lat] },
              $maxDistance: radiusMeters,
            },
          },
        })
          .limit(50)
          .lean();
        return docs.map((doc) => ({
          id: doc.incidentId,
          type: doc.type as IncidentType,
          title: doc.title,
          description: doc.description ?? '',
          lat: doc.lat,
          lng: doc.lng,
          corridor: doc.corridor ?? 'Local Arterial',
          upvotes: doc.upvotes ?? 1,
          createdAt: new Date(doc.createdAt).toISOString(),
          expiresAt: new Date(doc.expiresAt).toISOString(),
        }));
      } catch {
        // Fall through to in-memory filter
      }
    }
    return this.getActiveIncidents().filter(
      (inc) => haversineMeters(lat, lng, inc.lat, inc.lng) <= radiusMeters
    );
  }

  public addIncident(params: {
    type: IncidentType;
    title?: string;
    description?: string;
    lat: number;
    lng: number;
    corridor?: string;
  }): RoadIncident {
    const typeLabels: Record<IncidentType, string> = {
      accident: 'Traffic Accident',
      closure: 'Road Closure',
      construction: 'Lane Construction',
      hazard: 'Road Hazard',
      speed_trap: 'Speed Check Zone',
      flooding: 'Waterlogging / Flooding',
    };

    const now = new Date();
    const ttlMinutes = params.type === 'closure' || params.type === 'construction' ? 240 : 90;
    const expires = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    const record: RoadIncident = {
      id: `inc-${crypto.randomUUID().slice(0, 8)}`,
      type: params.type,
      title: params.title?.trim() || typeLabels[params.type] || 'Road Incident',
      description:
        params.description?.trim() ||
        'Community-reported incident affecting local corridor flow.',
      lat: Number(params.lat.toFixed(6)),
      lng: Number(params.lng.toFixed(6)),
      corridor: params.corridor?.trim() || 'Local Arterial',
      upvotes: 1,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    this.incidents.unshift(record);
    if (this.incidents.length > 150) {
      this.incidents = this.incidents.slice(0, 150);
    }

    if (telemetryStore.isMongoConnected()) {
      void RoadIncidentModel.create({
        incidentId: record.id,
        type: record.type,
        title: record.title,
        description: record.description,
        lat: record.lat,
        lng: record.lng,
        location: {
          type: 'Point',
          coordinates: [record.lng, record.lat],
        },
        corridor: record.corridor,
        upvotes: record.upvotes,
        createdAt: now,
        expiresAt: expires,
      }).catch((err: unknown) => {
        console.error(
          '[MongoDB] Failed to persist road incident:',
          err instanceof Error ? err.message : String(err)
        );
      });
    }

    return record;
  }

  public upvoteIncident(id: string): RoadIncident | null {
    const found = this.incidents.find((i) => i.id === id);
    if (!found) return null;
    found.upvotes += 1;
    // Extend expiry slightly on community confirmation
    const currentExp = new Date(found.expiresAt).getTime();
    const nextExpiry = new Date(currentExp + 15 * 60 * 1000);
    found.expiresAt = nextExpiry.toISOString();

    if (telemetryStore.isMongoConnected()) {
      void RoadIncidentModel.updateOne(
        { incidentId: id },
        { $inc: { upvotes: 1 }, $set: { expiresAt: nextExpiry } }
      ).catch(() => {});
    }

    return found;
  }

  public removeIncident(id: string): boolean {
    const before = this.incidents.length;
    this.incidents = this.incidents.filter((i) => i.id !== id);
    const removed = this.incidents.length !== before;

    if (removed && telemetryStore.isMongoConnected()) {
      void RoadIncidentModel.deleteOne({ incidentId: id }).catch(() => {});
    }

    return removed;
  }

  public createSharedTrip(payload: {
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
  }): SharedTripSession {
    const token = crypto.randomBytes(5).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const session: SharedTripSession = {
      token,
      ...payload,
      updatedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };
    this.sharedTrips.set(token, session);

    if (telemetryStore.isMongoConnected()) {
      void SharedTripModel.create({
        ...session,
        updatedAt: now,
        expiresAt: expires,
      }).catch((err: unknown) => {
        console.error(
          '[MongoDB] Failed to persist shared trip:',
          err instanceof Error ? err.message : String(err)
        );
      });
    }

    return session;
  }

  public updateSharedTrip(
    token: string,
    patch: {
      currentLat: number;
      currentLng: number;
      heading: number;
      speedKmh: number;
      etaMinutes: number;
      remainingKm: number;
    }
  ): SharedTripSession | null {
    const session = this.sharedTrips.get(token);
    if (!session) return null;
    const updatedAt = new Date();
    session.currentLat = patch.currentLat;
    session.currentLng = patch.currentLng;
    session.heading = patch.heading;
    session.speedKmh = patch.speedKmh;
    session.etaMinutes = patch.etaMinutes;
    session.remainingKm = patch.remainingKm;
    session.updatedAt = updatedAt.toISOString();

    if (telemetryStore.isMongoConnected()) {
      void SharedTripModel.updateOne(
        { token },
        {
          $set: {
            currentLat: patch.currentLat,
            currentLng: patch.currentLng,
            heading: patch.heading,
            speedKmh: patch.speedKmh,
            etaMinutes: patch.etaMinutes,
            remainingKm: patch.remainingKm,
            updatedAt,
          },
        }
      ).catch(() => {});
    }

    return session;
  }

  public getSharedTrip(token: string): SharedTripSession | null {
    const session = this.sharedTrips.get(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sharedTrips.delete(token);
      return null;
    }
    return session;
  }

  public async getSharedTripAsync(token: string): Promise<SharedTripSession | null> {
    const cached = this.getSharedTrip(token);
    if (cached) return cached;
    if (!telemetryStore.isMongoConnected()) return null;
    try {
      const doc = (await SharedTripModel.findOne({
        token,
        expiresAt: { $gt: new Date() },
      }).lean()) as Record<string, unknown> | null;
      if (!doc || Array.isArray(doc)) return null;
      const session: SharedTripSession = {
        token: String(doc.token),
        routeTitle: String(doc.routeTitle),
        originName: String(doc.originName),
        destinationName: String(doc.destinationName),
        destinationLat: Number(doc.destinationLat),
        destinationLng: Number(doc.destinationLng),
        currentLat: Number(doc.currentLat),
        currentLng: Number(doc.currentLng),
        heading: Number(doc.heading ?? 0),
        speedKmh: Number(doc.speedKmh ?? 0),
        etaMinutes: Number(doc.etaMinutes ?? 1),
        remainingKm: Number(doc.remainingKm ?? 0.5),
        geometry: (Array.isArray(doc.geometry) ? doc.geometry : []) as Array<[number, number]>,
        updatedAt: new Date(String(doc.updatedAt)).toISOString(),
        expiresAt: new Date(String(doc.expiresAt)).toISOString(),
      };
      this.sharedTrips.set(token, session);
      return session;
    } catch {
      return null;
    }
  }

  public async listSavedPlaces(): Promise<SavedPlaceRecord[]> {
    if (telemetryStore.isMongoConnected()) {
      try {
        const docs = await SavedPlaceModel.find()
          .sort({ createdAt: -1 })
          .limit(30)
          .lean();
        this.savedPlaces = docs.map((doc) => ({
          id: doc.placeId,
          label: doc.label,
          tag: (doc.tag ?? 'favorite') as 'home' | 'work' | 'favorite',
          name: doc.name,
          lat: doc.lat,
          lng: doc.lng,
          createdAt: new Date(doc.createdAt).toISOString(),
        }));
      } catch {
        // Fall through to in-memory cache
      }
    }
    return [...this.savedPlaces];
  }

  public async upsertSavedPlace(place: {
    id?: string;
    label: string;
    tag: 'home' | 'work' | 'favorite';
    name: string;
    lat: number;
    lng: number;
  }): Promise<SavedPlaceRecord> {
    const now = new Date();
    const record: SavedPlaceRecord = {
      id: place.id?.trim() || `sp-${crypto.randomUUID().slice(0, 8)}`,
      label: place.label.trim() || place.name,
      tag: place.tag,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      createdAt: now.toISOString(),
    };

    const filtered =
      record.tag === 'home' || record.tag === 'work'
        ? this.savedPlaces.filter((p) => p.tag !== record.tag)
        : this.savedPlaces.filter(
            (p) =>
              Math.abs(p.lat - record.lat) > 0.0002 ||
              Math.abs(p.lng - record.lng) > 0.0002
          );
    this.savedPlaces = [record, ...filtered].slice(0, 30);

    if (telemetryStore.isMongoConnected()) {
      try {
        if (record.tag === 'home' || record.tag === 'work') {
          await SavedPlaceModel.deleteMany({ tag: record.tag });
        } else {
          await SavedPlaceModel.deleteMany({
            tag: 'favorite',
            lat: { $gte: record.lat - 0.0002, $lte: record.lat + 0.0002 },
            lng: { $gte: record.lng - 0.0002, $lte: record.lng + 0.0002 },
          });
        }
        await SavedPlaceModel.create({
          placeId: record.id,
          label: record.label,
          tag: record.tag,
          name: record.name,
          lat: record.lat,
          lng: record.lng,
          createdAt: now,
        });
      } catch (err) {
        console.error(
          '[MongoDB] SavedPlace upsert error:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    return record;
  }

  public async deleteSavedPlace(id: string): Promise<boolean> {
    const before = this.savedPlaces.length;
    this.savedPlaces = this.savedPlaces.filter((p) => p.id !== id);
    let removed = this.savedPlaces.length !== before;

    if (telemetryStore.isMongoConnected()) {
      try {
        const res = await SavedPlaceModel.deleteOne({ placeId: id });
        if (res.deletedCount > 0) removed = true;
      } catch {
        // ignore
      }
    }

    return removed;
  }

  public async listTripHistory(): Promise<TripHistoryRecord[]> {
    if (telemetryStore.isMongoConnected()) {
      try {
        const docs = await TripHistoryModel.find()
          .sort({ createdAt: -1 })
          .limit(25)
          .lean();
        this.tripHistory = docs.map((doc) => ({
          id: doc.tripId,
          originName: doc.originName,
          destinationName: doc.destinationName,
          distanceKm: doc.distanceKm,
          durationMin: doc.durationMin,
          travelMode: (doc.travelMode ?? 'driving') as TravelMode,
          googleMapsUrl: doc.googleMapsUrl,
          createdAt: new Date(doc.createdAt).toISOString(),
        }));
      } catch {
        // Fall through to memory cache
      }
    }
    return [...this.tripHistory];
  }

  public async addTripHistory(entry: {
    id?: string;
    originName: string;
    destinationName: string;
    distanceKm: number;
    durationMin: number;
    travelMode: TravelMode;
    googleMapsUrl: string;
  }): Promise<TripHistoryRecord> {
    const now = new Date();
    const record: TripHistoryRecord = {
      id: entry.id?.trim() || `trip-${crypto.randomUUID().slice(0, 8)}`,
      originName: entry.originName,
      destinationName: entry.destinationName,
      distanceKm: entry.distanceKm,
      durationMin: entry.durationMin,
      travelMode: entry.travelMode,
      googleMapsUrl: entry.googleMapsUrl,
      createdAt: now.toISOString(),
    };
    this.tripHistory = [record, ...this.tripHistory].slice(0, 25);

    if (telemetryStore.isMongoConnected()) {
      try {
        await TripHistoryModel.create({
          tripId: record.id,
          originName: record.originName,
          destinationName: record.destinationName,
          distanceKm: record.distanceKm,
          durationMin: record.durationMin,
          travelMode: record.travelMode,
          googleMapsUrl: record.googleMapsUrl,
          createdAt: now,
        });
      } catch (err) {
        console.error(
          '[MongoDB] TripHistory insert error:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    return record;
  }

  public async clearTripHistory(): Promise<void> {
    this.tripHistory = [];
    if (telemetryStore.isMongoConnected()) {
      try {
        await TripHistoryModel.deleteMany({});
      } catch {
        // ignore
      }
    }
  }
}

export const communityStore = new CommunityMobilityStore();

function parseMaxSpeedTag(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  const numMatch = trimmed.match(/(\d+)/);
  if (!numMatch) return null;
  const val = Number(numMatch[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  if (trimmed.includes('mph')) {
    return Math.round(val * 1.60934);
  }
  return val;
}

export async function fetchStreetPhotos(
  lat: number,
  lng: number
): Promise<StreetPhotoItem[]> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lng}&ggsradius=800&ggslimit=4&ggsnamespace=6&prop=imageinfo&iiprop=url&iiurlwidth=480&format=json&origin=*`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MetroPulseTelemetry/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              url?: string;
              thumburl?: string;
              descriptionurl?: string;
            }>;
          }
        >;
      };
    };
    const pages = Object.values(data.query?.pages ?? {});
    return pages
      .filter((p) => p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url)
      .slice(0, 3)
      .map((p) => {
        const info = p.imageinfo![0];
        return {
          title: (p.title || 'Street View').replace(/^File:/, '').replace(/\.[^.]+$/, ''),
          imageUrl: info.url || info.thumburl || '',
          thumbUrl: info.thumburl || info.url || '',
          pageUrl: info.descriptionurl || info.url || '',
          distanceMeters: 0,
        };
      });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function reverseGeocodeWithRoadLimit(lat: number, lng: number) {
  const revUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  const overpassQuery = `[out:json][timeout:3];way["highway"]["maxspeed"](around:45,${lat},${lng});out tags 3;`;

  const revCtrl = new AbortController();
  const speedCtrl = new AbortController();
  const revTimer = setTimeout(() => revCtrl.abort(), 4500);
  const speedTimer = setTimeout(() => speedCtrl.abort(), 4000);

  const [revRes, speedRes, photos] = await Promise.allSettled([
    fetch(revUrl, {
      headers: {
        'User-Agent': 'MetroPulseTelemetry/1.0',
        'Accept-Language': 'en',
      },
      signal: revCtrl.signal,
    }).finally(() => clearTimeout(revTimer)),
    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'MetroPulseTelemetry/1.0',
      },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: speedCtrl.signal,
    }).finally(() => clearTimeout(speedTimer)),
    fetchStreetPhotos(lat, lng),
  ]);

  let name = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  let displayName = `Coordinates ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  let roadName: string | undefined;

  if (revRes.status === 'fulfilled' && revRes.value.ok) {
    try {
      const json = (await revRes.value.json()) as {
        name?: string;
        display_name?: string;
        address?: {
          road?: string;
          suburb?: string;
          city?: string;
          town?: string;
        };
      };
      roadName = json.address?.road;
      name =
        json.name ||
        json.address?.road ||
        json.display_name?.split(',')[0]?.trim() ||
        name;
      displayName = json.display_name || displayName;
    } catch {
      // keep fallback coordinates label
    }
  }

  let maxSpeedKmh: number | null = null;
  if (speedRes.status === 'fulfilled' && speedRes.value.ok) {
    try {
      const osm = (await speedRes.value.json()) as {
        elements?: Array<{ tags?: { maxspeed?: string; name?: string } }>;
      };
      for (const el of osm.elements ?? []) {
        const parsed = parseMaxSpeedTag(el.tags?.maxspeed);
        if (parsed) {
          maxSpeedKmh = parsed;
          if (!roadName && el.tags?.name) roadName = el.tags.name;
          break;
        }
      }
    } catch {
      // ignore Overpass parse errors
    }
  }

  return {
    lat,
    lng,
    name,
    displayName,
    roadName,
    maxSpeedKmh,
    photos: photos.status === 'fulfilled' ? photos.value : [],
  };
}

function buildSimulatedDepartures(lines: string[], isRail: boolean): string[] {
  const headways = isRail ? [4, 11, 19] : [6, 15, 27];
  return headways.map((mins, idx) => {
    const line = lines[idx % Math.max(1, lines.length)] || (isRail ? 'Metro Line' : 'Local Bus');
    return `${line} · ${mins} min`;
  });
}

export async function fetchNearbyPois(
  lat: number,
  lng: number,
  category: PoiCategory,
  radiusMeters = 3500
): Promise<PoiPlace[]> {
  const filterByCat: Record<PoiCategory, string> = {
    fuel: `nwr["amenity"="fuel"](around:${radiusMeters},${lat},${lng});`,
    charging: `nwr["amenity"="charging_station"](around:${radiusMeters},${lat},${lng});`,
    parking: `nwr["amenity"="parking"](around:${radiusMeters},${lat},${lng});`,
    restaurant: `nwr["amenity"~"^(restaurant|cafe|fast_food)$"](around:${Math.min(2000, radiusMeters)},${lat},${lng});`,
    hospital: `nwr["amenity"~"^(hospital|clinic|pharmacy)$"](around:${radiusMeters},${lat},${lng});`,
    transit: `(nwr["railway"~"^(station|subway_entrance|tram_stop)$"](around:${radiusMeters},${lat},${lng});nwr["highway"="bus_stop"](around:${Math.min(1200, radiusMeters)},${lat},${lng});nwr["amenity"="bus_station"](around:${radiusMeters},${lat},${lng}););`,
  };

  const query = `[out:json][timeout:6];${filterByCat[category]}out center tags 20;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);

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

    if (res.ok) {
      const data = (await res.json()) as {
        elements?: Array<{
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }>;
      };

      const places: PoiPlace[] = [];
      for (const el of data.elements ?? []) {
        const pLat = el.lat ?? el.center?.lat;
        const pLng = el.lon ?? el.center?.lon;
        if (typeof pLat !== 'number' || typeof pLng !== 'number') continue;

        const tags = el.tags ?? {};
        const name =
          tags.name ||
          tags.brand ||
          tags.operator ||
          (category === 'charging'
            ? 'EV Charging Hub'
            : category === 'parking'
              ? 'Public Parking'
              : category === 'transit'
                ? 'Transit Stop'
                : `${category.charAt(0).toUpperCase() + category.slice(1)} Spot`);

        const connectorKeys = Object.keys(tags).filter((k) =>
          k.startsWith('socket:')
        );
        const evConnectors =
          connectorKeys.length > 0
            ? connectorKeys
                .map((k) => k.replace('socket:', '').toUpperCase())
                .slice(0, 3)
                .join(' / ')
            : undefined;

        const transitLines = tags.route_ref
          ? tags.route_ref.split(';').map((s) => s.trim()).filter(Boolean).slice(0, 4)
          : tags.network
            ? [tags.network]
            : undefined;

        const isRail = Boolean(tags.railway || tags.subway);

        places.push({
          id: `${category}-${el.id}`,
          name,
          category,
          lat: pLat,
          lng: pLng,
          distanceMeters: Math.round(haversineMeters(lat, lng, pLat, pLng)),
          address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']]
            .filter(Boolean)
            .join(' ') || undefined,
          openingHours: tags.opening_hours,
          phone: tags.phone || tags['contact:phone'],
          website: tags.website || tags['contact:website'],
          operator: tags.operator || tags.brand,
          evConnectors,
          capacity: tags.capacity,
          transitLines,
          nextDepartures:
            category === 'transit'
              ? buildSimulatedDepartures(transitLines ?? [name], isRail)
              : undefined,
        });
      }

      if (places.length > 0) {
        return places
          .sort((a, b) => a.distanceMeters - b.distanceMeters)
          .slice(0, 20);
      }
    }
  } catch {
    // Fall through to Nominatim fallback
  } finally {
    clearTimeout(timer);
  }

  // Nominatim bounding-box search fallback if Overpass returned empty or timed out
  const termMap: Record<PoiCategory, string> = {
    fuel: '[amenity=fuel]',
    charging: '[amenity=charging_station]',
    parking: '[amenity=parking]',
    restaurant: 'restaurant',
    hospital: 'hospital',
    transit: 'station',
  };
  const viewbox = [lng - 0.08, lat + 0.08, lng + 0.08, lat - 0.08].join(',');
  const nomCtrl = new AbortController();
  const nomTimer = setTimeout(() => nomCtrl.abort(), 5000);
  try {
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=12&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(termMap[category])}`,
      {
        headers: { 'User-Agent': 'MetroPulseTelemetry/1.0', 'Accept-Language': 'en' },
        signal: nomCtrl.signal,
      }
    );
    if (!nomRes.ok) return [];
    const items = (await nomRes.json()) as Array<{
      place_id: number;
      name?: string;
      display_name: string;
      lat: string;
      lon: string;
    }>;
    return items
      .map((item) => {
        const pLat = Number(item.lat);
        const pLng = Number(item.lon);
        return {
          id: `${category}-nom-${item.place_id}`,
          name: item.name || item.display_name.split(',')[0].trim(),
          category,
          lat: pLat,
          lng: pLng,
          distanceMeters: Math.round(haversineMeters(lat, lng, pLat, pLng)),
          address: item.display_name,
        };
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  } catch {
    return [];
  } finally {
    clearTimeout(nomTimer);
  }
}
