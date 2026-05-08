import { MessageSquare, Mic, MicOff, MonitorUp, PhoneOff, Settings, Video, VideoOff } from "lucide-react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

function CtrlBtn({
  icon,
  onClick,
  iconStyle,
  title,
}: {
  icon: React.ReactNode;
  onClick?: () => void;
  iconStyle?: string;
  title: string;
}) {
  return (
    <button
      className={`${styles.ctrlBtn} ${iconStyle ?? ""}`}
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );
}

export function ControlBar({
  state,
  onToggleMic,
  onToggleCamera,
  onToggleShare,
  onToggleDevices,
  onToggleChat,
  chatOpen,
  onLeave,
}: {
  state: MeetingState;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleShare: () => void;
  onToggleDevices: () => void;
  onToggleChat: () => void;
  chatOpen: boolean;
  onLeave: () => void;
}) {
  const { micOn, cameraOn, screenSharing } = state.localMedia;

  return (
    <footer className={styles.controlBar}>
      <CtrlBtn
        icon={micOn ? <Mic size={20} /> : <MicOff size={20} />}
        title={micOn ? "Mute microphone" : "Unmute microphone"}
        onClick={onToggleMic}
        iconStyle={!micOn ? styles.iconRed : undefined}
      />
      <CtrlBtn
        icon={cameraOn ? <Video size={20} /> : <VideoOff size={20} />}
        title={cameraOn ? "Stop camera" : "Start camera"}
        onClick={onToggleCamera}
        iconStyle={!cameraOn ? styles.iconRed : undefined}
      />
      <CtrlBtn
        icon={<MonitorUp size={20} />}
        title={screenSharing ? "Stop sharing" : "Share screen"}
        onClick={onToggleShare}
        iconStyle={screenSharing ? styles.iconBlue : undefined}
      />
      <CtrlBtn
        icon={<MessageSquare size={20} />}
        title="Toggle chat"
        onClick={onToggleChat}
        iconStyle={chatOpen ? styles.iconBlue : undefined}
      />
      <CtrlBtn
        icon={<Settings size={20} />}
        title="Audio & video settings"
        onClick={onToggleDevices}
      />

      <div className={styles.ctrlDivider} />

      <CtrlBtn
        icon={<PhoneOff size={20} />}
        title="Leave meeting"
        onClick={onLeave}
        iconStyle={styles.leaveBtnIcon}
      />
    </footer>
  );
}
