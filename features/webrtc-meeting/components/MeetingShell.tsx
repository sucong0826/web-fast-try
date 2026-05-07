"use client";

import { JoinScreen } from "./JoinScreen";
import { StatusBar } from "./StatusBar";
import { VideoStage } from "./VideoStage";
import { ControlBar } from "./ControlBar";
import { SidePanel } from "./SidePanel";
import { DeviceMenu } from "./DeviceMenu";
import { useMeetingController } from "../hooks/useMeetingController";
import styles from "../styles.module.css";

export function MeetingShell() {
  const controller = useMeetingController();
  const { state } = controller;

  if (state.lifecycle === "idle" || state.lifecycle === "left" || state.lifecycle === "failed") {
    return <JoinScreen error={state.error} onJoin={controller.join} />;
  }

  const onCameraChange = async (deviceId: string) => {
    controller.state.localMedia.cameras; // type check
    // dispatch handled inside controller via refreshDevices
  };

  return (
    <div className={styles.meetingRoot}>
      <StatusBar state={state} />
      <main className={styles.meetingMain}>
        <VideoStage state={state} />
        <SidePanel state={state} onSendChat={controller.sendChat} />
      </main>
      <ControlBar
        state={state}
        onToggleMic={controller.toggleMicrophone}
        onToggleCamera={controller.toggleCamera}
        onToggleShare={controller.toggleScreenShare}
        onLeave={controller.leave}
      />
    </div>
  );
}
