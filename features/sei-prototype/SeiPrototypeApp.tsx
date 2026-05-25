"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startPipeline, type PipelineHandles } from "./pipeline/VideoPipelineController";
import { createAggregator, type Summary } from "./logging/tsObservation";
import type { ExportPayload, SampleRow } from "./metadata/types";

type Phase = "idle" | "starting" | "running" | "stopping" | "error";

interface UiState {
  phase: Phase;
  errorMessage: string | null;
  summary: Summary;
  rows: SampleRow[];
  elapsedSec: number;
  connection: RTCPeerConnectionState;
}

const emptySummary = (): Summary => ({
  framesOut: 0,
  sampled: 0,
  injected: 0,
  hits: 0,
  recvParsed: 0,
  framesDecoded: 0,
  freezeCount: 0,
  passFail: { H1: "pending", H2: "pending", H3: "pending", H4: "pending" },
});

export default function SeiPrototypeApp() {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipelineRef = useRef<PipelineHandles | null>(null);
  const aggregatorRef = useRef<ReturnType<typeof createAggregator> | null>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const tickIntervalRef = useRef<number | null>(null);
  const startMsRef = useRef<number>(0);

  const [ui, setUi] = useState<UiState>({
    phase: "idle",
    errorMessage: null,
    summary: emptySummary(),
    rows: [],
    elapsedSec: 0,
    connection: "new",
  });

  const refreshSummary = useCallback(() => {
    const agg = aggregatorRef.current;
    if (!agg) return;
    setUi((prev) => ({
      ...prev,
      summary: agg.getSummary(),
      rows: Array.from(agg.state.rows.values()).sort((a, b) => a.vfTimestampUs - b.vfTimestampUs),
      elapsedSec: startMsRef.current ? Math.floor((Date.now() - startMsRef.current) / 1000) : 0,
    }));
  }, []);

  const handleStart = useCallback(async () => {
    if (ui.phase === "running" || ui.phase === "starting") return;
    setUi((prev) => ({ ...prev, phase: "starting", errorMessage: null }));

    const aggregator = createAggregator({
      onUpdate: () => { /* throttled via tick */ },
    });
    aggregatorRef.current = aggregator;
    aggregator.markStart();
    startMsRef.current = Date.now();

    try {
      const handles = await startPipeline({
        onRawLog: (entry) => aggregator.ingest(entry),
        onRemoteStream: (stream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
            void remoteVideoRef.current.play().catch(() => {});
          }
        },
        onConnectionState: (state) => setUi((prev) => ({ ...prev, connection: state })),
        onError: (err) => setUi((prev) => ({ ...prev, errorMessage: err.message, phase: "error" })),
      });
      pipelineRef.current = handles;
      aggregator.setEnvSnapshot(handles.envSnapshot);
      aggregator.addStatsSnapshot(await handles.captureStats());

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = handles.localStream;
        void localVideoRef.current.play().catch(() => {});
      }

      statsIntervalRef.current = window.setInterval(async () => {
        const snap = await handles.captureStats();
        aggregator.addStatsSnapshot(snap);
        const decode = extractDecodeStats(snap.pc2);
        aggregator.updateDecodeStats(decode);
        const impl = extractEncoderImpl(snap);
        if (impl.encoder || impl.decoder) {
          console.log("[Stats] encoder:", impl.encoder, "decoder:", impl.decoder);
        }
      }, 5_000);
      tickIntervalRef.current = window.setInterval(refreshSummary, 500);

      setUi((prev) => ({ ...prev, phase: "running" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUi((prev) => ({ ...prev, phase: "error", errorMessage: message }));
    }
  }, [refreshSummary, ui.phase]);

  const handleStop = useCallback(async () => {
    if (!pipelineRef.current) return;
    setUi((prev) => ({ ...prev, phase: "stopping" }));
    if (statsIntervalRef.current !== null) window.clearInterval(statsIntervalRef.current);
    if (tickIntervalRef.current !== null) window.clearInterval(tickIntervalRef.current);
    statsIntervalRef.current = null;
    tickIntervalRef.current = null;
    try {
      const finalSnap = await pipelineRef.current.captureStats();
      aggregatorRef.current?.addStatsSnapshot(finalSnap);
      await pipelineRef.current.stop();
    } catch {
      /* ignore */
    }
    aggregatorRef.current?.markStop();
    pipelineRef.current = null;
    refreshSummary();
    setUi((prev) => ({ ...prev, phase: "idle" }));
  }, [refreshSummary]);

  const handleExport = useCallback(() => {
    if (!aggregatorRef.current) return;
    const payload: ExportPayload = aggregatorRef.current.buildExport();
    const json = JSON.stringify(payload, null, 2);
    void navigator.clipboard.writeText(json).catch(() => {});
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sei-prototype-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    return () => {
      if (statsIntervalRef.current !== null) window.clearInterval(statsIntervalRef.current);
      if (tickIntervalRef.current !== null) window.clearInterval(tickIntervalRef.current);
      void pipelineRef.current?.stop();
    };
  }, []);

  return (
    <div className="p-6 text-sm text-[#0f0e1a] dark:text-[#f1f0f6] space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">SEI EncodedTransform Prototype</h1>
          <p className="opacity-70 text-xs">Chrome only · H.264 only · one tab, two PeerConnections.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-violet-600 text-white disabled:opacity-40"
            disabled={ui.phase === "running" || ui.phase === "starting"}
            onClick={handleStart}
          >Start</button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-slate-200 dark:bg-slate-700 disabled:opacity-40"
            disabled={ui.phase !== "running"}
            onClick={handleStop}
          >Stop</button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-slate-200 dark:bg-slate-700 disabled:opacity-40"
            disabled={ui.phase === "idle" && ui.summary.framesOut === 0}
            onClick={handleExport}
          >Export JSON</button>
        </div>
      </header>

      {ui.errorMessage && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-red-700 dark:text-red-300">
          {ui.errorMessage}
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <VideoPanel title="Local preview" videoRef={localVideoRef} muted />
        <VideoPanel title="Remote (decoded by pc2)" videoRef={remoteVideoRef} muted={false} />
      </section>

      <SummaryPanel ui={ui} />

      <SampleTable rows={ui.rows} />
    </div>
  );
}

function VideoPanel({ title, videoRef, muted }: { title: string; videoRef: React.RefObject<HTMLVideoElement>; muted: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/10 p-3">
      <div className="text-xs opacity-70 mb-2">{title}</div>
      <video ref={videoRef} className="w-full aspect-video bg-black rounded" playsInline autoPlay muted={muted} />
    </div>
  );
}

function SummaryPanel({ ui }: { ui: UiState }) {
  return (
    <section className="rounded-lg border border-slate-200 dark:border-white/10 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <Stat label="Phase" value={ui.phase} />
      <Stat label="Connection" value={ui.connection} />
      <Stat label="Elapsed" value={`${ui.elapsedSec} s`} />
      <Stat label="Frames out (gen)" value={`${ui.summary.framesOut} / sampled ${ui.summary.sampled}`} />
      <Stat label="Sender ETW" value={`injected ${ui.summary.injected} · hits ${ui.summary.hits}`} />
      <Stat label="Receiver parsed" value={`${ui.summary.recvParsed}`} />
      <Stat label="Decoder" value={`framesDecoded=${ui.summary.framesDecoded} · freezeCount=${ui.summary.freezeCount}`} />
      <Stat label="Pass/Fail" value={
        `H1 ${ui.summary.passFail.H1} · H2 ${ui.summary.passFail.H2} · H3 ${ui.summary.passFail.H3} · H4 ${ui.summary.passFail.H4}`
      } />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="opacity-60">{label}</div>
      <div className="font-mono mt-0.5">{value}</div>
    </div>
  );
}

function SampleTable({ rows }: { rows: SampleRow[] }) {
  if (rows.length === 0) {
    return <div className="text-xs opacity-60">No sampled frames yet — start the pipeline to begin.</div>;
  }
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/10 overflow-auto max-h-[420px]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
          <tr>
            <th className="text-left px-2 py-1">vfTs μs</th>
            <th className="text-left px-2 py-1">batch / frame</th>
            <th className="text-left px-2 py-1">senderMetaTs</th>
            <th className="text-left px-2 py-1">hit?</th>
            <th className="text-left px-2 py-1">selfParse</th>
            <th className="text-left px-2 py-1">recvSEI</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(-200).reverse().map((row) => (
            <tr key={row.vfTimestampUs} className="border-t border-slate-200 dark:border-white/10">
              <td className="px-2 py-1 font-mono">{row.vfTimestampUs}</td>
              <td className="px-2 py-1 font-mono">{row.batchId} / {row.frameId}</td>
              <td className="px-2 py-1 font-mono">{row.senderMetaTimestamp ?? "—"}</td>
              <td className="px-2 py-1">{row.senderHit === undefined ? "—" : row.senderHit ? "✓" : "✗"}</td>
              <td className="px-2 py-1 font-mono">{row.senderSelfParse ? `${row.senderSelfParse.batchId}/${row.senderSelfParse.frameId}` : "—"}</td>
              <td className="px-2 py-1 font-mono">{row.recvSEI ? `${row.recvSEI.batchId}/${row.recvSEI.frameId}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function extractDecodeStats(pc2Stats: unknown): { framesDecoded: number; freezeCount: number } {
  let framesDecoded = 0;
  let freezeCount = 0;
  if (Array.isArray(pc2Stats)) {
    for (const stat of pc2Stats) {
      if (stat && typeof stat === "object" && (stat as { type?: string }).type === "inbound-rtp" && (stat as { kind?: string }).kind === "video") {
        const s = stat as { framesDecoded?: number; freezeCount?: number };
        framesDecoded = s.framesDecoded ?? framesDecoded;
        freezeCount = s.freezeCount ?? freezeCount;
      }
    }
  }
  return { framesDecoded, freezeCount };
}

function extractEncoderImpl(snap: { pc1: unknown; pc2: unknown }): { encoder: string | null; decoder: string | null } {
  let encoder: string | null = null;
  let decoder: string | null = null;
  if (Array.isArray(snap.pc1)) {
    for (const stat of snap.pc1) {
      if (stat && typeof stat === "object" && (stat as { type?: string }).type === "outbound-rtp" && (stat as { kind?: string }).kind === "video") {
        encoder = (stat as { encoderImplementation?: string }).encoderImplementation ?? encoder;
      }
    }
  }
  if (Array.isArray(snap.pc2)) {
    for (const stat of snap.pc2) {
      if (stat && typeof stat === "object" && (stat as { type?: string }).type === "inbound-rtp" && (stat as { kind?: string }).kind === "video") {
        decoder = (stat as { decoderImplementation?: string }).decoderImplementation ?? decoder;
      }
    }
  }
  return { encoder, decoder };
}
