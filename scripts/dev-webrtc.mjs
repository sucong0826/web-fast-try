import { spawn } from "node:child_process";

const env = {
  ...process.env,
  NEXT_PUBLIC_SIGNALING_URL:
    process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:8787",
  WEBRTC_SIGNALING_PORT: process.env.WEBRTC_SIGNALING_PORT || "8787",
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

process.on("SIGINT", () => {
  stopAll("SIGINT");
});

process.on("SIGTERM", () => {
  stopAll("SIGTERM");
});
