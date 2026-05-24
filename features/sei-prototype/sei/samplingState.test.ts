import { describe, expect, it } from "vitest";
import { createSamplingState, stepSampling } from "./samplingState";

describe("sampling state machine", () => {
  it("first frame starts batch 1 and is sampled", () => {
    let state = createSamplingState();
    const decision = stepSampling(state, 1_000_000);
    state = decision.state;
    expect(decision.batchId).toBe(1);
    expect(decision.sample).toBe(true);
    expect(decision.sample && decision.frameId).toBe(1);
    expect(decision.flush).toBe(true); // first frame also seeds nextFlushUs and emits one
  });

  it("emits roughly 32 samples across a 16 s batch with 30 fps input", () => {
    let state = createSamplingState();
    let sampled = 0;
    const ts0 = 0;
    for (let i = 0; i < 16 * 30; i++) {
      const ts = ts0 + Math.round((i * 1_000_000) / 30);
      const decision = stepSampling(state, ts);
      state = decision.state;
      if (decision.sample) sampled++;
    }
    expect(sampled).toBeGreaterThanOrEqual(31);
    expect(sampled).toBeLessThanOrEqual(33);
  });

  it("does not sample after the first 4 s of a batch", () => {
    let state = createSamplingState();
    const ts0 = 5_000_000;
    // Prime the batch anchor at ts0 — otherwise the first call inside
    // the loop would anchor a new batch at ts0 + 4_000_000 and the
    // entire post-window region would land inside that new batch's
    // sampling window.
    state = stepSampling(state, ts0).state;
    let lateSamples = 0;
    for (let i = 0; i < 12 * 30; i++) {
      const ts = ts0 + 4_000_000 + Math.round((i * 1_000_000) / 30);
      const decision = stepSampling(state, ts);
      state = decision.state;
      if (decision.sample) lateSamples++;
    }
    expect(lateSamples).toBe(0);
  });

  it("starts a new batch and resets frameId after 16 s of timeline", () => {
    let state = createSamplingState();
    state = stepSampling(state, 0).state;
    const cross = stepSampling(state, 16_000_001);
    state = cross.state;
    expect(cross.batchId).toBe(2);
    expect(cross.sample && cross.frameId).toBe(1);
  });

  it("emits a flush every 4 s of timeline (relative to batch start)", () => {
    let state = createSamplingState();
    let flushes = 0;
    for (let i = 0; i < 16 * 30; i++) {
      const ts = Math.round((i * 1_000_000) / 30);
      const decision = stepSampling(state, ts);
      state = decision.state;
      if (decision.flush) flushes++;
    }
    // First frame seeds nextFlushUs and counts as a flush, then 4 more
    // at ~4s/8s/12s/16s of timeline.
    expect(flushes).toBeGreaterThanOrEqual(4);
    expect(flushes).toBeLessThanOrEqual(5);
  });
});
