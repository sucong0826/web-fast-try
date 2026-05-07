import type { JoinRoomMessage, SignalMessage } from "../protocol/messages";
import { isSignalMessage } from "../protocol/messages";

export interface SignalingClientOptions {
  url: string;
  onMessage: (message: SignalMessage) => void;
  onStateChange: (state: "connecting" | "open" | "closed" | "error") => void;
  onError: (message: string) => void;
}

export class SignalingClient {
  private socket: WebSocket | null = null;

  constructor(private readonly options: SignalingClientOptions) {}

  connect(): Promise<void> {
    this.options.onStateChange("connecting");
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.url);
      this.socket = socket;

      socket.onopen = () => {
        this.options.onStateChange("open");
        resolve();
      };

      socket.onerror = () => {
        this.options.onStateChange("error");
        this.options.onError("Unable to connect to signaling server.");
        reject(new Error("Unable to connect to signaling server."));
      };

      socket.onclose = () => {
        this.options.onStateChange("closed");
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (isSignalMessage(parsed)) {
            this.options.onMessage(parsed);
          } else {
            this.options.onError("Received invalid signaling message.");
          }
        } catch {
          this.options.onError("Received malformed signaling JSON.");
        }
      };
    });
  }

  join(message: JoinRoomMessage): void {
    this.send(message);
  }

  send(message: SignalMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Signaling socket is not open.");
    }
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
