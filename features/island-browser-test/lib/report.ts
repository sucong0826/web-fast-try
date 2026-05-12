// Verbatim port of the report builders from test.html (lines 1118–1165, 1196–1213).

import type {
  ApiResult,
  Finding,
  RawSignals,
  ResolvedEnv,
  Status,
  UaResult,
} from "./types";

export function statusEmoji(s: Status): string {
  const map: Record<Status, string> = {
    pass: "✅",
    fail: "❌",
    warn: "⚠️",
    info: "ℹ️",
    na: "—",
  };
  return map[s] || "—";
}

export function escapeMd(s: unknown): string {
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function formatValue(v: unknown): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

export function buildReport(
  raw: RawSignals,
  uaResult: UaResult,
  apiResults: ApiResult[],
  findings: Finding[],
  env: ResolvedEnv,
): string {
  const ts = new Date().toISOString();
  let md = "";
  md += "# Zoom Web Media — Browser Capability Test Report\n\n";
  md += `_Generated: ${ts}_\n\n`;

  md += "## Test configuration\n\n";
  md += "| Setting | Value | Source |\n|---|---|---|\n";
  md += `| SharedArrayBuffer available in production | ${env.hasSAB ? "yes" : "no"} | ${env.hasSABSource === "auto" ? `auto-detected (this page: ${env.detectedSAB ? "yes" : "no"})` : `manual override (this page detected: ${env.detectedSAB ? "yes" : "no"})`} |\n\n`;

  md += "## Test summary\n\n";
  const counts = { pass: 0, fail: 0, warn: 0, info: 0, na: 0 };
  findings.forEach((f) => {
    counts[f.status]++;
  });
  md += `- Tests run: ${findings.length}\n`;
  md += `- ✅ Predicted to work: ${counts.pass}\n`;
  md += `- ⚠️ Predicted degraded: ${counts.warn}\n`;
  md += `- ❌ Predicted to fail: ${counts.fail}\n`;
  md += `- ℹ️ Info-only: ${counts.info}\n\n`;

  md += "## Browser identification (raw)\n\n";
  md += "| Key | Value |\n|---|---|\n";
  Object.entries(raw).forEach(([k, v]) => {
    md += `| ${k} | \`${escapeMd(formatValue(v))}\` |\n`;
  });

  md += "\n## ua-helper detection (replicated)\n\n";
  md += "| Key | Value |\n|---|---|\n";
  Object.entries(uaResult).forEach(([k, v]) => {
    md += `| ${k} | \`${escapeMd(formatValue(v))}\` |\n`;
  });

  md += "\n## Web API capability\n\n";
  md += "| Status | API | Detail |\n|---|---|---|\n";
  apiResults.forEach((a) => {
    md += `| ${statusEmoji(a.status)} | ${a.label} | ${escapeMd(a.detail)} |\n`;
  });

  md += "\n## Per-finding prediction\n\n";
  md +=
    "| Status | ID | Feature | Predicate | Predicted impact |\n|---|---|---|---|---|\n";
  findings.forEach((f) => {
    md += `| ${statusEmoji(f.status)} | ${f.id} | ${escapeMd(f.feature)} | \`${escapeMd(f.gate)}\` | ${escapeMd(f.detail)} |\n`;
  });
  return md;
}

export interface JsonPayload {
  generatedAt: string;
  env: ResolvedEnv;
  raw: RawSignals;
  ua: UaResult;
  api: ApiResult[];
  findings: Finding[];
}

export function buildJsonPayload(
  raw: RawSignals,
  uaResult: UaResult,
  apiResults: ApiResult[],
  findings: Finding[],
  env: ResolvedEnv,
): JsonPayload {
  return {
    generatedAt: new Date().toISOString(),
    env,
    raw,
    ua: uaResult,
    api: apiResults,
    findings,
  };
}
