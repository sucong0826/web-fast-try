import { X } from "lucide-react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function DeviceMenu({
  state,
  onCameraChange,
  onMicrophoneChange,
  onClose,
}: {
  state: MeetingState;
  onCameraChange: (deviceId: string) => void;
  onMicrophoneChange: (deviceId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.deviceOverlay} onClick={onClose}>
      <div className={styles.deviceModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.deviceModalHeader}>
          <h3>Audio &amp; Video settings</h3>
          <button className={styles.deviceCloseBtn} onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <label className={styles.deviceLabel}>
          Camera
          <select
            className={styles.deviceSelect}
            value={state.localMedia.selectedCameraId}
            onChange={(e) => onCameraChange(e.target.value)}
          >
            <option value="">Default camera</option>
            {state.localMedia.cameras.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || device.deviceId}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.deviceLabel}>
          Microphone
          <select
            className={styles.deviceSelect}
            value={state.localMedia.selectedMicrophoneId}
            onChange={(e) => onMicrophoneChange(e.target.value)}
          >
            <option value="">Default microphone</option>
            {state.localMedia.microphones.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || device.deviceId}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
