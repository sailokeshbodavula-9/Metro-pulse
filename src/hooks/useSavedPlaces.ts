import { useCallback, useEffect, useState } from 'react';
import type {
  AiRoutePlanResponse,
  SavedPlace,
  TripHistoryEntry,
} from '../types/telemetry';
import { apiUrl } from '../utils/api';

const SAVED_PLACES_KEY = 'metropulse:saved-places:v1';
const TRIP_HISTORY_KEY = 'metropulse:trip-history:v1';
const CACHED_PLAN_KEY = 'metropulse:cached-route-plan:v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useSavedPlaces() {
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(() =>
    readJson<SavedPlace[]>(SAVED_PLACES_KEY, [])
  );
  const [tripHistory, setTripHistory] = useState<TripHistoryEntry[]>(() =>
    readJson<TripHistoryEntry[]>(TRIP_HISTORY_KEY, [])
  );
  const [cachedRoutePlan, setCachedRoutePlan] =
    useState<AiRoutePlanResponse | null>(() =>
      readJson<AiRoutePlanResponse | null>(CACHED_PLAN_KEY, null)
    );

  // Hydrate Saved Places & Trip History from backend MongoDB / API store
  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const [placesRes, historyRes] = await Promise.all([
          fetch(apiUrl('/api/places/saved')),
          fetch(apiUrl('/api/trips/history')),
        ]);
        if (!active) return;

        if (placesRes.ok) {
          const data = (await placesRes.json()) as { places?: SavedPlace[] };
          if (Array.isArray(data.places) && data.places.length > 0) {
            setSavedPlaces(data.places);
          }
        }
        if (historyRes.ok) {
          const data = (await historyRes.json()) as {
            history?: TripHistoryEntry[];
          };
          if (Array.isArray(data.history) && data.history.length > 0) {
            setTripHistory(data.history);
          }
        }
      } catch {
        // Offline / localStorage cache fallback remains active
      }
    };
    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SAVED_PLACES_KEY,
        JSON.stringify(savedPlaces)
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [savedPlaces]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        TRIP_HISTORY_KEY,
        JSON.stringify(tripHistory)
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [tripHistory]);

  const cacheRoutePlan = useCallback((plan: AiRoutePlanResponse | null) => {
    setCachedRoutePlan(plan);
    try {
      if (plan) {
        window.localStorage.setItem(CACHED_PLAN_KEY, JSON.stringify(plan));
      } else {
        window.localStorage.removeItem(CACHED_PLAN_KEY);
      }
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const savePlace = useCallback(
    (place: {
      label: string;
      tag: 'home' | 'work' | 'favorite';
      name: string;
      lat: number;
      lng: number;
    }) => {
      const id = `sp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const next: SavedPlace = {
        id,
        label: place.label.trim() || place.name,
        tag: place.tag,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        createdAt: new Date().toISOString(),
      };

      setSavedPlaces((prev) => {
        const filtered =
          place.tag === 'home' || place.tag === 'work'
            ? prev.filter((p) => p.tag !== place.tag)
            : prev.filter(
                (p) =>
                  Math.abs(p.lat - place.lat) > 0.0002 ||
                  Math.abs(p.lng - place.lng) > 0.0002
              );
        return [next, ...filtered].slice(0, 30);
      });

      void fetch(apiUrl('/api/places/saved'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {
        // Local cache preserves data even if offline
      });
    },
    []
  );

  const removePlace = useCallback((id: string) => {
    setSavedPlaces((prev) => prev.filter((p) => p.id !== id));
    void fetch(apiUrl(`/api/places/saved/${encodeURIComponent(id)}`), {
      method: 'DELETE',
    }).catch(() => {});
  }, []);

  const recordTrip = useCallback(
    (entry: Omit<TripHistoryEntry, 'id' | 'createdAt'>) => {
      const next: TripHistoryEntry = {
        ...entry,
        id: `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
      };
      setTripHistory((prev) => [next, ...prev].slice(0, 25));

      void fetch(apiUrl('/api/trips/history'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {});
    },
    []
  );

  const clearTripHistory = useCallback(() => {
    setTripHistory([]);
    void fetch(apiUrl('/api/trips/history'), { method: 'DELETE' }).catch(() => {});
  }, []);

  return {
    savedPlaces,
    tripHistory,
    cachedRoutePlan,
    savePlace,
    removePlace,
    recordTrip,
    clearTripHistory,
    cacheRoutePlan,
  };
}
