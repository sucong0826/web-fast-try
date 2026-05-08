import { Copy, Video } from "lucide-react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

function dotClass(state: MeetingState): string {
  if (state.peerConnectionState === "connected") return styles.statusDotConnected;
  if (
    state.lifecycle === "joining" ||
    state.lifecycle === "connecting" ||
    state.lifecycle === "reconnecting"
  )
    return styles.statusDotConnecting;
  return "";
}

export function StatusBar({ state }: { state: MeetingState }) {
  return (
    <header className={styles.statusBar}>
      <div className={styles.statusLogo}>
        <div className={styles.statusLogoIcon}>
          <Video size={16} />
        </div>
        <span>WebRTC Meeting</span>
      </div>

      <div className={styles.statusDivider} />
      <span className={styles.statusRoom}>{state.roomId}</span>

      <div
        className={`${styles.statusDot} ${dotClass(state)}`}
        title={`${state.lifecycle} · PC ${state.peerConnectionState}`}
      />
      <span className={styles.statusState}>{state.lifecycle}</span>

      <div className={styles.statusSpacer} />

      <button
        className={styles.copyLinkBtn}
        onClick={() => navigator.clipboard.writeText(window.location.href)}
        title="Copy invite link"
      >
        <Copy size={12} />
        Copy link
      </button>
    </header>
  );
}
