import { Copy } from "lucide-react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function StatusBar({ state }: { state: MeetingState }) {
  return (
    <header className={styles.statusBar}>
      <span>Room {state.roomId}</span>
      <span>{state.lifecycle}</span>
      <span>WS {state.websocketState}</span>
      <span>PC {state.peerConnectionState}</span>
      <span>ICE {state.iceConnectionState}</span>
      <button
        className={styles.iconButton}
        onClick={() => navigator.clipboard.writeText(window.location.href)}
        title="Copy link"
      >
        <Copy size={16} />
      </button>
    </header>
  );
}
