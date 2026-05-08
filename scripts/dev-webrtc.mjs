import { spawn, exec } from "node:child_process";

const SIGNALING_PORT = process.env.WEBRTC_SIGNALING_PORT || "8787";
const APP_PORT = process.env.PORT || "3001";
const APP_URL = `http://localhost:${APP_PORT}/test/webrtc-meeting`;
const OPEN_BROWSER = process.argv.includes("--no-browser") ? false : true;

const env = {
  ...process.env,
  PORT: APP_PORT,
  NEXT_PUBLIC_SIGNALING_URL:
    process.env.NEXT_PUBLIC_SIGNALING_URL || `ws://localhost:${SIGNALING_PORT}`,
  WEBRTC_SIGNALING_PORT: SIGNALING_PORT,
};

const children = [
  spawn("npm", ["run", "signaling:webrtc"], { stdio: "inherit", env }),
  spawn("npm", ["run", "dev"], { stdio: "inherit", env }),
];

function stopAll(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));

if (OPEN_BROWSER) {
  // Poll until Next.js is ready, then open two tabs
  const MAX_WAIT_MS = 60_000;
  const POLL_INTERVAL_MS = 1_000;
  const start = Date.now();

  const poll = setInterval(async () => {
    try {
      const res = await fetch(APP_URL);
      if (res.ok || res.status === 200) {
        clearInterval(poll);
        openTwoTabs();
      }
    } catch {
      // server not ready yet
    }

    if (Date.now() - start > MAX_WAIT_MS) {
      clearInterval(poll);
      console.log(`[dev-webrtc] Timed out waiting for ${APP_URL}`);
    }
  }, POLL_INTERVAL_MS);
}

function openTwoTabs() {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? `open "${APP_URL}" && open "${APP_URL}"`
      : platform === "win32"
        ? `start "" "${APP_URL}" && start "" "${APP_URL}"`
        : `xdg-open "${APP_URL}" && xdg-open "${APP_URL}"`;

  console.log(`[dev-webrtc] Opening two browser tabs → ${APP_URL}`);
  exec(cmd, (err) => {
    if (err) console.error("[dev-webrtc] Failed to open browser:", err.message);
  });
}
