import type { AnomalyReason } from '../types.ts';

interface VehicleWindowState {
  buffer: Float64Array;
  head: number;
  count: number;
  sum: number;
}

export interface SlidingWindowEvaluation {
  movingAvgSpeed: number;
  speedDelta: number;
  isAnomaly: boolean;
  anomalyReason: AnomalyReason | null;
}

export class SlidingWindowTracker {
  private windowSize: number;
  private speedLimitKmh: number;
  private windows = new Map<string, VehicleWindowState>();

  constructor(windowSize = 12, speedLimitKmh = 68) {
    this.windowSize = windowSize;
    this.speedLimitKmh = speedLimitKmh;
  }

  setSpeedLimit(limitKmh: number): void {
    this.speedLimitKmh = Math.max(30, Math.min(130, limitKmh));
  }

  getSpeedLimit(): number {
    return this.speedLimitKmh;
  }

  evaluate(vehicleId: string, currentSpeed: number): SlidingWindowEvaluation {
    let state = this.windows.get(vehicleId);
    if (!state) {
      state = {
        buffer: new Float64Array(this.windowSize),
        head: 0,
        count: 0,
        sum: 0,
      };
      this.windows.set(vehicleId, state);
    }

    const prevAvg = state.count > 0 ? state.sum / state.count : currentSpeed;

    if (state.count === this.windowSize) {
      state.sum -= state.buffer[state.head];
    } else {
      state.count += 1;
    }

    state.buffer[state.head] = currentSpeed;
    state.sum += currentSpeed;
    state.head = (state.head + 1) % this.windowSize;

    const movingAvgSpeed = Number((state.sum / state.count).toFixed(1));
    const speedDelta = Number((currentSpeed - prevAvg).toFixed(1));

    let isAnomaly = false;
    let anomalyReason: AnomalyReason | null = null;

    if (currentSpeed > this.speedLimitKmh + 8) {
      isAnomaly = true;
      anomalyReason = 'Speeding Threshold';
    } else if (state.count >= 6 && movingAvgSpeed > this.speedLimitKmh) {
      isAnomaly = true;
      anomalyReason = 'Sustained Overspeed';
    } else if (state.count >= 4 && speedDelta > 26 && currentSpeed > 45) {
      isAnomaly = true;
      anomalyReason = 'Sudden Acceleration';
    }

    return {
      movingAvgSpeed,
      speedDelta,
      isAnomaly,
      anomalyReason,
    };
  }

  pruneExcept(activeIds: Set<string>): void {
    for (const id of this.windows.keys()) {
      if (!activeIds.has(id)) {
        this.windows.delete(id);
      }
    }
  }
}
