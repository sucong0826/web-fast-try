import { useState } from "react";
import type { MeetingState } from "../types";
import styles from "../styles.module.css";

export function SidePanel({
  state,
  onSendChat,
}: {
  state: MeetingState;
  onSendChat: (body: string) => void;
}) {
  const [tab, setTab] = useState<"chat" | "stats" | "logs">("chat");
  const [message, setMessage] = useState("");

  return (
    <aside className={styles.sidePanel}>
      <div className={styles.tabs}>
        {(["chat", "stats", "logs"] as const).map((name) => (
          <button key={name} className={tab === name ? styles.activeTab : ""} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
      {tab === "chat" && (
        <div className={styles.panelBody}>
          <div className={styles.chatList}>
            {state.chat.map((entry) => (
              <div key={entry.id} className={styles.chatMessage}>
                <strong>{entry.displayName}</strong>
                <p>{entry.body}</p>
              </div>
            ))}
          </div>
          <form
            className={styles.chatForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (!message.trim()) return;
              onSendChat(message.trim());
              setMessage("");
            }}
          >
            <input value={message} onChange={(event) => setMessage(event.target.value)} />
            <button>Send</button>
          </form>
        </div>
      )}
      {tab === "stats" && (
        <div className={styles.panelBody}>
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
        <div className={styles.panelBody}>
          <button
            className={styles.copyButton}
            onClick={() => navigator.clipboard.writeText(state.logs.map((log) => `${log.kind}: ${log.message}`).join("\n"))}
          >
            Copy logs
          </button>
          <pre className={styles.preBlock}>{state.logs.map((log) => `${log.kind}: ${log.message}`).join("\n")}</pre>
        </div>
      )}
    </aside>
  );
}
