import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Play,
  RefreshCw,
  RotateCw,
  Share2,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  AiRoutePlanResponse,
  AiRouteSuggestion,
  RoadIncident,
  RouteStep,
} from '../types/telemetry';

export interface UserNavPosition {
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
}

interface NavigationHudProps {
  plan: AiRoutePlanResponse;
  route: AiRouteSuggestion;
  incidents: RoadIncident[];
  roadSpeedLimitKmh: number;
  onUserPositionChange: (pos: UserNavPosition | null) => void;
  onReroute: (pos: { lat: number; lng: number }) => void;
  onPublishTripPosition: (payload: {
    token: string;
    currentLat: number;
    currentLng: number;
    heading: number;
    speedKmh: number;
    etaMinutes: number;
    remainingKm: number;
  }) => void;
  onExitNavigation: () => void;
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

function computeBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
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

function minDistanceToPolylineMeters(
  lat: number,
  lng: number,
  geometry: Array<[number, number]>
): number {
  let min = Infinity;
  for (const pt of geometry) {
    const d = haversineMeters(lat, lng, pt[1], pt[0]);
    if (d < min) min = d;
  }
  return min;
}

function ManeuverIcon({ step }: { step: RouteStep | undefined }) {
  if (!step) return <ArrowUp className="w-6 h-6 text-emerald-400" />;
  if (step.maneuverType === 'arrive') {
    return <Flag className="w-6 h-6 text-red-400" />;
  }
  if (
    step.maneuverType === 'roundabout' ||
    step.maneuverType === 'rotary'
  ) {
    return <RotateCw className="w-6 h-6 text-sky-400" />;
  }
  const mod = step.maneuverModifier || '';
  if (mod.includes('right')) {
    return <CornerUpRight className="w-6 h-6 text-emerald-400" />;
  }
  if (mod.includes('left')) {
    return <CornerUpLeft className="w-6 h-6 text-emerald-400" />;
  }
  return <ArrowUp className="w-6 h-6 text-emerald-400" />;
}

export function NavigationHud({
  plan,
  route,
  incidents,
  roadSpeedLimitKmh,
  onUserPositionChange,
  onReroute,
  onPublishTripPosition,
  onExitNavigation,
}: NavigationHudProps) {
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [livePos, setLivePos] = useState<UserNavPosition>({
    lat: plan.origin.lat,
    lng: plan.origin.lng,
    heading: 0,
    speedKmh: 0,
  });
  const [offRouteMeters, setOffRouteMeters] = useState(0);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);

  const spokenStepRef = useRef(-1);
  const simProgressRef = useRef(0);
  const rerouteLockRef = useRef(false);

  const speak = (text: string) => {
    if (!voiceEnabled || typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      utter.pitch = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech synthesis errors on restricted browsers
    }
  };

  // Announce navigation start & step transitions
  useEffect(() => {
    const step = route.steps[stepIdx];
    if (!step) return;
    if (spokenStepRef.current !== stepIdx) {
      spokenStepRef.current = stepIdx;
      const distLabel =
        step.distanceMeters >= 1000
          ? `for ${(step.distanceMeters / 1000).toFixed(1)} kilometers`
          : step.distanceMeters > 30
            ? `for ${step.distanceMeters} meters`
            : '';
      speak(`${step.instruction} ${distLabel}`.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, route.id, voiceEnabled]);

  // Live GPS Watch when not simulating
  useEffect(() => {
    if (simulating) return;
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const speedKmh =
          typeof pos.coords.speed === 'number' && pos.coords.speed >= 0
            ? Math.round(pos.coords.speed * 3.6)
            : 0;
        const heading =
          typeof pos.coords.heading === 'number' &&
          Number.isFinite(pos.coords.heading)
            ? Math.round(pos.coords.heading)
            : livePos.heading;

        const nextPos = { lat, lng, heading, speedKmh };
        setLivePos(nextPos);
        onUserPositionChange(nextPos);

        const dev = minDistanceToPolylineMeters(lat, lng, route.geometry);
        setOffRouteMeters(Math.round(dev));

        // Auto re-route if GPS drifts >85m off route
        if (dev > 85 && !rerouteLockRef.current) {
          rerouteLockRef.current = true;
          speak('Off route. Recalculating optimal path.');
          onReroute({ lat, lng });
          window.setTimeout(() => {
            rerouteLockRef.current = false;
          }, 12000);
        }

        // Advance step when within 40m of next maneuver
        const nextStep = route.steps[stepIdx + 1];
        if (nextStep) {
          const dNext = haversineMeters(
            lat,
            lng,
            nextStep.location[1],
            nextStep.location[0]
          );
          if (dNext < 45) {
            setStepIdx((prev) => Math.min(route.steps.length - 1, prev + 1));
          }
        }
      },
      () => {
        // Ignore GPS watch permission errors silently; user can use Simulate Drive
      },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 8000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulating, route.id, stepIdx]);

  // Simulated Drive mode for instant preview/testing along the real route geometry
  useEffect(() => {
    if (!simulating || route.geometry.length < 2) return;
    const pts = route.geometry;
    const timer = window.setInterval(() => {
      simProgressRef.current += 0.65;
      if (simProgressRef.current >= pts.length - 1) {
        simProgressRef.current = pts.length - 1;
        setSimulating(false);
        setStepIdx(Math.max(0, route.steps.length - 1));
        speak(`You have arrived at ${plan.destination.name}`);
      }
      const idx = Math.floor(simProgressRef.current);
      const frac = simProgressRef.current - idx;
      const p1 = pts[idx];
      const p2 = pts[Math.min(pts.length - 1, idx + 1)];
      const lng = p1[0] + (p2[0] - p1[0]) * frac;
      const lat = p1[1] + (p2[1] - p1[1]) * frac;
      const heading = computeBearing(p1[1], p1[0], p2[1], p2[0]);
      const baseSpd = Math.max(
        18,
        Math.round(route.estimatedAvgSpeedKmh + (Math.sin(idx) * 6))
      );
      const nextPos = {
        lat,
        lng,
        heading,
        speedKmh: simProgressRef.current >= pts.length - 1 ? 0 : baseSpd,
      };
      setLivePos(nextPos);
      onUserPositionChange(nextPos);
      setOffRouteMeters(0);

      // Map polyline progress onto maneuver steps
      const ratio = simProgressRef.current / Math.max(1, pts.length - 1);
      const mappedStep = Math.min(
        Math.max(0, route.steps.length - 1),
        Math.floor(ratio * route.steps.length)
      );
      setStepIdx(mappedStep);
    }, 650);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulating, route.id]);

  // Cleanup user navigation puck & speech when exiting
  useEffect(() => {
    return () => {
      onUserPositionChange(null);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remainingKm = useMemo(() => {
    const meters = haversineMeters(
      livePos.lat,
      livePos.lng,
      plan.destination.lat,
      plan.destination.lng
    );
    return Number(Math.max(0.1, (meters / 1000) * 1.15).toFixed(1));
  }, [livePos.lat, livePos.lng, plan.destination.lat, plan.destination.lng]);

  const etaMinutes = useMemo(() => {
    const avg = Math.max(15, route.estimatedAvgSpeedKmh);
    return Math.max(1, Math.round((remainingKm / avg) * 60));
  }, [remainingKm, route.estimatedAvgSpeedKmh]);

  const nearbyHazard = useMemo(() => {
    for (const inc of incidents) {
      const dist = haversineMeters(livePos.lat, livePos.lng, inc.lat, inc.lng);
      if (dist < 650) return { incident: inc, distMeters: Math.round(dist) };
    }
    return null;
  }, [incidents, livePos.lat, livePos.lng]);

  // Broadcast live position to shared trip Socket.IO room when sharing is active
  useEffect(() => {
    if (!shareToken) return;
    onPublishTripPosition({
      token: shareToken,
      currentLat: livePos.lat,
      currentLng: livePos.lng,
      heading: livePos.heading,
      speedKmh: livePos.speedKmh,
      etaMinutes,
      remainingKm,
    });
  }, [
    shareToken,
    livePos.lat,
    livePos.lng,
    livePos.heading,
    livePos.speedKmh,
    etaMinutes,
    remainingKm,
    onPublishTripPosition,
  ]);

  const handleShareLiveEta = async () => {
    if (shareToken) {
      const shareUrl = `${window.location.origin}/?trip=${shareToken}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2200);
      } catch {
        // Ignore clipboard denial
      }
      return;
    }

    setSharingBusy(true);
    try {
      const res = await fetch('/api/trips/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeTitle: route.title,
          originName: plan.origin.name,
          destinationName: plan.destination.name,
          destinationLat: plan.destination.lat,
          destinationLng: plan.destination.lng,
          currentLat: livePos.lat,
          currentLng: livePos.lng,
          heading: livePos.heading,
          speedKmh: livePos.speedKmh,
          etaMinutes,
          remainingKm,
          geometry: route.geometry,
        }),
      });
      const data = await res.json();
      if (res.ok && data?.session?.token) {
        const tok = data.session.token as string;
        setShareToken(tok);
        const shareUrl = `${window.location.origin}/?trip=${tok}`;
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2500);
      }
    } finally {
      setSharingBusy(false);
    }
  };

  const currentStep = route.steps[stepIdx] ?? route.steps[0];
  const nextStep = route.steps[stepIdx + 1];
  const isSpeeding = livePos.speedKmh > roadSpeedLimitKmh;

  const arrivalTimeStr = useMemo(() => {
    const dt = new Date(Date.now() + etaMinutes * 60 * 1000);
    return dt.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }, [etaMinutes]);

  return (
    <>
      {/* Top Turn-by-Turn Maneuver Banner */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-md z-20 space-y-1.5 pointer-events-auto">
        <div className="bg-[#0F151E]/95 backdrop-blur-md border border-emerald-500/40 rounded-xl p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-lg bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center shrink-0">
                <ManeuverIcon step={currentStep} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-mono text-emerald-400">
                  {currentStep?.distanceMeters
                    ? currentStep.distanceMeters >= 1000
                      ? `${(currentStep.distanceMeters / 1000).toFixed(1)} km`
                      : `${currentStep.distanceMeters} m`
                    : 'Arriving'}{' '}
                  · Step {stepIdx + 1}/{Math.max(1, route.steps.length)}
                </div>
                <div className="text-sm font-semibold text-white truncate">
                  {currentStep?.instruction || `Head toward ${plan.destination.name}`}
                </div>
                {nextStep && (
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">
                    Then: {nextStep.instruction}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setStepsExpanded((s) => !s)}
                title="View all turn steps"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                {stepsExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setVoiceEnabled((v) => !v)}
                title={voiceEnabled ? 'Mute voice guidance' : 'Enable voice guidance'}
                className={`p-1.5 rounded-lg cursor-pointer ${
                  voiceEnabled
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                {voiceEnabled ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {nearbyHazard && (
            <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/35 text-[11px] text-amber-200 flex items-center justify-between">
              <span>
                Hazard ahead ({nearbyHazard.distMeters} m):{' '}
                <strong>{nearbyHazard.incident.title}</strong>
              </span>
            </div>
          )}

          {offRouteMeters > 70 && (
            <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-red-500/15 border border-red-500/35 text-[11px] text-red-200 flex items-center justify-between gap-2">
              <span>Off route by {offRouteMeters} m</span>
              <button
                type="button"
                onClick={() => onReroute({ lat: livePos.lat, lng: livePos.lng })}
                className="px-2 py-0.5 rounded bg-red-500 text-white font-medium cursor-pointer"
              >
                Recalculate
              </button>
            </div>
          )}
        </div>

        {stepsExpanded && (
          <div className="bg-[#0F151E]/95 backdrop-blur-md border border-white/10 rounded-xl max-h-52 overflow-y-auto divide-y divide-white/[0.06] shadow-2xl">
            {route.steps.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setStepIdx(idx)}
                className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 text-xs hover:bg-white/[0.05] cursor-pointer ${
                  idx === stepIdx ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-200'
                }`}
              >
                <span className="truncate">
                  {idx + 1}. {s.instruction}
                </span>
                <span className="font-mono text-[11px] text-slate-400 shrink-0">
                  {s.distanceMeters >= 1000
                    ? `${(s.distanceMeters / 1000).toFixed(1)} km`
                    : `${s.distanceMeters} m`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Live Speedometer, ETA & Navigation Actions */}
      <div className="absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2.5 bg-[#0F151E]/95 backdrop-blur-md border border-white/12 rounded-xl px-3 py-2 shadow-2xl">
          {/* Speed vs Road Limit */}
          <div className="flex items-center gap-2 pr-2.5 border-r border-white/10">
            <div
              className={`text-center px-2 py-1 rounded-lg border ${
                isSpeeding
                  ? 'bg-red-500/20 border-red-500/50 text-red-300'
                  : 'bg-[#151C28] border-white/10 text-white'
              }`}
            >
              <div className="text-base font-bold font-mono leading-none">
                {livePos.speedKmh}
              </div>
              <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                km/h
              </div>
            </div>
            <div className="w-8 h-8 rounded-full border-2 border-red-500 bg-white text-slate-950 flex flex-col items-center justify-center shrink-0">
              <span className="text-[10px] font-bold font-mono leading-none">
                {roadSpeedLimitKmh}
              </span>
            </div>
          </div>

          {/* Remaining ETA & Distance */}
          <div className="text-xs">
            <div className="font-mono font-bold text-emerald-400">
              {etaMinutes} min · {arrivalTimeStr} ETA
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {remainingKm} km to {plan.destination.name}
            </div>
          </div>
        </div>

        {/* Navigation Control Buttons */}
        <div className="pointer-events-auto flex items-center gap-1.5 bg-[#0F151E]/95 backdrop-blur-md border border-white/12 rounded-xl p-1.5 shadow-2xl">
          <button
            type="button"
            onClick={() => {
              if (!simulating) {
                simProgressRef.current = 0;
                setStepIdx(0);
              }
              setSimulating((s) => !s);
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
              simulating
                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                : 'bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25'
            }`}
          >
            {simulating ? (
              <>
                <Square className="w-3 h-3" />
                Stop Sim
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                Simulate Drive
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => onReroute({ lat: livePos.lat, lng: livePos.lng })}
            title="Recalculate route from current position"
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => void handleShareLiveEta()}
            disabled={sharingBusy}
            title="Share live ETA & position link"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-sky-500/15 border border-sky-500/35 text-sky-300 hover:bg-sky-500/25 cursor-pointer"
          >
            {shareCopied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                Link Copied
              </>
            ) : (
              <>
                <Share2 className="w-3 h-3" />
                Share ETA
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onExitNavigation}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 cursor-pointer"
          >
            <X className="w-3 h-3" />
            End
          </button>
        </div>
      </div>
    </>
  );
}
