import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  ActiveCityInfo,
  AiRoutePlanResponse,
  AiRouteSuggestion,
  AnomalyRecord,
  RoadIncident,
  RouteLocationEndpoint,
  RoutePriority,
  RouteStep,
  RouteSuggestionWaypoint,
  TelemetryPoint,
  TravelMode,
} from '../types.ts';

export interface RouteStopInput {
  query: string;
  coords?: { lat: number; lng: number; label?: string } | null;
}

export interface RouteSuggestionInput {
  originQuery: string;
  destinationQuery: string;
  originCoords?: { lat: number; lng: number; label?: string } | null;
  destinationCoords?: { lat: number; lng: number; label?: string } | null;
  stops?: RouteStopInput[];
  travelMode: TravelMode;
  priority: RoutePriority;
  userNotes?: string;
  activeCity: ActiveCityInfo;
  vehicles: TelemetryPoint[];
  recentAnomalies: AnomalyRecord[];
  activeIncidents: RoadIncident[];
  speedLimitKmh: number;
}

interface OsrmAlternative {
  distanceKm: number;
  durationMin: number;
  geometry: Array<[number, number]>;
  roadNames: string[];
  steps: RouteStep[];
  viaPoints: Array<{ lat: number; lng: number }>;
}

function getGenAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add a valid key in Settings > Secrets to generate AI route suggestions.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function buildGoogleMapsDirectionsUrl(params: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  waypoints?: Array<{ lat: number; lng: number }>;
  travelMode: TravelMode;
}): string {
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set(
    'origin',
    `${params.origin.lat.toFixed(6)},${params.origin.lng.toFixed(6)}`
  );
  url.searchParams.set(
    'destination',
    `${params.destination.lat.toFixed(6)},${params.destination.lng.toFixed(6)}`
  );
  url.searchParams.set('travelmode', params.travelMode);

  if (params.waypoints && params.waypoints.length > 0) {
    const wpString = params.waypoints
      .slice(0, 6)
      .map((w) => `${w.lat.toFixed(6)},${w.lng.toFixed(6)}`)
      .join('|');
    url.searchParams.set('waypoints', wpString);
  }

  return url.toString();
}

function parseCoordString(text: string): { lat: number; lng: number } | null {
  const match = text
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -85 &&
    lat <= 85 &&
    lng >= -180 &&
    lng <= 180
  ) {
    return { lat, lng };
  }
  return null;
}

async function resolveEndpoint(
  query: string,
  explicitCoords: { lat: number; lng: number; label?: string } | null | undefined,
  activeCity: ActiveCityInfo,
  vehicles: TelemetryPoint[]
): Promise<RouteLocationEndpoint> {
  if (
    explicitCoords &&
    Number.isFinite(explicitCoords.lat) &&
    Number.isFinite(explicitCoords.lng)
  ) {
    const label =
      explicitCoords.label?.trim() ||
      query.trim() ||
      `${explicitCoords.lat.toFixed(4)}, ${explicitCoords.lng.toFixed(4)}`;
    return {
      name: label,
      displayName: label,
      lat: explicitCoords.lat,
      lng: explicitCoords.lng,
    };
  }

  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Origin and destination are both required.');
  }

  const matchedVehicle = vehicles.find(
    (v) => v.meta.vehicleId.toLowerCase() === trimmed.toLowerCase()
  );
  if (matchedVehicle) {
    return {
      name: `${matchedVehicle.meta.vehicleId} (${matchedVehicle.meta.corridor})`,
      displayName: `Live unit ${matchedVehicle.meta.vehicleId} on ${matchedVehicle.meta.corridor}`,
      lat: matchedVehicle.location.coordinates[1],
      lng: matchedVehicle.location.coordinates[0],
    };
  }

  const parsedCoords = parseCoordString(trimmed);
  if (parsedCoords) {
    return {
      name: `${parsedCoords.lat.toFixed(4)}, ${parsedCoords.lng.toFixed(4)}`,
      displayName: `Coordinates ${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lng.toFixed(5)}`,
      lat: parsedCoords.lat,
      lng: parsedCoords.lng,
    };
  }

  const viewbox = [
    activeCity.lng - 0.35,
    activeCity.lat + 0.35,
    activeCity.lng + 0.35,
    activeCity.lat - 0.35,
  ].join(',');

  const attemptUrls = [
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&viewbox=${viewbox}&bounded=1&q=${encodeURIComponent(trimmed)}`,
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(`${trimmed}, ${activeCity.name}`)}`,
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(trimmed)}`,
  ];

  for (const url of attemptUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'MetroPulseTelemetry/1.0',
          'Accept-Language': 'en',
        },
      });
      if (!res.ok) continue;
      const items = (await res.json()) as Array<{
        name?: string;
        display_name: string;
        lat: string;
        lon: string;
      }>;
      if (Array.isArray(items) && items.length > 0) {
        const hit = items[0];
        return {
          name: hit.name || hit.display_name.split(',')[0].trim(),
          displayName: hit.display_name,
          lat: Number(hit.lat),
          lng: Number(hit.lon),
        };
      }
    } catch {
      // Try next geocoding fallback
    }
  }

  throw new Error(
    `Could not locate "${trimmed}". Try a more specific street, landmark, city name, or lat,lng coordinates.`
  );
}

function formatOsrmInstruction(
  type: string | undefined,
  modifier: string | undefined,
  roadName: string
): string {
  const road = roadName ? ` onto ${roadName}` : '';
  const mod = modifier ? modifier.replace(/_/g, ' ') : '';
  switch (type) {
    case 'depart':
      return roadName ? `Head out on ${roadName}` : 'Start route';
    case 'arrive':
      return 'Arrive at destination';
    case 'roundabout':
    case 'rotary':
      return `Enter roundabout and exit${road}`;
    case 'fork':
      return `Keep ${mod || 'straight'}${road}`;
    case 'merge':
      return `Merge ${mod || 'in'}${road}`;
    case 'on ramp':
      return `Take ramp${road}`;
    case 'off ramp':
      return `Take exit${road}`;
    case 'continue':
      return roadName ? `Continue on ${roadName}` : 'Continue straight';
    case 'turn':
    case 'end of road':
      return `Turn ${mod || 'ahead'}${road}`;
    default:
      return mod ? `${mod.charAt(0).toUpperCase() + mod.slice(1)}${road}` : roadName ? `Proceed on ${roadName}` : 'Continue ahead';
  }
}

async function fetchOsrmAlternatives(
  points: RouteLocationEndpoint[],
  travelMode: TravelMode
): Promise<OsrmAlternative[]> {
  const profile =
    travelMode === 'walking'
      ? 'foot'
      : travelMode === 'bicycling'
        ? 'bike'
        : 'driving';

  const coordList = points.map((p) => `${p.lng},${p.lat}`).join(';');
  // OSRM disables alternatives when >2 waypoints are requested, so enable only for 2 endpoints
  const allowAlternatives = points.length === 2 ? 'true' : 'false';
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coordList}?alternatives=${allowAlternatives}&overview=full&geometries=geojson&steps=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MetroPulseTelemetry/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry?: { coordinates?: Array<[number, number]> };
        legs?: Array<{
          steps?: Array<{
            name?: string;
            distance?: number;
            duration?: number;
            maneuver?: {
              type?: string;
              modifier?: string;
              location?: [number, number];
            };
          }>;
        }>;
      }>;
    };

    if (data.code !== 'Ok' || !Array.isArray(data.routes)) return [];

    return data.routes.slice(0, 3).map((route) => {
      const coords = route.geometry?.coordinates ?? points.map((p) => [p.lng, p.lat] as [number, number]);

      const stepStride = Math.max(1, Math.floor(coords.length / 150));
      const sampled = coords.filter(
        (_, i) => i % stepStride === 0 || i === coords.length - 1
      );

      const roadTotals = new Map<string, number>();
      const steps: RouteStep[] = [];

      for (const leg of route.legs ?? []) {
        for (const s of leg.steps ?? []) {
          const roadName = s.name?.trim() || '';
          if (roadName && roadName.length > 1) {
            roadTotals.set(roadName, (roadTotals.get(roadName) ?? 0) + (s.distance ?? 0));
          }
          const mType = s.maneuver?.type ?? 'turn';
          const mMod = s.maneuver?.modifier;
          const mLoc = s.maneuver?.location ?? [points[0].lng, points[0].lat];
          if ((s.distance ?? 0) > 15 || mType === 'depart' || mType === 'arrive') {
            steps.push({
              instruction: formatOsrmInstruction(mType, mMod, roadName),
              roadName: roadName || 'Local road',
              distanceMeters: Math.round(s.distance ?? 0),
              durationSec: Math.round(s.duration ?? 0),
              maneuverType: mType,
              maneuverModifier: mMod,
              location: mLoc,
            });
          }
        }
      }

      const roadNames = Array.from(roadTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);

      const viaPoints: Array<{ lat: number; lng: number }> = [];
      if (points.length > 2) {
        for (const stop of points.slice(1, -1)) {
          viaPoints.push({ lat: stop.lat, lng: stop.lng });
        }
      } else if (sampled.length >= 6) {
        const p1 = sampled[Math.floor(sampled.length * 0.35)];
        const p2 = sampled[Math.floor(sampled.length * 0.68)];
        viaPoints.push({ lng: p1[0], lat: p1[1] });
        viaPoints.push({ lng: p2[0], lat: p2[1] });
      } else if (sampled.length >= 3) {
        const mid = sampled[Math.floor(sampled.length / 2)];
        viaPoints.push({ lng: mid[0], lat: mid[1] });
      }

      const rawDistKm = Math.max(0.2, route.distance / 1000);
      const rawDurMin =
        travelMode === 'transit'
          ? Math.max(2, (route.duration / 60) * 1.28)
          : Math.max(1, route.duration / 60);

      return {
        distanceKm: Number(rawDistKm.toFixed(1)),
        durationMin: Math.round(rawDurMin),
        geometry: sampled,
        roadNames,
        steps: steps.slice(0, 40),
        viaPoints,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function buildCurvedFallbackGeometry(
  origin: RouteLocationEndpoint,
  stops: RouteLocationEndpoint[],
  destination: RouteLocationEndpoint,
  offsetFactor: number
): Array<[number, number]> {
  const allPts = [origin, ...stops, destination];
  if (allPts.length > 2) {
    return allPts.map((p) => [p.lng, p.lat]);
  }
  const midLng = (origin.lng + destination.lng) / 2;
  const midLat = (origin.lat + destination.lat) / 2;
  const dx = destination.lng - origin.lng;
  const dy = destination.lat - origin.lat;
  const ctrlLng = midLng - dy * offsetFactor;
  const ctrlLat = midLat + dx * offsetFactor;

  const pts: Array<[number, number]> = [];
  const steps = 20;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const inv = 1 - t;
    const lng =
      inv * inv * origin.lng + 2 * inv * t * ctrlLng + t * t * destination.lng;
    const lat =
      inv * inv * origin.lat + 2 * inv * t * ctrlLat + t * t * destination.lat;
    pts.push([Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
  }
  return pts;
}

function summarizeCorridorTelemetry(
  vehicles: TelemetryPoint[],
  recentAnomalies: AnomalyRecord[],
  activeIncidents: RoadIncident[]
) {
  const corridorMap = new Map<
    string,
    { count: number; speedSum: number; anomalies: number; delayed: number }
  >();

  for (const v of vehicles) {
    const entry = corridorMap.get(v.meta.corridor) ?? {
      count: 0,
      speedSum: 0,
      anomalies: 0,
      delayed: 0,
    };
    entry.count += 1;
    entry.speedSum += v.speed;
    if (v.isAnomaly) entry.anomalies += 1;
    else if (v.speed < 22) entry.delayed += 1;
    corridorMap.set(v.meta.corridor, entry);
  }

  const corridors = Array.from(corridorMap.entries())
    .map(([name, stats]) => ({
      name,
      vehicles: stats.count,
      avgSpeedKmh: Number((stats.speedSum / stats.count).toFixed(1)),
      anomalies: stats.anomalies,
      delayed: stats.delayed,
    }))
    .sort((a, b) => b.anomalies - a.anomalies || a.avgSpeedKmh - b.avgSpeedKmh);

  const hotspotCorridors = corridors
    .filter((c) => c.anomalies > 0 || c.delayed > 1)
    .slice(0, 6);

  const clearCorridors = corridors
    .filter((c) => c.anomalies === 0 && c.avgSpeedKmh >= 30)
    .slice(0, 6);

  const latestAlerts = recentAnomalies.slice(0, 6).map((a) => ({
    corridor: a.corridor,
    reason: a.reason,
    speed: a.speed,
  }));

  const communityIncidents = activeIncidents.slice(0, 8).map((inc) => ({
    type: inc.type,
    title: inc.title,
    corridor: inc.corridor,
    lat: inc.lat,
    lng: inc.lng,
    upvotes: inc.upvotes,
  }));

  return { hotspotCorridors, clearCorridors, latestAlerts, communityIncidents };
}

export async function generateAiRouteSuggestions(
  input: RouteSuggestionInput
): Promise<AiRoutePlanResponse> {
  const ai = getGenAiClient();

  const stopPromises = (input.stops ?? [])
    .filter((s) => s.query.trim().length > 0 || s.coords)
    .slice(0, 4)
    .map((s) =>
      resolveEndpoint(s.query, s.coords, input.activeCity, input.vehicles)
    );

  const [origin, destination, ...stops] = await Promise.all([
    resolveEndpoint(
      input.originQuery,
      input.originCoords,
      input.activeCity,
      input.vehicles
    ),
    resolveEndpoint(
      input.destinationQuery,
      input.destinationCoords,
      input.activeCity,
      input.vehicles
    ),
    ...stopPromises,
  ]);

  const directKm = Math.max(
    0.4,
    haversineKm(origin.lat, origin.lng, destination.lat, destination.lng)
  );

  const orderedEndpoints = [origin, ...stops, destination];
  const osrmAlternatives = await fetchOsrmAlternatives(
    orderedEndpoints,
    input.travelMode
  );

  const telemetryContext = summarizeCorridorTelemetry(
    input.vehicles,
    input.recentAnomalies,
    input.activeIncidents
  );

  const promptPayload = {
    origin: {
      name: origin.name,
      displayName: origin.displayName,
      lat: origin.lat,
      lng: origin.lng,
    },
    stops: stops.map((s) => ({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
    })),
    destination: {
      name: destination.name,
      displayName: destination.displayName,
      lat: destination.lat,
      lng: destination.lng,
    },
    travelMode: input.travelMode,
    userPriority: input.priority,
    userNotes: input.userNotes?.trim() || 'None',
    straightLineDistanceKm: Number(directKm.toFixed(1)),
    osrmRoadAlternatives: osrmAlternatives.map((alt, idx) => ({
      alternativeIndex: idx,
      distanceKm: alt.distanceKm,
      durationMin: alt.durationMin,
      majorRoads: alt.roadNames,
      midRouteCoords: alt.viaPoints,
    })),
    liveFleetTelemetry: {
      activeCity: input.activeCity.name,
      speedLimitKmh: input.speedLimitKmh,
      hotspotCorridors: telemetryContext.hotspotCorridors,
      clearCorridors: telemetryContext.clearCorridors,
      latestAlerts: telemetryContext.latestAlerts,
      communityIncidents: telemetryContext.communityIncidents,
    },
  };

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents:
      `Generate 3 practical, distinct route suggestions for the trip described below. ` +
      `When osrmRoadAlternatives are provided, map each suggestion to an alternativeIndex (0, 1, or 2 if available, or 0) ` +
      `and reference its real majorRoads and distance/duration. Factor in liveFleetTelemetry hotspots, clearCorridors, and ` +
      `any communityIncidents (accidents/closures/flooding) so users avoid hazards. ` +
      `If stops are present, include all stops in order. Provide realistic intermediate waypoint coordinates strictly between origin and destination.\n\n` +
      JSON.stringify(promptPayload),
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction:
        'You are MetroPulse AI Route Advisor, a consumer and fleet navigation intelligence engine. ' +
        'Produce concise, actionable route options tailored to travel mode, user priority, multi-stop waypoints, and live road hazards. ' +
        'Return strictly valid JSON matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          trafficBrief: {
            type: Type.STRING,
            description:
              '1-2 sentence executive traffic, hazard, and corridor summary for this trip.',
          },
          routes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                strategy: {
                  type: Type.STRING,
                  description: 'One of: recommended, fastest, avoid_anomalies, eco.',
                },
                alternativeIndex: { type: Type.INTEGER },
                summary: { type: Type.STRING },
                distanceKm: { type: Type.NUMBER },
                durationMin: { type: Type.INTEGER },
                estimatedAvgSpeedKmh: { type: Type.NUMBER },
                riskLevel: {
                  type: Type.STRING,
                  description: 'One of: low, moderate, elevated.',
                },
                avoidedHotspots: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                corridorsUsed: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                turnHints: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                waypoints: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      lat: { type: Type.NUMBER },
                      lng: { type: Type.NUMBER },
                      note: { type: Type.STRING },
                    },
                    required: ['name', 'lat', 'lng', 'note'],
                  },
                },
              },
              required: [
                'title',
                'strategy',
                'summary',
                'distanceKm',
                'durationMin',
                'estimatedAvgSpeedKmh',
                'riskLevel',
                'corridorsUsed',
                'turnHints',
                'waypoints',
              ],
            },
          },
        },
        required: ['trafficBrief', 'routes'],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as {
    trafficBrief?: string;
    routes?: Array<{
      title?: string;
      strategy?: string;
      alternativeIndex?: number;
      summary?: string;
      distanceKm?: number;
      durationMin?: number;
      estimatedAvgSpeedKmh?: number;
      riskLevel?: string;
      avoidedHotspots?: string[];
      corridorsUsed?: string[];
      turnHints?: string[];
      waypoints?: Array<{
        name?: string;
        lat?: number;
        lng?: number;
        note?: string;
      }>;
    }>;
  };

  const validStrategies = new Set<RoutePriority>([
    'recommended',
    'fastest',
    'avoid_anomalies',
    'eco',
  ]);
  const validRisks = new Set(['low', 'moderate', 'elevated']);

  const aiRoutes = Array.isArray(parsed.routes) ? parsed.routes.slice(0, 3) : [];
  if (aiRoutes.length === 0) {
    throw new Error('AI Route Advisor could not generate route options. Please try again.');
  }

  const fallbackOffsets = [0, 0.14, -0.14];

  const routes: AiRouteSuggestion[] = aiRoutes.map((r, idx) => {
    const altIdx =
      typeof r.alternativeIndex === 'number' &&
      osrmAlternatives[r.alternativeIndex]
        ? r.alternativeIndex
        : osrmAlternatives[idx]
          ? idx
          : 0;
    const matchedAlt = osrmAlternatives[altIdx];

    const distanceKm = matchedAlt
      ? matchedAlt.distanceKm
      : Number(
          Math.max(0.5, Number(r.distanceKm) || directKm * 1.18).toFixed(1)
        );

    const durationMin = matchedAlt
      ? matchedAlt.durationMin
      : Math.max(
          2,
          Math.round(Number(r.durationMin) || (distanceKm / 34) * 60)
        );

    const estimatedAvgSpeedKmh = Number(
      (
        Number(r.estimatedAvgSpeedKmh) ||
        Math.min(110, Math.max(4, (distanceKm / Math.max(1, durationMin)) * 60))
      ).toFixed(1)
    );

    const geometry = matchedAlt
      ? matchedAlt.geometry
      : buildCurvedFallbackGeometry(
          origin,
          stops,
          destination,
          fallbackOffsets[idx % fallbackOffsets.length]
        );

    const sanitizedWaypoints: RouteSuggestionWaypoint[] = (r.waypoints ?? [])
      .filter(
        (w) =>
          typeof w.lat === 'number' &&
          typeof w.lng === 'number' &&
          Number.isFinite(w.lat) &&
          Number.isFinite(w.lng) &&
          haversineKm(origin.lat, origin.lng, w.lat, w.lng) <=
            Math.max(50, directKm * 2.0)
      )
      .slice(0, 4)
      .map((w) => ({
        name: w.name?.trim() || 'Route Waypoint',
        lat: Number(w.lat),
        lng: Number(w.lng),
        note: w.note?.trim() || 'Recommended corridor checkpoint',
      }));

    const googleViaPoints =
      stops.length > 0
        ? stops.map((s) => ({ lat: s.lat, lng: s.lng }))
        : matchedAlt && matchedAlt.viaPoints.length > 0
          ? matchedAlt.viaPoints
          : sanitizedWaypoints.map((w) => ({ lat: w.lat, lng: w.lng }));

    const strategy = validStrategies.has(r.strategy as RoutePriority)
      ? (r.strategy as RoutePriority)
      : idx === 0
        ? 'recommended'
        : idx === 1
          ? 'fastest'
          : 'avoid_anomalies';

    const riskLevel = validRisks.has(r.riskLevel ?? '')
      ? (r.riskLevel as 'low' | 'moderate' | 'elevated')
      : 'low';

    const fallbackSteps: RouteStep[] = [
      {
        instruction: `Depart ${origin.name}`,
        roadName: r.corridorsUsed?.[0] || 'Origin street',
        distanceMeters: Math.round((distanceKm * 1000) / 2),
        durationSec: Math.round((durationMin * 60) / 2),
        maneuverType: 'depart',
        location: [origin.lng, origin.lat],
      },
      {
        instruction: `Arrive at ${destination.name}`,
        roadName: destination.name,
        distanceMeters: 0,
        durationSec: 0,
        maneuverType: 'arrive',
        location: [destination.lng, destination.lat],
      },
    ];

    return {
      id: `route-${idx + 1}-${Date.now()}`,
      title: r.title?.trim() || `Route Option ${idx + 1}`,
      strategy,
      summary:
        r.summary?.trim() ||
        'Balanced corridor path aligned with live telemetry speeds.',
      distanceKm,
      durationMin,
      estimatedAvgSpeedKmh,
      riskLevel,
      avoidedHotspots: Array.isArray(r.avoidedHotspots)
        ? r.avoidedHotspots.slice(0, 3)
        : [],
      corridorsUsed:
        matchedAlt && matchedAlt.roadNames.length > 0
          ? matchedAlt.roadNames
          : Array.isArray(r.corridorsUsed)
            ? r.corridorsUsed.slice(0, 4)
            : [],
      turnHints: Array.isArray(r.turnHints) ? r.turnHints.slice(0, 4) : [],
      steps:
        matchedAlt && matchedAlt.steps.length > 0
          ? matchedAlt.steps
          : fallbackSteps,
      waypoints:
        stops.length > 0
          ? stops.map((s) => ({
              name: s.name,
              lat: s.lat,
              lng: s.lng,
              note: 'Planned intermediate stop',
            }))
          : sanitizedWaypoints.length > 0
            ? sanitizedWaypoints
            : googleViaPoints.map((vp, wpIdx) => ({
                name: `Checkpoint ${wpIdx + 1}`,
                lat: vp.lat,
                lng: vp.lng,
                note: 'Road-snapped route via point',
              })),
      geometry,
      googleMapsUrl: buildGoogleMapsDirectionsUrl({
        origin,
        destination,
        waypoints: googleViaPoints,
        travelMode: input.travelMode,
      }),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    origin,
    destination,
    stops,
    travelMode: input.travelMode,
    trafficBrief:
      parsed.trafficBrief?.trim() ||
      `Generated ${routes.length} routes from ${origin.name} to ${destination.name}.`,
    routes,
    googleMapsOverviewUrl: buildGoogleMapsDirectionsUrl({
      origin,
      destination,
      waypoints: stops.map((s) => ({ lat: s.lat, lng: s.lng })),
      travelMode: input.travelMode,
    }),
  };
}
