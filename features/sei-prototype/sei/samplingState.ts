export const BATCH_DURATION_US = 16_000_000;
export const SAMPLE_WINDOW_US = 4_000_000;
export const SAMPLE_INTERVAL_US = 125_000;
export const FLUSH_INTERVAL_US = 4_000_000;

export interface SamplingState {
  batchStartUs: number;     // -1 means "not yet started"
  currentBatchId: number;
  frameIdInBatch: number;
  nextSampleUs: number;
  nextFlushUs: number;
}

export function createSamplingState(): SamplingState {
  return {
    batchStartUs: -1,
    currentBatchId: 0,
    frameIdInBatch: 0,
    nextSampleUs: 0,
    nextFlushUs: 0,
  };
}

export type SamplingDecision = {
  state: SamplingState;
  batchId: number;
  flush: boolean;
} & ({ sample: false } | { sample: true; frameId: number });

export function stepSampling(prev: SamplingState, ts: number): SamplingDecision {
  let state: SamplingState = { ...prev };
  let flush = false;

  if (state.batchStartUs < 0 || ts - state.batchStartUs >= BATCH_DURATION_US) {
    state.batchStartUs = ts;
    state.currentBatchId += 1;
    state.frameIdInBatch = 0;
    state.nextSampleUs = ts;
    state.nextFlushUs = ts + FLUSH_INTERVAL_US;
    flush = true;
  } else if (ts >= state.nextFlushUs) {
    flush = true;
    state.nextFlushUs += FLUSH_INTERVAL_US;
  }

  const offsetInBatch = ts - state.batchStartUs;
  const inWindow = offsetInBatch < SAMPLE_WINDOW_US;
  const onTick = ts >= state.nextSampleUs;

  if (inWindow && onTick) {
    state.frameIdInBatch += 1;
    state.nextSampleUs += SAMPLE_INTERVAL_US;
    return {
      state,
      batchId: state.currentBatchId,
      flush,
      sample: true,
      frameId: state.frameIdInBatch,
    };
  }

  return {
    state,
    batchId: state.currentBatchId,
    flush,
    sample: false,
  };
}
