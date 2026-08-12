"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Calculator,
  Camera,
  Check,
  CircleAlert,
  Clock3,
  Copy,
  ShieldCheck,
  Square,
} from "lucide-react";
import {
  EpochConversionDirection,
  EpochConversionResult,
  FrameClockAnchor,
  FrameTimestampStrategy,
  LiveFrameCalculationResult,
  NTP_UNIX_EPOCH_OFFSET_MS,
  NtpCalculationResult,
  calculateNtpFromCaptureTime,
  calculateNtpFromFrame,
  calculateNtpFromTimestampAnchor,
  convertEpochMilliseconds,
  formatTimestampMilliseconds,
  parseCalculatorValue,
} from "@/lib/video-frame-ntp-calculator";

type StatusTone = "neutral" | "success" | "warning" | "error";
type CalculatorMode = "capture-time" | "timestamp-anchor";
type SerializableMetadata = Record<string, unknown>;

type VideoFrameLike = {
  timestamp: number;
  metadata?: () => unknown;
  close: () => void;
};

type MediaStreamTrackProcessorConstructor = new (options: {
  track: MediaStreamTrack;
}) => {
  readable: ReadableStream<VideoFrameLike>;
};

type LatestFrame = {
  videoFrameTimestampUs: number;
  performanceTimeOriginMs: number;
  wallProjectionMs: number;
  strategy: FrameTimestampStrategy;
  metadata: SerializableMetadata;
  metadataError: string;
  calculation: LiveFrameCalculationResult;
};

const SAMPLE_CAPTURE_TIME_MS = "106574320.365";
const SAMPLE_VIDEO_FRAME_TIMESTAMP_US = "106574320365";

function getStatusClass(tone: StatusTone) {
  return {
    neutral:
      "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    success:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    warning:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    error:
      "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  }[tone];
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toSerializableMetadata(value: unknown): SerializableMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    );
    const parsed = JSON.parse(serialized) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as SerializableMetadata)
      : {};
  } catch {
    return { serializationError: "Metadata could not be serialized" };
  }
}

async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }
  await navigator.clipboard.writeText(value);
}

function CalculationResult({
  result,
  copyLabel,
  onCopy,
}: {
  result: NtpCalculationResult;
  copyLabel: string;
  onCopy: () => void;
}) {
  const isTimestampAnchor = result.method === "timestamp-anchor";

  return (
    <div className="mt-5 space-y-4">
      <div
        className={`rounded-xl border px-4 py-3 text-sm leading-6 ${
          isTimestampAnchor
            ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        }`}
      >
        <strong>
          {isTimestampAnchor ? "Local wall-clock anchor" : "Preferred calculation"}
        </strong>
        {isTimestampAnchor
          ? ": VideoFrame.timestamp is mapped with a rolling minimum-delay anchor. This is a local wall-clock mapping, not a server-certified NTP clock."
          : ": metadata.captureTime is defined relative to performance.timeOrigin."}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[#eeeaf6] bg-[#faf9ff] p-4 dark:border-white/[0.07] dark:bg-[#202027]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7e788e] dark:text-[#9a96a9]">
            Unix epoch milliseconds
          </p>
          <p className="mt-2 break-all font-mono text-sm text-[#211d32] dark:text-[#f1f0f6]">
            {formatTimestampMilliseconds(result.unixTimestampMs)}
          </p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 p-4 dark:border-violet-900 dark:from-violet-950/50 dark:to-indigo-950/40">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            NTP epoch milliseconds
          </p>
          <p className="mt-2 break-all font-mono text-lg font-bold text-violet-950 dark:text-violet-100">
            {formatTimestampMilliseconds(result.ntpTimestampMs)}
          </p>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-[#7e788e] dark:text-[#9a96a9]">
            UTC interpretation
          </dt>
          <dd className="mt-1 break-all font-mono text-[#312c43] dark:text-[#dedbe7]">
            {result.utcTimestamp}
          </dd>
        </div>
        {isTimestampAnchor ? (
          <div>
            <dt className="text-xs font-semibold text-[#7e788e] dark:text-[#9a96a9]">
              Anchor diagnostics
            </dt>
            <dd className="mt-1 break-all font-mono text-[#312c43] dark:text-[#dedbe7]">
              samples {result.anchorSampleCount} · offset {String(result.anchorOffsetMs ?? 0)} ms · extra delay {formatTimestampMilliseconds(result.observedDelayMs ?? 0)} ms
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs font-semibold text-[#7e788e] dark:text-[#9a96a9]">
            Substituted expression
          </dt>
          <dd className="mt-1 break-all font-mono text-[#312c43] dark:text-[#dedbe7]">
            {result.expression} = {formatTimestampMilliseconds(result.ntpTimestampMs)}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
      >
        {copyLabel.startsWith("Copied") ? (
          <Check className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        {copyLabel}
      </button>
    </div>
  );
}

function EpochConversionResultView({
  result,
  copyLabel,
  onCopy,
}: {
  result: EpochConversionResult;
  copyLabel: string;
  onCopy: () => void;
}) {
  const isUnixToNtp = result.direction === "unix-to-ntp";

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[#eeeaf6] bg-[#faf9ff] p-4 dark:border-white/[0.07] dark:bg-[#202027]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7e788e] dark:text-[#9a96a9]">
            Source · {isUnixToNtp ? "Unix epoch ms" : "NTP epoch ms"}
          </p>
          <p className="mt-2 break-all font-mono text-sm text-[#211d32] dark:text-[#f1f0f6]">
            {result.sourceTimestampMs}
          </p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 p-4 dark:border-violet-900 dark:from-violet-950/50 dark:to-indigo-950/40">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Converted · {isUnixToNtp ? "NTP epoch ms" : "Unix epoch ms"}
          </p>
          <p className="mt-2 break-all font-mono text-lg font-bold text-violet-950 dark:text-violet-100">
            {result.convertedTimestampMs}
          </p>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-[#7e788e] dark:text-[#9a96a9]">
            UTC interpretation
          </dt>
          <dd className="mt-1 break-all font-mono text-[#312c43] dark:text-[#dedbe7]">
            {result.utcTimestamp}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-[#7e788e] dark:text-[#9a96a9]">
            Substituted expression
          </dt>
          <dd className="mt-1 break-all font-mono text-[#312c43] dark:text-[#dedbe7]">
            {result.expression}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
      >
        {copyLabel.startsWith("Copied") ? (
          <Check className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        {copyLabel}
      </button>
    </div>
  );
}

export default function NtpCaptureTimestampPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<VideoFrameLike> | null>(
    null,
  );
  const runningRef = useRef(false);
  const anchorRef = useRef(new FrameClockAnchor());

  const [processorSupported, setProcessorSupported] = useState<boolean | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  const [captureStatus, setCaptureStatus] = useState({
    text: "Stopped",
    tone: "neutral" as StatusTone,
  });
  const [latestFrame, setLatestFrame] = useState<LatestFrame | null>(null);
  const [captureError, setCaptureError] = useState("");
  const [liveCopyLabel, setLiveCopyLabel] = useState("Copy NTP timestamp");
  const [timestampStrategy, setTimestampStrategy] =
    useState<FrameTimestampStrategy>("prefer-capture-time");

  const [calculatorMode, setCalculatorMode] =
    useState<CalculatorMode>("capture-time");
  const [manualTimeOrigin, setManualTimeOrigin] = useState("");
  const [manualCaptureTime, setManualCaptureTime] = useState(
    SAMPLE_CAPTURE_TIME_MS,
  );
  const [manualFrameTimestamp, setManualFrameTimestamp] = useState(
    SAMPLE_VIDEO_FRAME_TIMESTAMP_US,
  );
  const [manualWallProjection, setManualWallProjection] = useState("");
  const [manualResult, setManualResult] =
    useState<NtpCalculationResult | null>(null);
  const [manualError, setManualError] = useState("");
  const [manualCopyLabel, setManualCopyLabel] = useState("Copy NTP timestamp");
  const [epochDirection, setEpochDirection] =
    useState<EpochConversionDirection>("unix-to-ntp");
  const [manualUnixTimestamp, setManualUnixTimestamp] = useState(
    "1786432730355.365",
  );
  const [manualNtpTimestamp, setManualNtpTimestamp] = useState(
    "3995421530355.365",
  );
  const [epochResult, setEpochResult] =
    useState<EpochConversionResult | null>(null);
  const [epochError, setEpochError] = useState("");
  const [epochCopyLabel, setEpochCopyLabel] = useState(
    "Copy converted timestamp",
  );

  const stopCapture = useCallback((announce = true) => {
    runningRef.current = false;
    anchorRef.current.reset();

    const reader = readerRef.current;
    readerRef.current = null;
    reader?.cancel().catch(() => undefined);
    try {
      reader?.releaseLock();
    } catch {
      // Cancellation can settle after the read loop releases the lock.
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;

    setRunning(false);
    if (announce) {
      setCaptureStatus({ text: "Stopped", tone: "neutral" });
    }
  }, []);

  const readVideoFrames = useCallback(
    async (
      track: MediaStreamTrack,
      Processor: MediaStreamTrackProcessorConstructor,
      strategy: FrameTimestampStrategy,
    ) => {
      try {
        const processor = new Processor({ track });
        const reader = processor.readable.getReader();
        readerRef.current = reader;

        while (runningRef.current) {
          const { done, value } = await reader.read();
          if (done || !value) break;

          try {
            const performanceTimeOriginMs = performance.timeOrigin;
            const wallProjectionMs = performanceTimeOriginMs + performance.now();
            const anchorObservation = anchorRef.current.observe(
              value.timestamp,
              wallProjectionMs,
            );
            let rawMetadata: unknown = {};
            let metadataError = "";
            try {
              rawMetadata = value.metadata?.() ?? {};
            } catch (error) {
              metadataError = getErrorMessage(error);
            }

            const calculation = calculateNtpFromFrame({
              performanceTimeOriginMs,
              videoFrameTimestampUs: value.timestamp,
              metadata: rawMetadata,
              strategy,
              anchorObservation,
            });

            setLatestFrame({
              videoFrameTimestampUs: value.timestamp,
              performanceTimeOriginMs,
              wallProjectionMs,
              strategy,
              metadata: toSerializableMetadata(rawMetadata),
              metadataError,
              calculation,
            });
            setCaptureError("");
            setLiveCopyLabel("Copy NTP timestamp");
          } catch (error) {
            setCaptureError(`Frame rejected: ${getErrorMessage(error)}`);
          } finally {
            value.close();
          }
        }

        if (runningRef.current) {
          setCaptureStatus({ text: "Frame stream ended", tone: "warning" });
          stopCapture(false);
        }
      } catch (error) {
        if (runningRef.current) {
          setCaptureError(`Frame processor failed: ${getErrorMessage(error)}`);
          setCaptureStatus({ text: "Capture failed", tone: "error" });
          stopCapture(false);
        }
      }
    },
    [stopCapture],
  );

  const startCapture = useCallback(async () => {
    if (runningRef.current) return;

    const Processor = (
      window as typeof window & {
        MediaStreamTrackProcessor?: MediaStreamTrackProcessorConstructor;
      }
    ).MediaStreamTrackProcessor;

    if (!Processor) {
      const message =
        "MediaStreamTrackProcessor is unavailable. This browser cannot expose native VideoFrame.timestamp or metadata().";
      setCaptureError(message);
      setCaptureStatus({ text: "Unsupported browser", tone: "error" });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const message = "Camera access requires localhost or a secure HTTPS page.";
      setCaptureError(message);
      setCaptureStatus({ text: "Camera unavailable", tone: "error" });
      return;
    }

    try {
      anchorRef.current.reset();
      setLatestFrame(null);
      setCaptureError("");
      setCaptureStatus({ text: "Requesting camera", tone: "neutral" });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { frameRate: { ideal: 30 } },
      });
      streamRef.current = stream;

      const video = videoRef.current;
      const track = stream.getVideoTracks()[0];
      if (!video || !track) {
        throw new Error("Camera preview or video track is unavailable.");
      }

      video.srcObject = stream;
      await video.play();
      runningRef.current = true;
      setRunning(true);
      setCaptureStatus({ text: "Capturing native VideoFrames", tone: "success" });
      void readVideoFrames(track, Processor, timestampStrategy);
    } catch (error) {
      setCaptureError(`Camera access failed: ${getErrorMessage(error)}`);
      setCaptureStatus({ text: "Camera access failed", tone: "error" });
      stopCapture(false);
    }
  }, [readVideoFrames, stopCapture, timestampStrategy]);

  useEffect(() => {
    setProcessorSupported("MediaStreamTrackProcessor" in window);
    setManualTimeOrigin(String(performance.timeOrigin));
    setManualWallProjection(String(performance.timeOrigin + performance.now()));
    return () => stopCapture(false);
  }, [stopCapture]);

  const changeCalculatorMode = (mode: CalculatorMode) => {
    setCalculatorMode(mode);
    setManualResult(null);
    setManualError("");
    setManualCopyLabel("Copy NTP timestamp");
  };

  const changeTimestampStrategy = (strategy: FrameTimestampStrategy) => {
    if (running) return;
    anchorRef.current.reset();
    setLatestFrame(null);
    setTimestampStrategy(strategy);
  };

  const calculateManualTimestamp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result =
        calculatorMode === "capture-time"
          ? calculateNtpFromCaptureTime(
              parseCalculatorValue(
                manualTimeOrigin,
                "performance.timeOrigin",
              ),
              parseCalculatorValue(manualCaptureTime, "captureTime"),
            )
          : (() => {
              const videoFrameTimestampUs = parseCalculatorValue(
                manualFrameTimestamp,
                "VideoFrame.timestamp",
              );
              const wallProjectionMs = parseCalculatorValue(
                manualWallProjection,
                "observed wall projection",
              );
              return calculateNtpFromTimestampAnchor(
                videoFrameTimestampUs,
                wallProjectionMs - videoFrameTimestampUs / 1_000,
              );
            })();

      setManualResult(result);
      setManualError("");
      setManualCopyLabel("Copy NTP timestamp");
    } catch (error) {
      setManualResult(null);
      setManualError(getErrorMessage(error));
    }
  };

  const copyLiveResult = async () => {
    if (!latestFrame) return;
    try {
      await copyText(
        formatTimestampMilliseconds(latestFrame.calculation.ntpTimestampMs),
      );
      setLiveCopyLabel("Copied NTP timestamp");
    } catch (error) {
      setCaptureError(getErrorMessage(error));
    }
  };

  const copyManualResult = async () => {
    if (!manualResult) return;
    try {
      await copyText(formatTimestampMilliseconds(manualResult.ntpTimestampMs));
      setManualCopyLabel("Copied NTP timestamp");
    } catch (error) {
      setManualError(getErrorMessage(error));
    }
  };

  const changeEpochDirection = (direction: EpochConversionDirection) => {
    setEpochDirection(direction);
    setEpochResult(null);
    setEpochError("");
    setEpochCopyLabel("Copy converted timestamp");
  };

  const convertEpochTimestamp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const input =
        epochDirection === "unix-to-ntp"
          ? manualUnixTimestamp
          : manualNtpTimestamp;
      setEpochResult(convertEpochMilliseconds(input, epochDirection));
      setEpochError("");
      setEpochCopyLabel("Copy converted timestamp");
    } catch (error) {
      setEpochResult(null);
      setEpochError(getErrorMessage(error));
    }
  };

  const copyEpochResult = async () => {
    if (!epochResult) return;
    try {
      await copyText(epochResult.convertedTimestampMs);
      setEpochCopyLabel("Copied converted timestamp");
    } catch (error) {
      setEpochError(getErrorMessage(error));
    }
  };

  return (
    <section className="mx-auto max-w-6xl space-y-5">
      <header className="rounded-2xl border border-[#ede9f8] bg-white p-6 shadow-sm dark:border-white/[0.06] dark:bg-[#18181e] sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
              <Clock3 className="h-3.5 w-3.5" />
              VideoFrame clock validation
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0f0e1a] dark:text-[#f1f0f6] sm:text-3xl">
              NTP Capture Timestamp
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6e6a85] dark:text-[#a7a4b5]">
              For a local camera, use <code>metadata.captureTime</code> when
              available or map <code>VideoFrame.timestamp</code> to the local
              wall clock with a rolling anchor.
            </p>
          </div>
          <span
            className={`w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${getStatusClass(
              processorSupported === null
                ? "neutral"
                : processorSupported
                  ? "success"
                  : "error",
            )}`}
          >
            MediaStreamTrackProcessor: {processorSupported === null ? "checking" : processorSupported ? "ready" : "unavailable"}
          </span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.75fr)]">
        <section className="rounded-2xl border border-[#ede9f8] bg-white p-6 shadow-sm dark:border-white/[0.06] dark:bg-[#18181e]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-violet-600 dark:text-violet-400">
                1. Capture
              </p>
              <h2 className="mt-1 text-lg font-semibold text-[#0f0e1a] dark:text-[#f1f0f6]">
                Read native frame metadata
              </h2>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${getStatusClass(captureStatus.tone)}`}>
              {captureStatus.text}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[#6e6a85] dark:text-[#a7a4b5]">
            The test requires <code>MediaStreamTrackProcessor</code>. Capture
            mode records a native frame immediately and never assumes that its
            timestamp has the same zero point as <code>performance.timeOrigin</code>.
          </p>
          <fieldset className="mt-5">
            <legend className="text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">
              Local-camera timestamp strategy
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {([
                [
                  "prefer-capture-time",
                  "Prefer metadata.captureTime",
                  "Use captureTime when available; otherwise use the local timestamp anchor.",
                ],
                [
                  "timestamp-anchor",
                  "Use VideoFrame.timestamp anchor",
                  "Always map VideoFrame.timestamp with the local clock anchor.",
                ],
              ] as const).map(([strategy, title, description]) => (
                <label
                  key={strategy}
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    timestampStrategy === strategy
                      ? "border-violet-400 bg-violet-50 dark:border-violet-600 dark:bg-violet-950/40"
                      : "border-[#ded9ed] dark:border-white/[0.1]"
                  } ${running ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name="timestamp-strategy"
                    value={strategy}
                    checked={timestampStrategy === strategy}
                    onChange={() => changeTimestampStrategy(strategy)}
                    disabled={running}
                    className="mr-2 accent-violet-600"
                  />
                  <span className="text-sm font-semibold text-[#342f47] dark:text-[#e1deea]">
                    {title}
                  </span>
                  <span className="mt-1 block pl-6 text-xs text-[#7e788e] dark:text-[#9a96a9]">
                    {description}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-[#777186] dark:text-[#aaa6b5]">
              Rolling 64-sample minimum: the smallest recent observed delay is
              used as the local clock anchor. Stop capture before changing the
              strategy.
            </p>
          </fieldset>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startCapture()}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-violet-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
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
          </div>
          {captureError ? (
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {captureError}
            </p>
          ) : null}
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
            Camera frames stay in this browser.
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-[#ede9f8] bg-white p-6 shadow-sm dark:border-white/[0.06] dark:bg-[#18181e]">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-violet-50 p-2.5 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-violet-600 dark:text-violet-400">
              2. Calculate
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[#0f0e1a] dark:text-[#f1f0f6]">
              Manual NTP timestamp calculator
            </h2>
          </div>
        </div>

        <form onSubmit={calculateManualTimestamp} className="mt-5">
          <fieldset>
            <legend className="text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">
              Timestamp source
            </legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {([
                ["capture-time", "metadata.captureTime", "Preferred when available"],
                [
                  "timestamp-anchor",
                  "VideoFrame.timestamp anchor",
                  "One-sample local wall-clock mapping",
                ],
              ] as const).map(([mode, title, description]) => (
                <label
                  key={mode}
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    calculatorMode === mode
                      ? "border-violet-400 bg-violet-50 dark:border-violet-600 dark:bg-violet-950/40"
                      : "border-[#ded9ed] dark:border-white/[0.1]"
                  }`}
                >
                  <input
                    type="radio"
                    name="calculator-mode"
                    value={mode}
                    checked={calculatorMode === mode}
                    onChange={() => changeCalculatorMode(mode)}
                    className="mr-2 accent-violet-600"
                  />
                  <span className="text-sm font-semibold text-[#342f47] dark:text-[#e1deea]">{title}</span>
                  <span className="mt-1 block pl-6 text-xs text-[#7e788e] dark:text-[#9a96a9]">{description}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {calculatorMode === "capture-time" ? (
              <>
                <label className="grid gap-1.5 text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">
                  performance.timeOrigin (ms)
                  <input
                    value={manualTimeOrigin}
                    onChange={(event) => setManualTimeOrigin(event.target.value)}
                    inputMode="decimal"
                    placeholder="1786326156034.635"
                    className="rounded-xl border border-[#ded9ed] bg-[#faf9ff] px-3 py-2.5 font-mono text-sm text-[#1d1a2b] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#f1f0f6]"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">
                  captureTime (ms)
                  <input
                    value={manualCaptureTime}
                    onChange={(event) => setManualCaptureTime(event.target.value)}
                    inputMode="decimal"
                    className="rounded-xl border border-[#ded9ed] bg-[#faf9ff] px-3 py-2.5 font-mono text-sm text-[#1d1a2b] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#f1f0f6]"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="grid gap-1.5 text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">
                  VideoFrame.timestamp (µs)
                  <input
                    value={manualFrameTimestamp}
                    onChange={(event) => setManualFrameTimestamp(event.target.value)}
                    inputMode="decimal"
                    className="rounded-xl border border-[#ded9ed] bg-[#faf9ff] px-3 py-2.5 font-mono text-sm text-[#1d1a2b] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#f1f0f6]"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">
                  Observed wall projection (ms)
                  <input
                    value={manualWallProjection}
                    onChange={(event) => setManualWallProjection(event.target.value)}
                    inputMode="decimal"
                    placeholder="performance.timeOrigin + performance.now()"
                    className="rounded-xl border border-[#ded9ed] bg-[#faf9ff] px-3 py-2.5 font-mono text-sm text-[#1d1a2b] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#f1f0f6]"
                  />
                </label>
              </>
            )}
          </div>

          <div className="mt-4 rounded-xl bg-[#f7f5fc] px-4 py-3 font-mono text-xs leading-5 text-[#514c60] dark:bg-[#202027] dark:text-[#c6c2d0]">
            {calculatorMode === "capture-time"
              ? `NTP ms = timeOrigin + captureTime + ${NTP_UNIX_EPOCH_OFFSET_MS}`
              : `NTP ms = VideoFrame.timestamp / 1000 + (observed wall projection − VideoFrame.timestamp / 1000) + ${NTP_UNIX_EPOCH_OFFSET_MS}`}
          </div>

          {calculatorMode === "timestamp-anchor" ? (
            <div className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <CircleAlert className="mt-1 h-4 w-4 shrink-0" />
              <span><strong>Local wall-clock mapping.</strong> This form uses one observed sample. Live capture uses a rolling 64-sample minimum to reduce scheduling and camera-pipeline delay.</span>
            </div>
          ) : null}

          {manualError ? (
            <p className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-400">{manualError}</p>
          ) : null}

          <button
            type="submit"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-violet-700 hover:to-indigo-700"
          >
            <Calculator className="h-4 w-4" /> Calculate NTP timestamp
          </button>
        </form>

        {manualResult ? (
          <CalculationResult
            result={manualResult}
            copyLabel={manualCopyLabel}
            onCopy={() => void copyManualResult()}
          />
        ) : null}

        <div className="mt-8 border-t border-[#eeeaf6] pt-7 dark:border-white/[0.07]">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[#0f0e1a] dark:text-[#f1f0f6]">
                Unix ↔ NTP epoch converter
              </h3>
              <p className="mt-1 text-xs leading-5 text-[#777186] dark:text-[#aaa6b5]">
                Decimal milliseconds only. NTP means milliseconds since 1900;
                standard Q32.32 is not used here.
              </p>
            </div>
          </div>

          <form onSubmit={convertEpochTimestamp} className="mt-5">
            <fieldset>
              <legend className="text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">
                Conversion direction
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {([
                  ["unix-to-ntp", "Unix → NTP", "Add the 1900/1970 epoch offset"],
                  ["ntp-to-unix", "NTP → Unix", "Subtract the 1900/1970 epoch offset"],
                ] as const).map(([direction, title, description]) => (
                  <label
                    key={direction}
                    className={`cursor-pointer rounded-xl border p-3 transition ${
                      epochDirection === direction
                        ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40"
                        : "border-[#ded9ed] dark:border-white/[0.1]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="epoch-direction"
                      value={direction}
                      checked={epochDirection === direction}
                      onChange={() => changeEpochDirection(direction)}
                      className="mr-2 accent-indigo-600"
                    />
                    <span className="text-sm font-semibold text-[#342f47] dark:text-[#e1deea]">
                      {title}
                    </span>
                    <span className="mt-1 block pl-6 text-xs text-[#7e788e] dark:text-[#9a96a9]">
                      {description}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 grid gap-1.5 text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">
              {epochDirection === "unix-to-ntp"
                ? "Unix timestamp (ms)"
                : "NTP timestamp (ms)"}
              <input
                value={
                  epochDirection === "unix-to-ntp"
                    ? manualUnixTimestamp
                    : manualNtpTimestamp
                }
                onChange={(event) =>
                  epochDirection === "unix-to-ntp"
                    ? setManualUnixTimestamp(event.target.value)
                    : setManualNtpTimestamp(event.target.value)
                }
                inputMode="decimal"
                className="rounded-xl border border-[#ded9ed] bg-[#faf9ff] px-3 py-2.5 font-mono text-sm text-[#1d1a2b] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-white/[0.1] dark:bg-[#202027] dark:text-[#f1f0f6]"
              />
            </label>

            <div className="mt-4 rounded-xl bg-[#f7f5fc] px-4 py-3 font-mono text-xs leading-5 text-[#514c60] dark:bg-[#202027] dark:text-[#c6c2d0]">
              {epochDirection === "unix-to-ntp"
                ? `NTP ms = Unix ms + ${NTP_UNIX_EPOCH_OFFSET_MS}`
                : `Unix ms = NTP ms - ${NTP_UNIX_EPOCH_OFFSET_MS}`}
            </div>

            {epochError ? (
              <p className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-400">
                {epochError}
              </p>
            ) : null}

            <button
              type="submit"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-indigo-700 hover:to-blue-700"
            >
              <ArrowLeftRight className="h-4 w-4" /> Convert timestamp
            </button>
          </form>

          {epochResult ? (
            <EpochConversionResultView
              result={epochResult}
              copyLabel={epochCopyLabel}
              onCopy={() => void copyEpochResult()}
            />
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[#ede9f8] bg-white p-6 shadow-sm dark:border-white/[0.06] dark:bg-[#18181e]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-violet-600 dark:text-violet-400">
            3. Latest native frame
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[#0f0e1a] dark:text-[#f1f0f6]">
            Selected local-camera strategy
          </h2>
        </div>

        {!latestFrame ? (
          <p className="mt-5 rounded-xl border border-dashed border-[#dcd7e9] px-4 py-10 text-center text-sm text-[#898395] dark:border-white/[0.1] dark:text-[#918d9d]">
            Start capture to inspect the newest native VideoFrame.
          </p>
        ) : (
          <div className="mt-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["VideoFrame.timestamp (µs)", latestFrame.videoFrameTimestampUs],
                ["performance.timeOrigin (ms)", latestFrame.performanceTimeOriginMs],
                ["Observed wall projection (ms)", latestFrame.wallProjectionMs],
                ["metadata.captureTime (ms)", latestFrame.calculation.captureTimeMs ?? "Unavailable"],
                [
                  "Selected strategy",
                  latestFrame.strategy === "prefer-capture-time"
                    ? "Prefer metadata.captureTime"
                    : "Use VideoFrame.timestamp anchor",
                ],
                [
                  "Applied method",
                  latestFrame.calculation.method === "capture-time"
                    ? "metadata.captureTime"
                    : "Local timestamp anchor",
                ],
                [
                  "Anchor samples",
                  latestFrame.calculation.anchorSampleCount ?? "Not used",
                ],
                [
                  "Observed extra delay (ms)",
                  latestFrame.calculation.observedDelayMs ?? "Not used",
                ],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-[#eeeaf6] bg-[#faf9ff] p-3 dark:border-white/[0.07] dark:bg-[#202027]">
                  <p className="text-[11px] font-semibold text-[#7e788e] dark:text-[#9a96a9]">{label}</p>
                  <p className="mt-1 break-all font-mono text-sm text-[#211d32] dark:text-[#f1f0f6]">{String(value)}</p>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold text-[#625d75] dark:text-[#b3afc1]">Complete VideoFrame.metadata()</p>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-[#17151f] p-4 font-mono text-xs leading-5 text-[#c9f3db]">
                {JSON.stringify(latestFrame.metadata, null, 2)}
              </pre>
              {latestFrame.metadataError ? (
                <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  metadata() failed; local timestamp anchor used: {latestFrame.metadataError}
                </p>
              ) : null}
            </div>

            <CalculationResult
              result={latestFrame.calculation}
              copyLabel={liveCopyLabel}
              onCopy={() => void copyLiveResult()}
            />
          </div>
        )}
      </section>
    </section>
  );
}
