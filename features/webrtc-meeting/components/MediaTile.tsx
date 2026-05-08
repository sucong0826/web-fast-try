import { useEffect, useRef } from "react";
import { MicOff } from "lucide-react";
import styles from "../styles.module.css";

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export function MediaTile({
  label,
  stream,
  muted = false,
  active,
  name,
  micMuted,
  contain,
}: {
  label: string;
  stream: MediaStream | null;
  muted?: boolean;
  active: boolean;
  name?: string;
  micMuted?: boolean;
  contain?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const displayName = name || label;

  useEffect(() => {
    // Clearing srcObject when active=false prevents the frozen last-frame when sharing stops.
    if (videoRef.current) {
      videoRef.current.srcObject = active ? stream : null;
    }
  }, [stream, active]);

  const visible = !!(stream && active);

  return (
    <section className={`${styles.mediaTile} ${contain ? styles.mediaTileContain : ""}`}>
      {!visible && (
        <div className={styles.avatarState}>
          <div className={styles.avatarCircle}>{initials(displayName)}</div>
          <span className={styles.avatarName}>{displayName}</span>
        </div>
      )}
      {/* Always keep video mounted so srcObject can be set when stream arrives */}
      <video ref={videoRef} autoPlay playsInline muted={muted} hidden={!visible} />
      <div className={styles.tileBar}>
        <span className={styles.tileLabel}>{displayName}</span>
        {micMuted && <MicOff size={13} className={styles.tileMicOff} />}
      </div>
    </section>
  );
}
