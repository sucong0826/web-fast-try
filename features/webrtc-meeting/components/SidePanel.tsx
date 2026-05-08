import { useState } from "react";
import { Send, X } from "lucide-react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function SidePanel({
  state,
  onSendChat,
  onClose,
}: {
  state: MeetingState;
  onSendChat: (body: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"chat" | "stats" | "logs">("chat");
  const [message, setMessage] = useState("");

  return (
    <aside className={styles.sidePanel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTabs}>
          {(["chat", "stats", "logs"] as const).map((name) => (
            <button
              key={name}
              className={`${styles.panelTab} ${tab === name ? styles.panelTabActive : ""}`}
              onClick={() => setTab(name)}
            >
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
        <button className={styles.panelCloseBtn} onClick={onClose} title="Close panel">
          <X size={16} />
        </button>
      </div>

      {tab === "chat" && (
        <div className={styles.panelBody}>
          <div className={styles.chatList}>
            {state.chat.map((entry) => {
              const isMine = entry.delivery === "sent";
              return (
                <div
                  key={entry.id}
                  className={`${styles.chatMsg} ${isMine ? styles.chatMsgMine : styles.chatMsgOther}`}
                >
                  {!isMine && (
                    <span className={styles.chatMsgName}>{entry.displayName}</span>
                  )}
                  <div
                    className={`${styles.chatBubble} ${isMine ? styles.chatBubbleMine : styles.chatBubbleOther}`}
                  >
                    {entry.body}
                  </div>
                </div>
              );
            })}
          </div>
          <form
            className={styles.chatForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (!message.trim()) return;
              onSendChat(message.trim());
              setMessage("");
            }}
          >
            <input
              className={styles.chatInput}
              value={message}
              placeholder="Type a message…"
              onChange={(e) => setMessage(e.target.value)}
            />
            <button type="submit" className={styles.chatSendBtn}>
              <Send size={15} />
            </button>
          </form>
        </div>
      )}

      {tab === "stats" && (
        <div className={styles.panelBodyScroll}>
          <button
            className={styles.copyButton}
            onClick={() => navigator.clipboard.writeText(JSON.stringify(state.stats, null, 2))}
          >
            Copy stats
          </button>
          <pre className={styles.preBlock}>{JSON.stringify(state.stats, null, 2)}</pre>
        </div>
      )}

      {tab === "logs" && (
        <div className={styles.panelBodyScroll}>
          <button
            className={styles.copyButton}
            onClick={() =>
              navigator.clipboard.writeText(
                state.logs.map((log) => `${log.kind}: ${log.message}`).join("\n"),
              )
            }
          >
            Copy logs
          </button>
          <pre className={styles.preBlock}>
            {state.logs.map((log) => `${log.kind}: ${log.message}`).join("\n")}
          </pre>
        </div>
      )}
    </aside>
  );
}
