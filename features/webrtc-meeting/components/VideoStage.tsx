import type { MeetingState } from "../types";
import { MediaTile } from "./MediaTile";
import styles from "../styles.module.css";

export function VideoStage({ state }: { state: MeetingState }) {
  return (
    <section className={styles.videoStage}>
      {state.remoteMedia.screenSharing ? (
        <div className={styles.shareLayout}>
          <MediaTile label="Remote screen" stream={state.streams.remoteScreen} active={state.remoteMedia.screenSharing} />
          <div className={styles.sideTiles}>
            <MediaTile label="Remote camera" stream={state.streams.remoteCamera} active={state.remoteMedia.cameraOn} />
            <MediaTile label="You" stream={state.streams.localCamera} muted active={state.localMedia.cameraOn} />
          </div>
        </div>
      ) : (
        <div className={styles.gridLayout}>
          <MediaTile label="Remote camera" stream={state.streams.remoteCamera} active={state.remoteMedia.cameraOn} />
          <MediaTile label="You" stream={state.streams.localCamera} muted active={state.localMedia.cameraOn} />
        </div>
      )}
    </section>
  );
}
