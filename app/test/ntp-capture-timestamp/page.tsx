"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  CircleAlert,
  Clock3,
  Copy,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import {
  findNearestNtpTimestamp,
  ntpTimestampToParts,
  parseNtpTimestampList,
  unixEpochUsToNtpTimestamp,
} from "@/lib/ntp-timestamp";

const MAX_ROWS = 200;
const ABSOLUTE_TIMESTAMP_WINDOW_US = 24 * 60 * 60 * 1_000_000;

type StatusTone = "neutral" | "success" | "warning" | "error";

type CaptureRow = {
  id: number;
  captureTimestampUs: number;
  unixEpochUs: number;
  ntpTimestamp: string;
  source: string;
};

type TimestampAnchor = {
  frameTimestampUs: number;
  unixEpochUs: number;
};

type VideoFrameLike = {
  timestamp: number;
  close: () => void;
};

type MediaStreamTrackProcessorConstructor = new (options: {
  track: MediaStreamTrack;
}) => {
  readable: ReadableStream<VideoFrameLike>;
};

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: unknown) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function epochNowUs() {
  return Math.round(Date.now() * 1_000);
}

function getStatusClass(tone: StatusTone) {
  return {
    neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    warning: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    error: "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  }[tone];
}

export default function NtpCaptureTimestampPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<VideoFrameLike> | null>(
    null,
  );
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameCallbackHandleRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const anchorRef = useRef<TimestampAnchor | null>(null);

  const [apiSupport, setApiSupport] = useState<[string, boolean][]>([]);
  const [cameraStatus, setCameraStatus] = useState({
    text: "Stopped",
    tone: "neutral" as StatusTone,
  });
  const [rows, setRows] = useState<CaptureRow[]>([]);
  const [running, setRunning] = useState(false);
  const [serverInput, setServerInput] = useState("");
  const [serverTimestamps, setServerTimestamps] = useState<string[]>([]);
  const [toleranceMs, setToleranceMs] = useState(20);
  const [diagnostics, setDiagnostics] = useState<string[]>([
    "Ready. Start camera capture to collect timestamps.",
  ]);
  const [copyFeedback, setCopyFeedback] = useState("");

  const log = useCallback((message: string) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    setDiagnostics((previous) => [`[${timestamp}] ${message}`, ...previous].slice(0, 80));
  }, []);

  const estimateUnixEpochUs = useCallback(
    (videoFrameTimestampUs: number, source: string) => {
      const nowUs = epochNowUs();

      if (
        Math.abs(videoFrameTimestampUs - nowUs) <
        ABSOLUTE_TIMESTAMP_WINDOW_US
      ) {
        return {
          unixEpochUs: videoFrameTimestampUs,
          source: `${source}; timestamp is Unix-epoch-like`,
        };
      }

      if (!anchorRef.current) {
        anchorRef.current = {
          frameTimestampUs: videoFrameTimestampUs,
          unixEpochUs: nowUs,
        };
        log(
          `Created relative-PTS anchor: frame_ts_us=${videoFrameTimestampUs}, unix_us=${nowUs}`,
        );
      }

      return {
        unixEpochUs:
          anchorRef.current.unixEpochUs +
          (videoFrameTimestampUs - anchorRef.current.frameTimestampUs),
        source: `${source}; relative PTS anchored at first JS-observed frame (estimate)`,
      };
    },
    [log],
  );

  const captureRow = useCallback(
    (videoFrameTimestampUs: number, source: string) => {
      const estimate = estimateUnixEpochUs(videoFrameTimestampUs, source);
      const ntpTimestamp = unixEpochUsToNtpTimestamp(estimate.unixEpochUs);

      setRows((previous) => {
        const nextRow: CaptureRow = {
          id: previous.length === 0 ? 0 : previous[previous.length - 1].id + 1,
          captureTimestampUs: videoFrameTimestampUs,
          unixEpochUs: estimate.unixEpochUs,
          ntpTimestamp,
          source: estimate.source,
        };

        return [...previous, nextRow].slice(-MAX_ROWS);
      });
    },
    [estimateUnixEpochUs],
  );

  const stopCapture = useCallback(
    (announce = true) => {
      runningRef.current = false;

      if (fallbackTimerRef.current) {
        clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }

      const video = videoRef.current as FrameCallbackVideo | null;
      if (video && frameCallbackHandleRef.current !== null) {
        video.cancelVideoFrameCallback?.(frameCallbackHandleRef.current);
        frameCallbackHandleRef.current = null;
      }

      const reader = readerRef.current;
      readerRef.current = null;
      reader?.cancel().catch(() => undefined);
      try {
        reader?.releaseLock();
      } catch {
        // The read may still be settling after cancellation.
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;

      setRunning(false);
      setCameraStatus({ text: "Stopped", tone: "neutral" });
      if (announce) log("Stopped capture and released the camera stream.");
    },
    [log],
  );

  const startFallbackCapture = useCallback(() => {
    const video = videoRef.current as FrameCallbackVideo | null;
    if (video?.requestVideoFrameCallback) {
      const captureNextFrame = () => {
        if (!runningRef.current || !videoRef.current) return;
        captureRow(
          epochNowUs(),
          "rVFC fallback: JS receive/display time, not raw VideoFrame timestamp (estimate)",
        );
        frameCallbackHandleRef.current = video.requestVideoFrameCallback!(
          captureNextFrame,
        );
      };

      frameCallbackHandleRef.current = video.requestVideoFrameCallback(captureNextFrame);
      setCameraStatus({
        text: "Running frame-callback fallback — timestamp is an estimate",
        tone: "warning",
      });
      log("MediaStreamTrackProcessor unavailable; using requestVideoFrameCallback fallback.");
      return;
    }

    fallbackTimerRef.current = setInterval(() => {
      captureRow(
        epochNowUs(),
        "Timer fallback: JS wall-clock sample, not raw VideoFrame timestamp (estimate)",
      );
    }, 100);
    setCameraStatus({
      text: "Running timer fallback — timestamp is an estimate",
      tone: "warning",
    });
    log("No frame callback API is available; using a 10 fps wall-clock fallback.");
  }, [captureRow, log]);

  const readVideoFrames = useCallback(
    async (track: MediaStreamTrack) => {
      const Processor = (
        window as typeof window & {
          MediaStreamTrackProcessor?: MediaStreamTrackProcessorConstructor;
        }
      ).MediaStreamTrackProcessor;

      if (!Processor) {
        startFallbackCapture();
        return;
      }

      try {
        const processor = new Processor({ track });
        const reader = processor.readable.getReader();
        readerRef.current = reader;
        setCameraStatus({
          text: "Running native VideoFrame capture path",
          tone: "success",
        });
        log("Using MediaStreamTrackProcessor: rows contain browser VideoFrame.timestamp values.");

        while (runningRef.current) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          try {
            captureRow(value.timestamp, "MediaStreamTrackProcessor VideoFrame.timestamp");
          } finally {
            value.close();
          }
        }

        if (runningRef.current) {
          log("Video frame stream ended; stopping capture.");
          stopCapture(false);
        }
      } catch (error) {
        if (runningRef.current) {
          readerRef.current = null;
          const message = error instanceof Error ? error.message : String(error);
          log(`MediaStreamTrackProcessor failed; using fallback: ${message}`);
          startFallbackCapture();
        }
      }
    },
    [captureRow, log, startFallbackCapture, stopCapture],
  );

  const startCapture = useCallback(async () => {
    if (runningRef.current) return;

    if (typeof BigInt !== "function") {
      const message =
        "BigInt is unavailable; this browser cannot preserve Q32.32 NTP precision.";
      setCameraStatus({
        text: message,
        tone: "error",
      });
      log(message);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const message =
        "Camera capture is unavailable. Open this page on localhost or HTTPS.";
      setCameraStatus({
        text: message,
        tone: "error",
      });
      log(message);
      return;
    }

    try {
      anchorRef.current = null;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { frameRate: { ideal: 30 } },
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Camera preview is not ready.");
      }

      video.srcObject = stream;
      await video.play();
      runningRef.current = true;
      setRunning(true);
      log("Camera stream started.");

      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("The camera stream has no video track.");
      void readVideoFrames(track);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCameraStatus({ text: `Camera access failed: ${message}`, tone: "error" });
      log(`Camera access failed: ${message}`);
      stopCapture(false);
    }
  }, [log, readVideoFrames, stopCapture]);

  useEffect(() => {
    const video = document.createElement("video") as FrameCallbackVideo;
    setApiSupport([
      ["BigInt", typeof BigInt === "function"],
      ["getUserMedia", Boolean(navigator.mediaDevices?.getUserMedia)],
      [
        "MediaStreamTrackProcessor",
        "MediaStreamTrackProcessor" in window,
      ],
      ["requestVideoFrameCallback", Boolean(video.requestVideoFrameCallback)],
    ]);

    return () => stopCapture(false);
  }, [stopCapture]);

  const matches = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.id,
          findNearestNtpTimestamp(serverTimestamps, row.ntpTimestamp, toleranceMs),
        ]),
      ),
    [rows, serverTimestamps, toleranceMs],
  );

  const applyServerValues = () => {
    const values = parseNtpTimestampList(serverInput);
    setServerTimestamps(values);
    log(`Loaded ${values.length} server NTP timestamp${values.length === 1 ? "" : "s"} for nearest matching.`);
  };

  const clearRows = () => {
    anchorRef.current = null;
    setRows([]);
    setCopyFeedback("");
    log("Cleared captured rows and the relative-PTS anchor.");
  };

  const copyCsv = async () => {
    const header = [
      "frame_idx",
      "timestamp_source",
      "frame_timestamp_us",
      "estimated_unix_ms",
      "ull_ntp_timestamp",
      "ntp_seconds",
      "ntp_fraction",
      "status",
      "server_frame_idx",
      "diff_ms",
    ];
    const lines = rows.map((row) => {
      const match = matches.get(row.id)!;
      const parts = ntpTimestampToParts(row.ntpTimestamp);
      const status =
        match.index === null
          ? "no server data"
          : match.matched
            ? "matched"
            : "outside tolerance";

      return [
        row.id,
        JSON.stringify(row.source),
        row.captureTimestampUs,
        row.unixEpochUs / 1_000,
        row.ntpTimestamp,
        parts.seconds,
        parts.fraction,
        status,
        match.index ?? "",
        match.diffMs ?? "",
      ].join(",");
    });

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable in this browser.");
      }
      await navigator.clipboard.writeText([header.join(","), ...lines].join("\n"));
      setCopyFeedback(`Copied ${rows.length} row${rows.length === 1 ? "" : "s"}`);
      log(`Copied ${rows.length} row${rows.length === 1 ? "" : "s"} as CSV.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCopyFeedback("Copy failed — see diagnostics");
      log(`CSV copy failed: ${message}`);
    }
  };

  return (
    <section className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-2xl border border-[#ede9f8] bg-white p-6 shadow-sm dark:border-white/[0.06] dark:bg-[#18181e] sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
              <Clock3 className="h-3.5 w-3.5" />
              WebRTC timing validation
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0f0e1a] dark:text-[#f1f0f6] sm:text-3xl">
              NTP Capture Timestamp
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6e6a85] dark:text-[#a7a4b5]">
              Capture camera frames, estimate Unix capture time, and encode it as the decimal Q32.32 <code className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">ullNTPTimestamp</code> used by RWG metadata.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:max-w-xs sm:justify-end">
            {apiSupport.map(([name, supported]) => (
              <span
                key={name}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${supported ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"}`}
              >
                {name}: {supported ? "ready" : "unavailable"}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.62fr)]">
        <section className="rounded-2xl border border-[#ede9f8] bg-white p-6 shadow-sm dark:border-white/[0.06] dark:bg-[#18181e]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-violet-600 dark:text-violet-400">1. Capture</p>
              <h2 className="mt-1 text-lg font-semibold text-[#0f0e1a] dark:text-[#f1f0f6]">Camera timestamp source</h2>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${getStatusClass(cameraStatus.tone)}`}>
              {cameraStatus.text}
            </span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#6e6a85] dark:text-[#a7a4b5]">
            Native <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">MediaStreamTrackProcessor</code> timestamps are preferred. Fallback values remain useful for coverage, but are explicitly marked as an estimate rather than raw camera capture time.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startCapture}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-500/20 transition hover:from-violet-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Camera className="h-4 w-4" /> Start capture
            </button>
            <button
              type="button"
              onClick={() => stopCapture()}
              disabled={!running}
              className="inline-flex items-center gap-2 rounded-xl border border-[#ded9ed] bg-white px-4 py-2.5 text-sm font-semibold text-[#4d4862] transition hover:border-violet-300 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#d7d4e2]"
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
            <button
              type="button"
              onClick={clearRows}
              className="inline-flex items-center gap-2 rounded-xl border border-[#ded9ed] bg-white px-4 py-2.5 text-sm font-semibold text-[#4d4862] transition hover:border-violet-300 hover:text-violet-700 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#d7d4e2]"
            >
              <Trash2 className="h-4 w-4" /> Clear rows
            </button>
            <button
              type="button"
              onClick={() => void copyCsv()}
              className="inline-flex items-center gap-2 rounded-xl border border-[#ded9ed] bg-white px-4 py-2.5 text-sm font-semibold text-[#4d4862] transition hover:border-violet-300 hover:text-violet-700 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#d7d4e2]"
            >
              {copyFeedback.startsWith("Copied") ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copyFeedback || "Copy CSV"}
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#ede9f8] bg-[#13121b] shadow-sm dark:border-white/[0.06]">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label="Camera preview"
            className="block aspect-video min-h-[220px] w-full bg-[#0a0a0e] object-cover"
          />
          <div className="flex items-center gap-2 border-t border-white/[0.08] px-4 py-3 text-xs text-slate-300">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Camera stays in your browser; no frames are uploaded.
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-[#ede9f8] bg-white p-6 shadow-sm dark:border-white/[0.06] dark:bg-[#18181e]">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-violet-600 dark:text-violet-400">2. Compare</p>
            <h2 className="mt-1 text-lg font-semibold text-[#0f0e1a] dark:text-[#f1f0f6]">RWG / RTMS NTP timestamps</h2>
            <p className="mt-2 text-sm leading-6 text-[#6e6a85] dark:text-[#a7a4b5]">
              Paste one decimal <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">ullNTPTimestamp</code> per line. Each captured row is matched against the nearest server value locally.
            </p>
          </div>
          <label className="grid content-end gap-1.5 text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">
            Match tolerance (ms)
            <input
              type="number"
              min="0"
              step="1"
              value={toleranceMs}
              onChange={(event) => setToleranceMs(Math.max(0, Number(event.target.value) || 0))}
              className="rounded-xl border border-[#ded9ed] bg-[#faf9ff] px-3 py-2.5 text-sm text-[#1d1a2b] outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#f1f0f6] dark:focus:ring-violet-950"
            />
          </label>
        </div>
        <textarea
          value={serverInput}
          onChange={(event) => setServerInput(event.target.value)}
          spellCheck={false}
          placeholder={"17131695848442313467\n17131695848446608434"}
          aria-label="RWG or RTMS NTP timestamp list"
          className="mt-5 min-h-28 w-full resize-y rounded-xl border border-[#ded9ed] bg-[#faf9ff] px-3 py-3 font-mono text-sm text-[#1d1a2b] outline-none transition placeholder:text-[#9c97ac] focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#f1f0f6] dark:focus:ring-violet-950"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[#7e788e] dark:text-[#9a96a9]">{serverTimestamps.length} server value{serverTimestamps.length === 1 ? "" : "s"} applied</p>
          <button
            type="button"
            onClick={applyServerValues}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
          >
            <RefreshCw className="h-4 w-4" /> Apply server values
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#ede9f8] bg-white shadow-sm dark:border-white/[0.06] dark:bg-[#18181e]">
        <div className="flex items-center justify-between gap-4 border-b border-[#eeeaf6] px-6 py-5 dark:border-white/[0.06]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-violet-600 dark:text-violet-400">3. Inspect</p>
            <h2 className="mt-1 text-lg font-semibold text-[#0f0e1a] dark:text-[#f1f0f6]">Frame-to-NTP comparison</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{rows.length} / {MAX_ROWS} rows</span>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-[1240px] w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#f8f7fc] text-[#706b81] dark:bg-[#202027] dark:text-[#aca8b8]">
              <tr>
                {["frame", "timestamp source", "frame ts (µs)", "estimated Unix (ms)", "ullNTP timestamp", "NTP sec", "NTP fraction", "status", "server idx", "diff (ms)"].map((heading) => (
                  <th key={heading} className="border-b border-[#eeeaf6] px-3 py-3 font-semibold dark:border-white/[0.06]">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-[#514c60] dark:text-[#c6c2d0]">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center font-sans text-sm text-[#898395] dark:text-[#918d9d]">No timestamps captured yet. Start capture to populate this table.</td>
                </tr>
              ) : (
                [...rows].reverse().map((row) => {
                  const match = matches.get(row.id)!;
                  const parts = ntpTimestampToParts(row.ntpTimestamp);
                  const status = match.index === null ? "no server data" : match.matched ? "matched" : "outside tolerance";
                  const statusClass = match.index === null ? "text-slate-500" : match.matched ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400";
                  return (
                    <tr key={row.id} className="border-b border-[#f0edf6] last:border-0 dark:border-white/[0.045]">
                      <td className="px-3 py-3">{row.id}</td>
                      <td className="max-w-[320px] whitespace-normal px-3 py-3 font-sans leading-5">{row.source}</td>
                      <td className="px-3 py-3">{row.captureTimestampUs}</td>
                      <td className="px-3 py-3">{row.unixEpochUs / 1_000}</td>
                      <td className="px-3 py-3">{row.ntpTimestamp}</td>
                      <td className="px-3 py-3">{parts.seconds}</td>
                      <td className="px-3 py-3">{parts.fraction}</td>
                      <td className={`px-3 py-3 font-sans font-semibold ${statusClass}`}>{status}</td>
                      <td className="px-3 py-3">{match.index ?? "—"}</td>
                      <td className="px-3 py-3">{match.diffMs ?? "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-[#ede9f8] bg-white p-6 shadow-sm dark:border-white/[0.06] dark:bg-[#18181e]">
        <div className="flex items-center gap-2">
          <CircleAlert className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          <h2 className="text-lg font-semibold text-[#0f0e1a] dark:text-[#f1f0f6]">Capture notes</h2>
        </div>
        <pre className="mt-4 max-h-52 overflow-auto whitespace-pre-wrap rounded-xl bg-[#17151f] p-4 font-mono text-xs leading-5 text-[#c9f3db]">{diagnostics.join("\n")}</pre>
      </section>
    </section>
  );
}
