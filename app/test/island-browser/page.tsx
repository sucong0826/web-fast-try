"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Clipboard, Download, TestTube } from "lucide-react";
import {
  buildContext,
  buildPredicates,
  buildUaResult,
} from "@/features/island-browser-test/lib/ua-detection";
import {
  probeResultToApiRow,
  probeVideoDecoder,
  probeVideoEncoder,
  runSyncApiChecks,
} from "@/features/island-browser-test/lib/api-probes";
import {
  buildSyncFindings,
  buildWebCodecsFinding,
  detectSAB,
} from "@/features/island-browser-test/lib/findings";
import {
  buildJsonPayload,
  buildReport,
  formatValue,
} from "@/features/island-browser-test/lib/report";
import type {
  ApiResult,
  Finding,
  OverrideChoice,
  RawSignals,
  ResolvedEnv,
  Status,
  UaResult,
} from "@/features/island-browser-test/lib/types";

interface DetectionState {
  raw: RawSignals;
  uaResult: UaResult;
  apiResults: ApiResult[];
  webCodecsW1: Finding | null;
  detectedSAB: boolean;
}

const PILL_STYLES: Record<Status, string> = {
  pass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  fail: "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  info: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  na: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const PILL_LABEL: Record<Status, string> = {
  pass: "PASS",
  fail: "FAIL",
  warn: "WARN",
  info: "INFO",
  na: "N/A",
};

function StatusPill({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-0.5 text-[11px] font-semibold rounded-full ${PILL_STYLES[status]}`}
    >
      {PILL_LABEL[status]}
    </span>
  );
}

function Card({
  title,
  description,
  children,
  defaultCollapsed = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="bg-white dark:bg-[#18181e] border border-[#ede9f8] dark:border-white/[0.06] rounded-2xl shadow-sm mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full flex items-start justify-between gap-3 p-5 text-left hover:bg-[#faf9ff] dark:hover:bg-white/[0.02] transition-colors"
      >
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[#0f0e1a] dark:text-[#f1f0f6]">
            {title}
          </h2>
          {description && (
            <p className="text-xs text-[#6e6a85] dark:text-[#65627a] mt-1">
              {description}
            </p>
          )}
        </div>
        <ChevronDown
          className={`w-5 h-5 text-[#6e6a85] dark:text-[#65627a] flex-shrink-0 mt-0.5 transition-transform ${collapsed ? "" : "rotate-180"}`}
          aria-hidden="true"
        />
      </button>
      {!collapsed && <div className="px-5 pb-5 pt-1">{children}</div>}
    </section>
  );
}

function KeyValueTable({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {rows.map(([label, value]) => (
            <tr
              key={label}
              className="border-b border-[#ede9f8] dark:border-white/[0.05] last:border-0"
            >
              <td className="py-2 pr-3 text-xs uppercase tracking-wider text-[#6e6a85] dark:text-[#65627a] align-top w-[280px]">
                {label}
              </td>
              <td className="py-2 font-mono text-[13px] text-[#0f0e1a] dark:text-[#f1f0f6] break-all whitespace-pre-wrap">
                {formatValue(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusRowTable({
  header,
  rows,
}: {
  header: { feature: string; detail: string };
  rows: Array<{
    status: Status;
    primary: React.ReactNode;
    secondary?: React.ReactNode;
    detail: React.ReactNode;
  }>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[#ede9f8] dark:border-white/[0.05]">
            <th className="py-2 pr-3 text-left text-xs uppercase tracking-wider text-[#6e6a85] dark:text-[#65627a] w-[80px]">
              Status
            </th>
            <th className="py-2 pr-3 text-left text-xs uppercase tracking-wider text-[#6e6a85] dark:text-[#65627a]">
              {header.feature}
            </th>
            <th className="py-2 text-left text-xs uppercase tracking-wider text-[#6e6a85] dark:text-[#65627a]">
              {header.detail}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-[#ede9f8] dark:border-white/[0.05] last:border-0 align-top"
            >
              <td className="py-3 pr-3">
                <StatusPill status={r.status} />
              </td>
              <td className="py-3 pr-3 text-[#0f0e1a] dark:text-[#f1f0f6]">
                <div className="font-medium text-sm">{r.primary}</div>
                {r.secondary && (
                  <div className="font-mono text-xs text-[#6e6a85] dark:text-[#65627a] mt-1 break-all">
                    {r.secondary}
                  </div>
                )}
              </td>
              <td className="py-3 font-mono text-[13px] text-[#0f0e1a] dark:text-[#f1f0f6] break-all whitespace-pre-wrap">
                {r.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChoiceGroup({
  value,
  detected,
  onChange,
}: {
  value: OverrideChoice;
  detected: boolean;
  onChange: (next: OverrideChoice) => void;
}) {
  const options: Array<{ key: OverrideChoice; label: string }> = [
    {
      key: "auto",
      label: `Auto-detect (this page: ${detected ? "Yes" : "No"})`,
    },
    { key: "yes", label: "Yes" },
    { key: "no", label: "No" },
  ];
  return (
    <div className="inline-flex flex-wrap gap-1 p-1 rounded-full bg-[#f1eefb] dark:bg-white/[0.04]">
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition ${
              selected
                ? "bg-white dark:bg-[#18181e] text-[#0f0e1a] dark:text-[#f1f0f6] shadow-sm"
                : "text-[#6e6a85] dark:text-[#65627a] hover:text-[#0f0e1a] dark:hover:text-[#f1f0f6]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function resolveEnv(sab: OverrideChoice, detectedSAB: boolean): ResolvedEnv {
  if (sab === "auto") {
    return { hasSAB: detectedSAB, hasSABSource: "auto", detectedSAB };
  }
  return { hasSAB: sab === "yes", hasSABSource: "manual", detectedSAB };
}

export default function IslandBrowserTestPage() {
  const [state, setState] = useState<DetectionState | null>(null);
  const [sabOverride, setSabOverride] = useState<OverrideChoice>("auto");
  const [toast, setToast] = useState<string>("");

  useEffect(() => {
    const ctx = buildContext();
    const predicates = buildPredicates(ctx);
    const uaResult = buildUaResult(ctx, predicates);
    const apiResults = runSyncApiChecks(ctx.raw);
    setState({
      raw: ctx.raw,
      uaResult,
      apiResults,
      webCodecsW1: null,
      detectedSAB: detectSAB(),
    });

    let cancelled = false;
    (async () => {
      const [decRes, encRes] = await Promise.all([
        probeVideoDecoder(),
        probeVideoEncoder(),
      ]);
      if (cancelled) return;
      const decRow = probeResultToApiRow(
        "VideoDecoder.isConfigSupported(avc1.640028, 1280x720)",
        decRes,
      );
      const encRow = probeResultToApiRow(
        "VideoEncoder.isConfigSupported(avc1.640028, 1280x720)",
        encRes,
      );
      const w1 = buildWebCodecsFinding(decRes, encRes);
      setState((prev) =>
        prev
          ? {
              ...prev,
              apiResults: [...prev.apiResults, decRow, encRow],
              webCodecsW1: w1,
            }
          : prev,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const env = useMemo<ResolvedEnv | null>(
    () => (state ? resolveEnv(sabOverride, state.detectedSAB) : null),
    [sabOverride, state],
  );

  const findings = useMemo<Finding[]>(() => {
    if (!state || !env) return [];
    const ctx = buildContext();
    const predicates = buildPredicates(ctx);
    const sync = buildSyncFindings(ctx, predicates, env);
    return state.webCodecsW1 ? [...sync, state.webCodecsW1] : sync;
  }, [state, env]);

  const summary = useMemo(() => {
    const counts = {
      total: findings.length,
      pass: 0,
      warn: 0,
      fail: 0,
      info: 0,
    };
    findings.forEach((f) => {
      if (f.status === "pass") counts.pass++;
      else if (f.status === "warn") counts.warn++;
      else if (f.status === "fail") counts.fail++;
      else if (f.status === "info") counts.info++;
    });
    return counts;
  }, [findings]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1800);
  }, []);

  const onCopy = useCallback(async () => {
    if (!state || !env) return;
    const md = buildReport(
      state.raw,
      state.uaResult,
      state.apiResults,
      findings,
      env,
    );
    try {
      await navigator.clipboard.writeText(md);
      showToast("Copied to clipboard — paste in chat or email");
    } catch (_e) {
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showToast("Copied (fallback method)");
      } catch {
        showToast("Copy failed — please select all text manually");
      }
      document.body.removeChild(ta);
    }
  }, [state, env, findings, showToast]);

  const onDownload = useCallback(() => {
    if (!state || !env) return;
    const payload = buildJsonPayload(
      state.raw,
      state.uaResult,
      state.apiResults,
      findings,
      env,
    );
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `browser-capability-test-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [state, env, findings]);

  return (
    <div className="max-w-5xl mx-auto pb-32">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white p-6 mb-6 shadow-lg shadow-violet-500/20">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center flex-shrink-0">
            <TestTube className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold mb-1">
              Web Media — Browser Capability Test
            </h1>
            <p className="text-sm text-white/85 max-w-2xl">
              Open this page in the browser you want to test, set the
              configuration below to match your production environment, then
              click <b>Copy Report</b> and paste the result back to engineering.
              The report tells us which features will work on that build.
            </p>
          </div>
        </div>
      </div>

      {!state || !env ? (
        <Card title="Loading…">
          <p className="text-sm text-[#6e6a85] dark:text-[#65627a]">
            Running detection checks…
          </p>
        </Card>
      ) : (
        <>
          <Card
            title="Test configuration"
            description="A few signals depend on how your production site is deployed, not just on the browser. Set them here so the findings reflect your real environment."
          >
            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium text-[#0f0e1a] dark:text-[#f1f0f6] mb-1">
                  SharedArrayBuffer available in your production environment
                </div>
                <p className="text-xs text-[#6e6a85] dark:text-[#65627a] mb-2 max-w-2xl">
                  SAB requires the page to be cross-origin isolated (
                  <code className="font-mono">COOP: same-origin</code> +{" "}
                  <code className="font-mono">COEP: require-corp</code> response
                  headers). This test page may not have those headers, which
                  would make auto-detection say &ldquo;No&rdquo; even on a
                  browser that supports SAB. If you know your production site
                  sets those headers, pick &ldquo;Yes&rdquo;.
                </p>
                <ChoiceGroup
                  value={sabOverride}
                  detected={state.detectedSAB}
                  onChange={setSabOverride}
                />
                <div className="mt-2 text-xs text-[#6e6a85] dark:text-[#65627a]">
                  Effective value:{" "}
                  <span className="font-mono text-[#0f0e1a] dark:text-[#f1f0f6]">
                    {env.hasSAB ? "Yes" : "No"}
                  </span>{" "}
                  (
                  {env.hasSABSource === "auto"
                    ? "auto-detected"
                    : "manual override"}
                  )
                </div>
              </div>
            </div>
          </Card>

          <Card title="Test summary">
            <table className="w-full text-sm border-collapse">
              <tbody>
                <tr className="border-b border-[#ede9f8] dark:border-white/[0.05]">
                  <td className="py-2 pr-3 text-xs uppercase tracking-wider text-[#6e6a85] dark:text-[#65627a] w-[280px]">
                    Tests run
                  </td>
                  <td className="py-2 font-mono text-[13px] text-[#0f0e1a] dark:text-[#f1f0f6]">
                    {summary.total} findings
                  </td>
                </tr>
                {(
                  [
                    ["Features predicted to work", "pass", summary.pass],
                    ["Features predicted to be degraded", "warn", summary.warn],
                    ["Features predicted to fail", "fail", summary.fail],
                  ] as Array<[string, Status, number]>
                ).map(([label, status, count]) => (
                  <tr
                    key={label}
                    className="border-b border-[#ede9f8] dark:border-white/[0.05] last:border-0"
                  >
                    <td className="py-2 pr-3 text-xs uppercase tracking-wider text-[#6e6a85] dark:text-[#65627a] w-[280px]">
                      {label}
                    </td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-2 font-mono text-[13px] text-[#0f0e1a] dark:text-[#f1f0f6]">
                        <StatusPill status={status} /> {count}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card
            title="Browser identification"
            description="Raw signals + what ua-helper would parse from this user agent. Raw signals are ground truth; ua-helper output is what the SDK's feature gates actually see."
          >
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6e6a85] dark:text-[#65627a] mt-2 mb-2">
              Raw navigator
            </h3>
            <KeyValueTable rows={Object.entries(state.raw)} />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6e6a85] dark:text-[#65627a] mt-5 mb-2">
              Replicated ua-helper output
            </h3>
            <KeyValueTable rows={Object.entries(state.uaResult)} />
          </Card>

          <Card
            title="Browser capability checks (Web APIs)"
            description="Direct feature detection in this page's context. Note: SharedArrayBuffer here reflects this page only — see Test configuration above for the production override that drives the findings."
          >
            <StatusRowTable
              header={{ feature: "API", detail: "Detail" }}
              rows={state.apiResults.map((a) => ({
                status: a.status,
                primary: a.label,
                detail: a.detail,
              }))}
            />
          </Card>

          <Card
            title="Per-finding prediction"
            description="For each finding, the page evaluates the same predicate the SDK uses and reports the predicted outcome."
          >
            <StatusRowTable
              header={{ feature: "Feature", detail: "Predicate evaluation" }}
              rows={findings.map((f) => ({
                status: f.status,
                primary: `${f.id} — ${f.feature}`,
                secondary: f.gate,
                detail: f.detail,
              }))}
            />
          </Card>
        </>
      )}

      {/* Sticky action bar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 flex-wrap justify-center px-4">
        <button
          type="button"
          onClick={onCopy}
          disabled={!state}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white text-sm font-medium shadow-lg shadow-violet-500/20 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <Clipboard className="w-4 h-4" />
          Copy Report (Markdown)
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={!state}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white dark:bg-[#18181e] text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-900/50 text-sm font-medium shadow-sm hover:bg-violet-50 dark:hover:bg-violet-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <Download className="w-4 h-4" />
          Download JSON
        </button>
      </div>

      {/* Toast */}
      <div
        className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-20 bg-black/85 text-white text-sm px-4 py-2 rounded-md transition-opacity pointer-events-none ${toast ? "opacity-100" : "opacity-0"}`}
      >
        {toast}
      </div>
    </div>
  );
}
