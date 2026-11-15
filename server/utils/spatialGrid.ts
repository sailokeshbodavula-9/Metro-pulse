import type { BoundingBox } from '../types.ts';

export const TILE_SIZE_DEG = 0.025;
export const MAX_TILES_PER_CLIENT = 120;
export const OVERVIEW_ROOM = 'viewport:overview';

export function isValidBbox(bbox: unknown): bbox is BoundingBox {
  if (!bbox || typeof bbox !== 'object') return false;
  const candidate = bbox as Record<string, unknown>;
  const { north, south, east, west } = candidate;

  if (
    typeof north !== 'number' ||
    typeof south !== 'number' ||
    typeof east !== 'number' ||
    typeof west !== 'number'
  ) {
    return false;
  }

  if (
    Number.isNaN(north) ||
    Number.isNaN(south) ||
    Number.isNaN(east) ||
    Number.isNaN(west)
  ) {
    return false;
  }

  if (south < -90 || north > 90 || south >= north) return false;
  if (west < -180 || east > 180) return false;

  return true;
}

export function getTileRoomForPoint(lat: number, lng: number): string {
  const latIdx = Math.floor(lat / TILE_SIZE_DEG);
  const lngIdx = Math.floor(lng / TILE_SIZE_DEG);
  return `tile:${latIdx}:${lngIdx}`;
}

export function getIntersectingTileRooms(bbox: BoundingBox): Set<string> {
  const minLatIdx = Math.floor(bbox.south / TILE_SIZE_DEG);
  const maxLatIdx = Math.floor(bbox.north / TILE_SIZE_DEG);
  const minLngIdx = Math.floor(bbox.west / TILE_SIZE_DEG);
  const maxLngIdx = Math.floor(bbox.east / TILE_SIZE_DEG);

  const latSpan = maxLatIdx - minLatIdx + 1;
  const lngSpan =
    maxLngIdx >= minLngIdx
      ? maxLngIdx - minLngIdx + 1
      : Math.floor(360 / TILE_SIZE_DEG) - minLngIdx + maxLngIdx + 1;

  if (latSpan * lngSpan > MAX_TILES_PER_CLIENT) {
    return new Set([OVERVIEW_ROOM]);
  }

  const rooms = new Set<string>();
  for (let latIdx = minLatIdx; latIdx <= maxLatIdx; latIdx++) {
    if (maxLngIdx >= minLngIdx) {
      for (let lngIdx = minLngIdx; lngIdx <= maxLngIdx; lngIdx++) {
        rooms.add(`tile:${latIdx}:${lngIdx}`);
      }
    } else {
      const maxWrap = Math.floor(180 / TILE_SIZE_DEG);
      const minWrap = Math.floor(-180 / TILE_SIZE_DEG);
      for (let lngIdx = minLngIdx; lngIdx <= maxWrap; lngIdx++) {
        rooms.add(`tile:${latIdx}:${lngIdx}`);
      }
      for (let lngIdx = minWrap; lngIdx <= maxLngIdx; lngIdx++) {
        rooms.add(`tile:${latIdx}:${lngIdx}`);
      }
    }
  }

  return rooms;
}

export function isPointInBbox(
  lat: number,
  lng: number,
  bbox: BoundingBox
): boolean {
  if (lat < bbox.south || lat > bbox.north) return false;
  if (bbox.east >= bbox.west) {
    return lng >= bbox.west && lng <= bbox.east;
  }
  return lng >= bbox.west || lng <= bbox.east;
}

export function tileRoomToBounds(roomId: string): BoundingBox | null {
  if (!roomId.startsWith('tile:')) return null;
  const parts = roomId.split(':');
  if (parts.length !== 3) return null;
  const latIdx = Number(parts[1]);
  const lngIdx = Number(parts[2]);
  if (Number.isNaN(latIdx) || Number.isNaN(lngIdx)) return null;

  const south = latIdx * TILE_SIZE_DEG;
  const west = lngIdx * TILE_SIZE_DEG;
  return {
    south,
    north: south + TILE_SIZE_DEG,
    west,
    east: west + TILE_SIZE_DEG,
  };
}
