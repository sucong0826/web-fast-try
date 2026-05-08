import type { MeetingState } from "../types";
import { MediaTile } from "./MediaTile";
import styles from "../styles.module.css";

export function VideoStage({ state }: { state: MeetingState }) {
  const { lifecycle, localMedia, remoteMedia, streams, displayName, remoteParticipant } = state;
  const remoteName = remoteParticipant?.displayName ?? "Remote";

  if (lifecycle === "waiting") {
    return (
      <section className={styles.videoStage}>
        <div className={styles.waitingRoom}>
          <div className={styles.waitingPreview}>
            <MediaTile
              label={displayName}
              stream={streams.localCamera}
              muted
              active={localMedia.cameraOn}
              name={displayName}
              micMuted={!localMedia.micOn}
            />
          </div>
          <div className={styles.waitingInfo}>
            <h2>Waiting for others to join</h2>
            <p>Share the invite link to bring someone into this room</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.videoStage}>
      {remoteMedia.screenSharing ? (
        <div className={styles.shareLayout}>
          <MediaTile
            label="Screen share"
            stream={streams.remoteScreen}
            active={remoteMedia.screenSharing}
            name={`${remoteName}'s screen`}
            contain
          />
          <div className={styles.sideTiles}>
            <MediaTile
              label={remoteName}
              stream={streams.remoteCamera}
              active={remoteMedia.cameraOn}
              name={remoteName}
              micMuted={!remoteMedia.micOn}
            />
            <MediaTile
              label={displayName}
              stream={streams.localCamera}
              muted
              active={localMedia.cameraOn}
              name={displayName}
              micMuted={!localMedia.micOn}
            />
          </div>
        </div>
      ) : (
        <div className={styles.gridLayout}>
          <MediaTile
            label={remoteName}
            stream={streams.remoteCamera}
            active={remoteMedia.cameraOn}
            name={remoteName}
            micMuted={!remoteMedia.micOn}
          />
          <MediaTile
            label={displayName}
            stream={streams.localCamera}
            muted
            active={localMedia.cameraOn}
            name={displayName}
            micMuted={!localMedia.micOn}
          />
        </div>
      )}
    </section>
  );
}
