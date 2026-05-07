import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function DeviceMenu({
  state,
  onCameraChange,
  onMicrophoneChange,
}: {
  state: MeetingState;
  onCameraChange: (deviceId: string) => void;
  onMicrophoneChange: (deviceId: string) => void;
}) {
  return (
    <div className={styles.deviceMenu}>
      <label>
        Camera
        <select value={state.localMedia.selectedCameraId} onChange={(event) => onCameraChange(event.target.value)}>
          <option value="">Default camera</option>
          {state.localMedia.cameras.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>{device.label || device.deviceId}</option>
          ))}
        </select>
      </label>
      <label>
        Microphone
        <select value={state.localMedia.selectedMicrophoneId} onChange={(event) => onMicrophoneChange(event.target.value)}>
          <option value="">Default microphone</option>
          {state.localMedia.microphones.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>{device.label || device.deviceId}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
