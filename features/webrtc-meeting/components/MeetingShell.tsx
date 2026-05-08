"use client";

import { useState } from "react";
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
  const [showDevices, setShowDevices] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  if (state.lifecycle === "idle" || state.lifecycle === "left" || state.lifecycle === "failed") {
    return <JoinScreen error={state.error} onJoin={controller.join} />;
  }

  if (state.lifecycle === "joining") {
    return (
      <div className={styles.joiningScreen}>
        <div className={styles.joiningCard}>
          <div className={styles.spinner} />
          <p>Joining {state.roomId}…</p>
        </div>
      </div>
    );
  }

  const mainClass = showPanel ? styles.meetingMainWithPanel : styles.meetingMain;

  return (
    <div className={styles.meetingRoot}>
      <StatusBar state={state} />
      <main className={mainClass}>
        <VideoStage state={state} />
        {showPanel && (
          <SidePanel
            state={state}
            onSendChat={controller.sendChat}
            onClose={() => setShowPanel(false)}
          />
        )}
      </main>
      {showDevices && (
        <DeviceMenu
          state={state}
          onCameraChange={controller.changeCamera}
          onMicrophoneChange={controller.changeMicrophone}
          onClose={() => setShowDevices(false)}
        />
      )}
      <ControlBar
        state={state}
        onToggleMic={controller.toggleMicrophone}
        onToggleCamera={controller.toggleCamera}
        onToggleShare={controller.toggleScreenShare}
        onToggleDevices={() => setShowDevices((prev) => !prev)}
        onToggleChat={() => setShowPanel((prev) => !prev)}
        chatOpen={showPanel}
        onLeave={controller.leave}
      />
    </div>
  );
}
