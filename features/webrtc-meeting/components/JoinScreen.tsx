"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Video } from "lucide-react";
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
      return `ws://${window.location.hostname}:8787`;
    }
    return "ws://localhost:8787";
  });
  const [iceServersInput, setIceServersInput] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <section className={styles.joinScreen}>
      <div className={styles.joinCard}>
        <div className={styles.joinBrand}>
          <div className={styles.joinBrandIcon}>
            <Video size={22} />
          </div>
          <div className={styles.joinBrandText}>
            <h1>WebRTC Meeting</h1>
            <p>Peer-to-peer video conference</p>
          </div>
        </div>

        {error && <div className={styles.errorBanner}>{error}</div>}

        <div className={styles.joinFields}>
          <label className={styles.joinLabel}>
            Display name
            <input
              className={styles.joinInput}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className={styles.joinLabel}>
            Room ID
            <input
              className={styles.joinInput}
              value={roomId}
              placeholder="my-meeting-room"
              onChange={(e) => setRoomId(e.target.value)}
            />
          </label>

          <button
            className={styles.advancedToggle}
            onClick={() => setShowAdvanced((prev) => !prev)}
          >
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Advanced settings
          </button>

          {showAdvanced && (
            <>
              <label className={styles.joinLabel}>
                Signaling URL
                <input
                  className={styles.joinInput}
                  value={signalingUrl}
                  onChange={(e) => setSignalingUrl(e.target.value)}
                />
              </label>
              <label className={styles.joinLabel}>
                ICE servers JSON
                <textarea
                  className={styles.joinTextarea}
                  value={iceServersInput}
                  placeholder='[{"urls":"stun:stun.l.google.com:19302"}]'
                  onChange={(e) => setIceServersInput(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        <button
          className={styles.joinButton}
          onClick={() => onJoin({ displayName, roomId, signalingUrl, iceServersInput })}
        >
          Join Meeting
        </button>
      </div>
    </section>
  );
}
