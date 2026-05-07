"use client";

import { useState } from "react";
import { Video } from "lucide-react";
import styles from "../styles.module.css";

export function JoinScreen({
  onJoin,
  error,
}: {
  error: string;
  onJoin: (input: {
    roomId: string;
    displayName: string;
    signalingUrl: string;
    iceServersInput: string;
  }) => void;
}) {
  const [displayName, setDisplayName] = useState("Guest");
  const [roomId, setRoomId] = useState("");
  const [signalingUrl, setSignalingUrl] = useState(() => {
    if (process.env.NEXT_PUBLIC_SIGNALING_URL) {
      return process.env.NEXT_PUBLIC_SIGNALING_URL;
    }
    if (typeof window !== "undefined") {
      // Mirror the page hostname so browsers don't treat it as cross-site (avoids PNA check)
      return `ws://${window.location.hostname}:8787`;
    }
    return "ws://localhost:8787";
  });
  const [iceServersInput, setIceServersInput] = useState("");

  return (
    <section className={styles.joinScreen}>
      <div className={styles.joinPanel}>
        <div className={styles.brandRow}>
          <Video size={28} />
          <div>
            <h1>WebRTC Meeting</h1>
            <p>Two-person peer-to-peer meeting prototype</p>
          </div>
        </div>
        {error && <div className={styles.errorBanner}>{error}</div>}
        <label>
          Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          Room ID
          <input value={roomId} placeholder="demo-room" onChange={(event) => setRoomId(event.target.value)} />
        </label>
        <label>
          Signaling URL
          <input value={signalingUrl} onChange={(event) => setSignalingUrl(event.target.value)} />
        </label>
        <label>
          ICE servers JSON
          <textarea
            value={iceServersInput}
            placeholder='[{"urls":"stun:stun.l.google.com:19302"}]'
            onChange={(event) => setIceServersInput(event.target.value)}
          />
        </label>
        <button
          className={styles.primaryButton}
          onClick={() => onJoin({ displayName, roomId, signalingUrl, iceServersInput })}
        >
          Create or Join
        </button>
      </div>
    </section>
  );
}
