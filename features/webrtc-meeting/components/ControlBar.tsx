import { Mic, MicOff, MonitorUp, PhoneOff, Radio, Video, VideoOff } from "lucide-react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function ControlBar({
  state,
  onToggleMic,
  onToggleCamera,
  onToggleShare,
  onLeave,
}: {
  state: MeetingState;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleShare: () => void;
  onLeave: () => void;
}) {
  return (
    <footer className={styles.controlBar}>
      <button className={styles.roundButton} onClick={onToggleMic} title="Toggle microphone">
        {state.localMedia.micOn ? <Mic /> : <MicOff />}
      </button>
      <button className={styles.roundButton} onClick={onToggleCamera} title="Toggle camera">
        {state.localMedia.cameraOn ? <Video /> : <VideoOff />}
      </button>
      <button className={styles.roundButton} onClick={onToggleShare} title="Share screen">
        <MonitorUp />
      </button>
      <button className={styles.roundButton} title="Recording reserved for future phase">
        <Radio />
      </button>
      <button className={styles.leaveButton} onClick={onLeave}>
        <PhoneOff size={18} /> Leave
      </button>
    </footer>
  );
}
