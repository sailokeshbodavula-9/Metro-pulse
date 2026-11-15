import { useCallback, useEffect, useRef, useState } from 'react';

export type GpsStatus =
  | 'off'
  | 'locating'
  | 'active'
  | 'denied'
  | 'unavailable';

export interface LiveGpsPosition {
  lat: number;
  lng: number;
  accuracyMeters: number;
  speedKmh: number | null;
  heading: number | null;
  altitudeMeters: number | null;
  timestamp: number;
}

export function useLiveGps() {
  const watchIdRef = useRef<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('off');
  const [gpsPosition, setGpsPosition] = useState<LiveGpsPosition | null>(null);
  const [gpsFollow, setGpsFollow] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const stopGps = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setGpsStatus('off');
    setGpsFollow(false);
    setGpsError(null);
    setGpsPosition(null);
  }, []);

  const startGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('unavailable');
      setGpsError('Geolocation is not supported in this browser.');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setGpsStatus('locating');
    setGpsFollow(true);
    setGpsError(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const speedKmh =
          typeof pos.coords.speed === 'number' && Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0
            ? Number((pos.coords.speed * 3.6).toFixed(1))
            : null;
        const heading =
          typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading)
            ? Math.round(pos.coords.heading)
            : null;

        setGpsPosition({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracyMeters: Math.round(pos.coords.accuracy || 25),
          speedKmh,
          heading,
          altitudeMeters:
            typeof pos.coords.altitude === 'number'
              ? Math.round(pos.coords.altitude)
              : null,
          timestamp: pos.timestamp || Date.now(),
        });
        setGpsStatus('active');
        setGpsError(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsStatus('denied');
          setGpsError('Location permission denied. Allow location access to track live GPS.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGpsStatus('unavailable');
          setGpsError('GPS signal unavailable on this device.');
        } else {
          setGpsStatus('unavailable');
          setGpsError('Timed out acquiring GPS lock. Retrying...');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 12000,
      }
    );
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return {
    gpsStatus,
    gpsPosition,
    gpsFollow,
    setGpsFollow,
    gpsError,
    startGps,
    stopGps,
  };
}
