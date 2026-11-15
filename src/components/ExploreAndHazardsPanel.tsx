import { useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Briefcase,
  Clock,
  Construction,
  ExternalLink,
  Fuel,
  HeartPulse,
  History,
  Home,
  Loader2,
  MapPin,
  Navigation,
  ParkingSquare,
  Phone,
  ShieldAlert,
  Star,
  ThumbsUp,
  TrainFront,
  Trash2,
  Utensils,
  Waves,
  Zap,
} from 'lucide-react';
import type {
  ActiveCityInfo,
  IncidentType,
  PoiCategory,
  PoiPlace,
  RoadIncident,
  SavedPlace,
  TripHistoryEntry,
} from '../types/telemetry';

interface ExploreAndHazardsPanelProps {
  activeCity: ActiveCityInfo;
  mapCenter: { lat: number; lng: number };
  pois: PoiPlace[];
  activePoiCategory: PoiCategory | null;
  poisLoading: boolean;
  incidents: RoadIncident[];
  savedPlaces: SavedPlace[];
  tripHistory: TripHistoryEntry[];
  onSearchPois: (category: PoiCategory) => void;
  onClearPois: () => void;
  onSelectPoi: (poi: PoiPlace) => void;
  onRouteToLocation: (target: {
    name: string;
    lat: number;
    lng: number;
  }) => void;
  onSavePlace: (place: {
    label: string;
    tag: 'home' | 'work' | 'favorite';
    name: string;
    lat: number;
    lng: number;
  }) => void;
  onRemoveSavedPlace: (id: string) => void;
  onClearTripHistory: () => void;
  onReportIncident: (payload: {
    type: IncidentType;
    title: string;
    description: string;
    lat: number;
    lng: number;
    corridor: string;
  }) => Promise<void>;
  onUpvoteIncident: (id: string) => Promise<void>;
  onLocateCoords: (lat: number, lng: number) => void;
}

const POI_CATEGORIES: Array<{
  id: PoiCategory;
  label: string;
  icon: typeof Fuel;
}> = [
  { id: 'charging', label: 'EV Charge', icon: Zap },
  { id: 'fuel', label: 'Fuel', icon: Fuel },
  { id: 'parking', label: 'Parking', icon: ParkingSquare },
  { id: 'transit', label: 'Transit', icon: TrainFront },
  { id: 'restaurant', label: 'Food', icon: Utensils },
  { id: 'hospital', label: 'Medical', icon: HeartPulse },
];

const INCIDENT_TYPES: Array<{
  id: IncidentType;
  label: string;
  icon: typeof AlertTriangle;
}> = [
  { id: 'accident', label: 'Accident', icon: AlertTriangle },
  { id: 'closure', label: 'Closure', icon: ShieldAlert },
  { id: 'construction', label: 'Work Zone', icon: Construction },
  { id: 'speed_trap', label: 'Speed Check', icon: Zap },
  { id: 'flooding', label: 'Flooding', icon: Waves },
  { id: 'hazard', label: 'Hazard', icon: AlertTriangle },
];

export function ExploreAndHazardsPanel({
  activeCity,
  mapCenter,
  pois,
  activePoiCategory,
  poisLoading,
  incidents,
  savedPlaces,
  tripHistory,
  onSearchPois,
  onClearPois,
  onSelectPoi,
  onRouteToLocation,
  onSavePlace,
  onRemoveSavedPlace,
  onClearTripHistory,
  onReportIncident,
  onUpvoteIncident,
  onLocateCoords,
}: ExploreAndHazardsPanelProps) {
  const [subView, setSubView] = useState<'nearby' | 'hazards' | 'saved'>(
    'nearby'
  );
  const [incidentType, setIncidentType] = useState<IncidentType>('accident');
  const [incidentNote, setIncidentNote] = useState('');
  const [reportingBusy, setReportingBusy] = useState(false);

  const handleSubmitIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportingBusy(true);
    try {
      await onReportIncident({
        type: incidentType,
        title:
          INCIDENT_TYPES.find((t) => t.id === incidentType)?.label ||
          'Road Incident',
        description:
          incidentNote.trim() || 'Reported by driver near current map sector.',
        lat: mapCenter.lat,
        lng: mapCenter.lng,
        corridor: activeCity.name,
      });
      setIncidentNote('');
    } finally {
      setReportingBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
      {/* Sub-view Switcher */}
      <div className="grid grid-cols-3 gap-1.5 bg-[#0B0F17] p-1 rounded-lg border border-white/[0.07] text-[11px]">
        <button
          type="button"
          onClick={() => setSubView('nearby')}
          className={`py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
            subView === 'nearby'
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Nearby POIs
        </button>
        <button
          type="button"
          onClick={() => setSubView('hazards')}
          className={`py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
            subView === 'hazards'
              ? 'bg-amber-500/20 text-amber-300'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Hazards ({incidents.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('saved')}
          className={`py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
            subView === 'saved'
              ? 'bg-sky-500/20 text-sky-300'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Saved ({savedPlaces.length})
        </button>
      </div>

      {/* 1. Nearby Places & Transit */}
      {subView === 'nearby' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-1.5">
            {POI_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = activePoiCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() =>
                    isActive ? onClearPois() : onSearchPois(cat.id)
                  }
                  className={`py-2 px-2 rounded-lg border text-[11px] font-medium flex flex-col items-center gap-1 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-[#121720] border-white/[0.07] text-slate-300 hover:bg-white/[0.05]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {cat.label}
                </button>
              );
            })}
          </div>

          {poisLoading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
              Searching OpenStreetMap POIs around viewport...
            </div>
          ) : pois.length === 0 ? (
            <div className="bg-[#121720] border border-white/[0.07] rounded-xl p-4 text-center text-xs text-slate-400">
              {activePoiCategory
                ? 'No matching places found within 3.5 km of this map center.'
                : 'Pick a category above to discover nearby EV chargers, fuel, parking, transit stops, or restaurants.'}
            </div>
          ) : (
            <div className="space-y-2">
              {pois.map((poi) => (
                <div
                  key={poi.id}
                  onClick={() => onSelectPoi(poi)}
                  className="bg-[#121720] border border-white/[0.08] hover:border-emerald-500/40 rounded-xl p-3 space-y-2 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {poi.name}
                      </div>
                      {poi.address && (
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {poi.address}
                        </div>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-emerald-400 shrink-0">
                      {poi.distanceMeters >= 1000
                        ? `${(poi.distanceMeters / 1000).toFixed(1)} km`
                        : `${poi.distanceMeters} m`}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {poi.operator && (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300">
                        {poi.operator}
                      </span>
                    )}
                    {poi.evConnectors && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono">
                        {poi.evConnectors}
                      </span>
                    )}
                    {poi.capacity && (
                      <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono">
                        {poi.capacity} spots
                      </span>
                    )}
                    {poi.openingHours && (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300 inline-flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {poi.openingHours}
                      </span>
                    )}
                    {poi.phone && (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300 inline-flex items-center gap-1 font-mono">
                        <Phone className="w-2.5 h-2.5" />
                        {poi.phone}
                      </span>
                    )}
                  </div>

                  {poi.nextDepartures && poi.nextDepartures.length > 0 && (
                    <div className="pt-1 border-t border-white/[0.06] flex flex-wrap gap-1">
                      {poi.nextDepartures.map((dep, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/25 text-[10px] font-mono text-sky-300"
                        >
                          {dep}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRouteToLocation({
                          name: poi.name,
                          lat: poi.lat,
                          lng: poi.lng,
                        });
                      }}
                      className="flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Navigation className="w-3 h-3" />
                      Directions
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSavePlace({
                          label: poi.name,
                          tag: 'favorite',
                          name: poi.name,
                          lat: poi.lat,
                          lng: poi.lng,
                        });
                      }}
                      title="Save place"
                      className="p-1.5 rounded-lg bg-[#0B0F17] border border-white/10 text-slate-300 hover:text-amber-300 cursor-pointer"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                    </button>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Open place in Google Maps"
                      className="p-1.5 rounded-lg bg-[#0B0F17] border border-white/10 text-sky-400 hover:text-sky-300"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. Crowd-Sourced Road Hazards */}
      {subView === 'hazards' && (
        <div className="space-y-3">
          <form
            onSubmit={(e) => void handleSubmitIncident(e)}
            className="bg-[#121720] border border-white/[0.08] rounded-xl p-3 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white">
                Report Live Road Hazard
              </h4>
              <span className="text-[10px] font-mono text-slate-400">
                @ Map Center
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {INCIDENT_TYPES.map((t) => {
                const Icon = t.icon;
                const active = incidentType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setIncidentType(t.id)}
                    className={`py-1.5 px-1.5 rounded-lg border text-[10px] font-medium flex flex-col items-center gap-1 cursor-pointer ${
                      active
                        ? 'bg-amber-500/20 border-amber-500/45 text-amber-300'
                        : 'bg-[#0B0F17] border-white/[0.07] text-slate-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>

            <input
              type="text"
              value={incidentNote}
              onChange={(e) => setIncidentNote(e.target.value)}
              placeholder="Optional note (e.g. right lane blocked)..."
              className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-white/10 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/60"
            />

            <button
              type="submit"
              disabled={reportingBusy}
              className="w-full py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors cursor-pointer"
            >
              {reportingBusy
                ? 'Broadcasting Alert...'
                : 'Broadcast Hazard to All Users'}
            </button>
          </form>

          {incidents.length === 0 ? (
            <div className="bg-[#121720] border border-white/[0.07] rounded-xl p-4 text-center text-xs text-slate-400">
              No community hazards reported right now. AI routing is clear.
            </div>
          ) : (
            <div className="space-y-2">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  onClick={() => onLocateCoords(inc.lat, inc.lng)}
                  className="bg-[#121720] border border-white/[0.08] hover:border-amber-500/40 rounded-xl p-3 flex items-start justify-between gap-2 cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25">
                        {inc.type.replace('_', ' ')}
                      </span>
                      <span className="text-xs font-semibold text-white truncate">
                        {inc.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {inc.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onUpvoteIncident(inc.id);
                    }}
                    className="px-2 py-1 rounded-lg bg-[#0B0F17] border border-white/10 text-[11px] font-mono text-emerald-400 hover:bg-emerald-500/15 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <ThumbsUp className="w-3 h-3" />
                    {inc.upvotes}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Saved Places & Recent Trip History */}
      {subView === 'saved' && (
        <div className="space-y-3.5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 text-amber-400" />
                Saved Places
              </h4>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    onSavePlace({
                      label: 'Home',
                      tag: 'home',
                      name: `${activeCity.name} Home`,
                      lat: mapCenter.lat,
                      lng: mapCenter.lng,
                    })
                  }
                  className="px-2 py-0.5 rounded bg-[#121720] border border-white/10 text-[10px] text-slate-300 hover:text-white cursor-pointer"
                >
                  + Set Home
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSavePlace({
                      label: 'Work',
                      tag: 'work',
                      name: `${activeCity.name} Work`,
                      lat: mapCenter.lat,
                      lng: mapCenter.lng,
                    })
                  }
                  className="px-2 py-0.5 rounded bg-[#121720] border border-white/10 text-[10px] text-slate-300 hover:text-white cursor-pointer"
                >
                  + Set Work
                </button>
              </div>
            </div>

            {savedPlaces.length === 0 ? (
              <div className="bg-[#121720] border border-white/[0.07] rounded-xl p-4 text-center text-xs text-slate-400">
                Click anywhere on the map or tap Save on a POI to bookmark Home,
                Work, and favorite places.
              </div>
            ) : (
              <div className="space-y-1.5">
                {savedPlaces.map((sp) => {
                  const Icon =
                    sp.tag === 'home'
                      ? Home
                      : sp.tag === 'work'
                        ? Briefcase
                        : MapPin;
                  return (
                    <div
                      key={sp.id}
                      className="bg-[#121720] border border-white/[0.08] rounded-xl p-2.5 flex items-center justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => onLocateCoords(sp.lat, sp.lng)}
                        className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
                      >
                        <Icon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">
                            {sp.label}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {sp.name}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onRouteToLocation({
                              name: sp.label,
                              lat: sp.lat,
                              lng: sp.lng,
                            })
                          }
                          className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-medium hover:bg-emerald-500/25 cursor-pointer"
                        >
                          Route
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveSavedPlace(sp.id)}
                          aria-label="Remove saved place"
                          className="p-1 text-slate-500 hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-white/[0.07]">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-sky-400" />
                Recent Trips
              </h4>
              {tripHistory.length > 0 && (
                <button
                  type="button"
                  onClick={onClearTripHistory}
                  className="text-[10px] text-slate-400 hover:text-red-400 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {tripHistory.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">
                Your generated routes and completed trips will appear here for
                offline access.
              </div>
            ) : (
              <div className="space-y-1.5">
                {tripHistory.slice(0, 8).map((trip) => (
                  <div
                    key={trip.id}
                    className="bg-[#121720] border border-white/[0.07] rounded-lg p-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-white truncate">
                        {trip.originName} → {trip.destinationName}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {trip.durationMin} min · {trip.distanceKm} km ·{' '}
                        {trip.travelMode}
                      </div>
                    </div>
                    <a
                      href={trip.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded bg-[#0B0F17] border border-white/10 text-sky-400 hover:text-sky-300 shrink-0"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
