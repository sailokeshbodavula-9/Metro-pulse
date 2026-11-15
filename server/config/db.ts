import mongoose from 'mongoose';
import type { AnomalyRecord, FleetType, TelemetryPoint } from '../types.ts';

const telemetrySchema = new mongoose.Schema(
  {
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    meta: {
      vehicleId: {
        type: String,
        required: true,
      },
      fleetType: {
        type: String,
        enum: ['sedan', 'van', 'truck', 'bus', 'ev_shuttle'],
        default: 'sedan',
      },
      corridor: {
        type: String,
        default: 'Urban Grid',
      },
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    speed: {
      type: Number,
      required: true,
      min: 0,
    },
    movingAvgSpeed: {
      type: Number,
      min: 0,
    },
    speedDelta: {
      type: Number,
      default: 0,
    },
    heading: {
      type: Number,
      min: 0,
      max: 360,
      default: 0,
    },
    isAnomaly: {
      type: Boolean,
      default: false,
    },
    anomalyReason: {
      type: String,
      default: null,
    },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'meta',
      granularity: 'seconds',
    },
    expireAfterSeconds: 60 * 60 * 24 * 7,
    versionKey: false,
    autoCreate: true,
  }
);

telemetrySchema.index({ 'meta.vehicleId': 1, timestamp: -1 });
telemetrySchema.index({ location: '2dsphere' });

export const TelemetryModel =
  mongoose.models.Telemetry || mongoose.model('Telemetry', telemetrySchema);

// 1. Persistent Anomaly Audit Log (with 7-day TTL + 2dsphere geo-index)
const anomalySchema = new mongoose.Schema(
  {
    anomalyId: { type: String, required: true, unique: true },
    timestamp: { type: Date, required: true, default: Date.now },
    vehicleId: { type: String, required: true, index: true },
    fleetType: {
      type: String,
      enum: ['sedan', 'van', 'truck', 'bus', 'ev_shuttle'],
      default: 'sedan',
    },
    corridor: { type: String, default: 'Urban Grid', index: true },
    speed: { type: Number, required: true },
    movingAvgSpeed: { type: Number, required: true },
    speedLimit: { type: Number, required: true },
    reason: { type: String, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point', required: true },
      coordinates: { type: [Number], required: true },
    },
  },
  { versionKey: false, autoCreate: true }
);

anomalySchema.index({ timestamp: -1 });
anomalySchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
anomalySchema.index({ corridor: 1, timestamp: -1 });
anomalySchema.index({ location: '2dsphere' });

export const AnomalyModel =
  mongoose.models.Anomaly || mongoose.model('Anomaly', anomalySchema);

// 2. Crowd-Sourced Road Hazards & Incidents (with 2dsphere + auto-expiry TTL)
const roadIncidentSchema = new mongoose.Schema(
  {
    incidentId: { type: String, required: true, unique: true },
    type: {
      type: String,
      enum: ['accident', 'closure', 'construction', 'hazard', 'speed_trap', 'flooding'],
      required: true,
    },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point', required: true },
      coordinates: { type: [Number], required: true },
    },
    corridor: { type: String, default: 'Local Arterial' },
    upvotes: { type: Number, default: 1 },
    createdAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, autoCreate: true }
);

roadIncidentSchema.index({ location: '2dsphere' });
roadIncidentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RoadIncidentModel =
  mongoose.models.RoadIncident || mongoose.model('RoadIncident', roadIncidentSchema);

// 3. Live Shared ETA Trips (with auto-expiry TTL)
const sharedTripSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    routeTitle: { type: String, required: true },
    originName: { type: String, required: true },
    destinationName: { type: String, required: true },
    destinationLat: { type: Number, required: true },
    destinationLng: { type: Number, required: true },
    currentLat: { type: Number, required: true },
    currentLng: { type: Number, required: true },
    heading: { type: Number, default: 0 },
    speedKmh: { type: Number, default: 0 },
    etaMinutes: { type: Number, default: 1 },
    remainingKm: { type: Number, default: 0.5 },
    geometry: { type: [[Number]], default: [] },
    updatedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, autoCreate: true }
);

sharedTripSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SharedTripModel =
  mongoose.models.SharedTrip || mongoose.model('SharedTrip', sharedTripSchema);

// 4. User Saved Places (Home, Work, Favorites)
const savedPlaceSchema = new mongoose.Schema(
  {
    placeId: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    tag: { type: String, enum: ['home', 'work', 'favorite'], default: 'favorite' },
    name: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false, autoCreate: true }
);

savedPlaceSchema.index({ tag: 1, createdAt: -1 });

export const SavedPlaceModel =
  mongoose.models.SavedPlace || mongoose.model('SavedPlace', savedPlaceSchema);

// 5. Recent AI Route & Trip History
const tripHistorySchema = new mongoose.Schema(
  {
    tripId: { type: String, required: true, unique: true },
    originName: { type: String, required: true },
    destinationName: { type: String, required: true },
    distanceKm: { type: Number, required: true },
    durationMin: { type: Number, required: true },
    travelMode: {
      type: String,
      enum: ['driving', 'walking', 'bicycling', 'transit'],
      default: 'driving',
    },
    googleMapsUrl: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false, autoCreate: true }
);

tripHistorySchema.index({ createdAt: -1 });

export const TripHistoryModel =
  mongoose.models.TripHistory || mongoose.model('TripHistory', tripHistorySchema);

export interface CollectionStatusItem {
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
  collections: CollectionStatusItem[];
  corridorHotspots: CorridorHotspotSummary[];
  fleetBreakdown: FleetAnomalyBreakdown[];
}

const MAX_POINTS_PER_VEHICLE = 120;
const MAX_ANOMALY_LOG = 250;

class TimeSeriesStore {
  private mongoConnected = false;
  private vehicleHistory = new Map<string, TelemetryPoint[]>();
  private anomalyLog: AnomalyRecord[] = [];
  private totalIngested = 0;
  private recentWriteTimestamps: number[] = [];

  async connect(): Promise<void> {
    const mongoUri = process.env.MONGO_URI?.trim();
    if (!mongoUri) {
      console.log(
        '[Storage] MONGO_URI not set — running with high-throughput in-memory Time Series ring buffer'
      );
      this.mongoConnected = false;
      return;
    }

    mongoose.connection.on('connected', () => {
      this.mongoConnected = true;
      console.log('[MongoDB] Connected to Time Series telemetry cluster');
    });

    mongoose.connection.on('error', (err) => {
      console.error('[MongoDB] Connection error:', err.message);
      this.mongoConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      this.mongoConnected = false;
      console.warn('[MongoDB] Disconnected from database');
    });

    try {
      await mongoose.connect(mongoUri, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      await Promise.all([
        TelemetryModel.init(),
        AnomalyModel.init(),
        RoadIncidentModel.init(),
        SharedTripModel.init(),
        SavedPlaceModel.init(),
        TripHistoryModel.init(),
      ]);
      this.mongoConnected = true;

      // Hydrate recent anomalies from MongoDB
      const recentAnomalies = await AnomalyModel.find()
        .sort({ timestamp: -1 })
        .limit(MAX_ANOMALY_LOG)
        .lean();
      if (recentAnomalies.length > 0) {
        this.anomalyLog = recentAnomalies.map((doc) => ({
          id: doc.anomalyId,
          timestamp: new Date(doc.timestamp).toISOString(),
          vehicleId: doc.vehicleId,
          fleetType: (doc.fleetType ?? 'sedan') as FleetType,
          corridor: doc.corridor ?? 'Urban Grid',
          speed: doc.speed,
          movingAvgSpeed: doc.movingAvgSpeed,
          speedLimit: doc.speedLimit,
          reason: doc.reason as AnomalyRecord['reason'],
          coordinates: (doc.location?.coordinates ?? [0, 0]) as [number, number],
        }));
      }

      console.log(
        '[MongoDB] All 6 collections (telemetries, anomalies, roadincidents, sharedtrips, savedplaces, triphistories) & indexes verified'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[MongoDB] Unavailable (${msg}) — falling back to in-memory Time Series ring buffer`
      );
      this.mongoConnected = false;
    }
  }

  async disconnect(): Promise<void> {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      this.mongoConnected = false;
    }
  }

  isMongoConnected(): boolean {
    return this.mongoConnected;
  }

  getMode(): 'mongodb-timeseries' | 'in-memory-timeseries' {
    return this.mongoConnected ? 'mongodb-timeseries' : 'in-memory-timeseries';
  }

  clearHistory(): void {
    this.vehicleHistory.clear();
  }

  async ingestBatch(
    batch: TelemetryPoint[],
    speedLimitKmh: number
  ): Promise<void> {
    if (batch.length === 0) return;

    const nowMs = Date.now();
    this.totalIngested += batch.length;
    this.recentWriteTimestamps.push(nowMs);
    const cutoff = nowMs - 5000;
    while (
      this.recentWriteTimestamps.length > 0 &&
      this.recentWriteTimestamps[0] < cutoff
    ) {
      this.recentWriteTimestamps.shift();
    }

    const newAnomalies: AnomalyRecord[] = [];

    for (const point of batch) {
      const vid = point.meta.vehicleId;
      let series = this.vehicleHistory.get(vid);
      if (!series) {
        series = [];
        this.vehicleHistory.set(vid, series);
      }
      series.push(point);
      if (series.length > MAX_POINTS_PER_VEHICLE) {
        series.shift();
      }

      if (point.isAnomaly && point.anomalyReason) {
        const record: AnomalyRecord = {
          id: `${vid}-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: point.timestamp,
          vehicleId: vid,
          fleetType: point.meta.fleetType as FleetType,
          corridor: point.meta.corridor,
          speed: point.speed,
          movingAvgSpeed: point.movingAvgSpeed,
          speedLimit: speedLimitKmh,
          reason: point.anomalyReason,
          coordinates: point.location.coordinates,
        };
        this.anomalyLog.unshift(record);
        newAnomalies.push(record);
        if (this.anomalyLog.length > MAX_ANOMALY_LOG) {
          this.anomalyLog.pop();
        }
      }
    }

    if (this.mongoConnected) {
      try {
        await TelemetryModel.insertMany(batch, { ordered: false });
        if (newAnomalies.length > 0) {
          await AnomalyModel.insertMany(
            newAnomalies.map((a) => ({
              anomalyId: a.id,
              timestamp: new Date(a.timestamp),
              vehicleId: a.vehicleId,
              fleetType: a.fleetType,
              corridor: a.corridor,
              speed: a.speed,
              movingAvgSpeed: a.movingAvgSpeed,
              speedLimit: a.speedLimit,
              reason: a.reason,
              location: {
                type: 'Point',
                coordinates: a.coordinates,
              },
            })),
            { ordered: false }
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[MongoDB] Batch insert error:', msg);
      }
    }
  }

  async getVehicleHistory(
    vehicleId: string,
    limit = 60
  ): Promise<TelemetryPoint[]> {
    if (this.mongoConnected) {
      try {
        const docs = await TelemetryModel.find({ 'meta.vehicleId': vehicleId })
          .sort({ timestamp: -1 })
          .limit(limit)
          .lean();
        return docs.reverse().map((doc) => ({
          timestamp: new Date(doc.timestamp).toISOString(),
          meta: {
            vehicleId: doc.meta?.vehicleId ?? vehicleId,
            fleetType: (doc.meta?.fleetType ?? 'sedan') as FleetType,
            corridor: doc.meta?.corridor ?? 'Urban Grid',
          },
          location: {
            type: 'Point',
            coordinates: (doc.location?.coordinates ?? [0, 0]) as [number, number],
          },
          speed: doc.speed,
          movingAvgSpeed: doc.movingAvgSpeed ?? doc.speed,
          speedDelta: doc.speedDelta ?? 0,
          heading: doc.heading ?? 0,
          isAnomaly: Boolean(doc.isAnomaly),
          anomalyReason: doc.anomalyReason ?? null,
          tileRoom: '',
        }));
      } catch {
        // Fall through to ring buffer
      }
    }

    const series = this.vehicleHistory.get(vehicleId) ?? [];
    return series.slice(-limit);
  }

  getRecentAnomalies(limit = 50): AnomalyRecord[] {
    return this.anomalyLog.slice(0, limit);
  }

  async getRecentAnomaliesAsync(limit = 50): Promise<AnomalyRecord[]> {
    if (this.mongoConnected) {
      try {
        const docs = await AnomalyModel.find()
          .sort({ timestamp: -1 })
          .limit(limit)
          .lean();
        if (docs.length > 0) {
          return docs.map((doc) => ({
            id: doc.anomalyId,
            timestamp: new Date(doc.timestamp).toISOString(),
            vehicleId: doc.vehicleId,
            fleetType: (doc.fleetType ?? 'sedan') as FleetType,
            corridor: doc.corridor ?? 'Urban Grid',
            speed: doc.speed,
            movingAvgSpeed: doc.movingAvgSpeed,
            speedLimit: doc.speedLimit,
            reason: doc.reason as AnomalyRecord['reason'],
            coordinates: (doc.location?.coordinates ?? [0, 0]) as [number, number],
          }));
        }
      } catch {
        // Fall through to in-memory log
      }
    }
    return this.anomalyLog.slice(0, limit);
  }

  getTotalIngested(): number {
    return this.totalIngested;
  }

  getWritesPerSec(batchSizeEstimate: number): number {
    if (this.recentWriteTimestamps.length === 0) return 0;
    return Math.round(
      (this.recentWriteTimestamps.length * batchSizeEstimate) / 5
    );
  }

  async getMongoAnalyticsSummary(
    liveVehicles: TelemetryPoint[],
    memoryCounts: {
      incidents: number;
      sharedTrips: number;
      savedPlaces: number;
      tripHistory: number;
    }
  ): Promise<MongoAnalyticsSummary> {
    if (this.mongoConnected) {
      try {
        const since = new Date(Date.now() - 60 * 60 * 1000);
        const [
          telCount,
          anomCount,
          incCount,
          shareCount,
          placeCount,
          histCount,
          corridorAgg,
          fleetAgg,
        ] = await Promise.all([
          TelemetryModel.countDocuments(),
          AnomalyModel.countDocuments(),
          RoadIncidentModel.countDocuments({ expiresAt: { $gt: new Date() } }),
          SharedTripModel.countDocuments({ expiresAt: { $gt: new Date() } }),
          SavedPlaceModel.countDocuments(),
          TripHistoryModel.countDocuments(),
          TelemetryModel.aggregate([
            { $match: { timestamp: { $gte: since } } },
            {
              $group: {
                _id: '$meta.corridor',
                telemetryCount: { $sum: 1 },
                avgSpeedKmh: { $avg: '$speed' },
                anomalyCount: {
                  $sum: { $cond: [{ $eq: ['$isAnomaly', true] }, 1, 0] },
                },
              },
            },
            { $sort: { anomalyCount: -1, telemetryCount: -1 } },
            { $limit: 8 },
          ]),
          AnomalyModel.aggregate([
            {
              $group: {
                _id: '$fleetType',
                anomalyCount: { $sum: 1 },
                avgAnomalySpeedKmh: { $avg: '$speed' },
              },
            },
            { $sort: { anomalyCount: -1 } },
          ]),
        ]);

        return {
          storageMode: 'mongodb-timeseries',
          mongoConnected: true,
          generatedAt: new Date().toISOString(),
          collections: [
            {
              name: 'telemetries',
              purpose: 'Vehicle GPS Time Series (7d TTL)',
              indexes: ['timeseries(timestamp, meta)', '2dsphere(location)', 'meta.vehicleId'],
              documents: telCount,
            },
            {
              name: 'anomalies',
              purpose: 'Speed & Acceleration Audit Log (7d TTL)',
              indexes: ['timestamp(-1)', 'TTL(7d)', 'corridor', '2dsphere(location)'],
              documents: anomCount,
            },
            {
              name: 'roadincidents',
              purpose: 'Crowd-Sourced Hazards & Reports',
              indexes: ['2dsphere(location)', 'TTL(expiresAt)'],
              documents: incCount,
            },
            {
              name: 'sharedtrips',
              purpose: 'Live Shared ETA Sessions',
              indexes: ['unique(token)', 'TTL(expiresAt)'],
              documents: shareCount,
            },
            {
              name: 'savedplaces',
              purpose: 'Saved Home, Work & Favorite Pins',
              indexes: ['unique(placeId)', 'tag + createdAt'],
              documents: placeCount,
            },
            {
              name: 'triphistories',
              purpose: 'Recent AI Routes & Trips',
              indexes: ['unique(tripId)', 'createdAt(-1)'],
              documents: histCount,
            },
          ],
          corridorHotspots: corridorAgg.map((row) => ({
            corridor: String(row._id || 'Urban Grid'),
            telemetryCount: Number(row.telemetryCount) || 0,
            avgSpeedKmh: Number((row.avgSpeedKmh ?? 0).toFixed(1)),
            anomalyCount: Number(row.anomalyCount) || 0,
          })),
          fleetBreakdown: fleetAgg.map((row) => ({
            fleetType: String(row._id || 'sedan'),
            anomalyCount: Number(row.anomalyCount) || 0,
            avgAnomalySpeedKmh: Number((row.avgAnomalySpeedKmh ?? 0).toFixed(1)),
          })),
        };
      } catch (err) {
        console.warn(
          '[MongoDB] Aggregation fallback to memory:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // In-memory aggregation mirror matching the MongoDB $group pipeline output
    const corridorMap = new Map<
      string,
      { total: number; speedSum: number; anomalies: number }
    >();
    let cachedPoints = 0;
    for (const series of this.vehicleHistory.values()) {
      cachedPoints += series.length;
    }

    const sourcePoints =
      liveVehicles.length > 0
        ? liveVehicles
        : Array.from(this.vehicleHistory.values()).flat();

    for (const pt of sourcePoints) {
      const c = pt.meta.corridor || 'Urban Grid';
      const entry = corridorMap.get(c) ?? { total: 0, speedSum: 0, anomalies: 0 };
      entry.total += 1;
      entry.speedSum += pt.speed;
      if (pt.isAnomaly) entry.anomalies += 1;
      corridorMap.set(c, entry);
    }

    for (const a of this.anomalyLog) {
      const c = a.corridor || 'Urban Grid';
      const entry = corridorMap.get(c) ?? { total: 0, speedSum: 0, anomalies: 0 };
      entry.anomalies += 1;
      corridorMap.set(c, entry);
    }

    const corridorHotspots: CorridorHotspotSummary[] = Array.from(corridorMap.entries())
      .map(([corridor, stats]) => ({
        corridor,
        telemetryCount: stats.total,
        avgSpeedKmh:
          stats.total > 0 ? Number((stats.speedSum / stats.total).toFixed(1)) : 0,
        anomalyCount: stats.anomalies,
      }))
      .sort((a, b) => b.anomalyCount - a.anomalyCount || b.telemetryCount - a.telemetryCount)
      .slice(0, 8);

    const fleetMap = new Map<string, { count: number; speedSum: number }>();
    for (const a of this.anomalyLog) {
      const entry = fleetMap.get(a.fleetType) ?? { count: 0, speedSum: 0 };
      entry.count += 1;
      entry.speedSum += a.speed;
      fleetMap.set(a.fleetType, entry);
    }

    const fleetBreakdown: FleetAnomalyBreakdown[] = Array.from(fleetMap.entries())
      .map(([fleetType, stats]) => ({
        fleetType,
        anomalyCount: stats.count,
        avgAnomalySpeedKmh: Number((stats.speedSum / stats.count).toFixed(1)),
      }))
      .sort((a, b) => b.anomalyCount - a.anomalyCount);

    return {
      storageMode: 'in-memory-timeseries',
      mongoConnected: false,
      generatedAt: new Date().toISOString(),
      collections: [
        {
          name: 'telemetries',
          purpose: 'Vehicle GPS Time Series (7d TTL)',
          indexes: ['timeseries(timestamp, meta)', '2dsphere(location)', 'meta.vehicleId'],
          documents: cachedPoints,
        },
        {
          name: 'anomalies',
          purpose: 'Speed & Acceleration Audit Log (7d TTL)',
          indexes: ['timestamp(-1)', 'TTL(7d)', 'corridor', '2dsphere(location)'],
          documents: this.anomalyLog.length,
        },
        {
          name: 'roadincidents',
          purpose: 'Crowd-Sourced Hazards & Reports',
          indexes: ['2dsphere(location)', 'TTL(expiresAt)'],
          documents: memoryCounts.incidents,
        },
        {
          name: 'sharedtrips',
          purpose: 'Live Shared ETA Sessions',
          indexes: ['unique(token)', 'TTL(expiresAt)'],
          documents: memoryCounts.sharedTrips,
        },
        {
          name: 'savedplaces',
          purpose: 'Saved Home, Work & Favorite Pins',
          indexes: ['unique(placeId)', 'tag + createdAt'],
          documents: memoryCounts.savedPlaces,
        },
        {
          name: 'triphistories',
          purpose: 'Recent AI Routes & Trips',
          indexes: ['unique(tripId)', 'createdAt(-1)'],
          documents: memoryCounts.tripHistory,
        },
      ],
      corridorHotspots,
      fleetBreakdown,
    };
  }
}

export const telemetryStore = new TimeSeriesStore();
