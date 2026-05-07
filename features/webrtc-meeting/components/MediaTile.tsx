import { useEffect, useRef } from "react";
import styles from "../styles.module.css";

export function MediaTile({
  label,
  stream,
  muted = false,
  active,
}: {
  label: string;
  stream: MediaStream | null;
  muted?: boolean;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <section className={styles.mediaTile}>
      {stream && active ? (
        <video ref={videoRef} autoPlay playsInline muted={muted} />
      ) : (
        <div className={styles.mediaEmpty}>{label}</div>
      )}
      <span className={styles.tileLabel}>{label}</span>
    </section>
  );
}
