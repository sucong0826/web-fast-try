import type { FlushSignal, FrameMetadata, MetadataChannelMessage } from "./types";

export interface MetadataSender {
  sendMetadata(meta: Omit<FrameMetadata, "kind">): void;
  sendFlush(): void;
}

export interface MetadataReceiver {
  onMessage(handler: (message: MetadataChannelMessage) => void): void;
  close(): void;
}

export function createMetadataSender(port: MessagePort): MetadataSender {
  return {
    sendMetadata(meta) {
      const message: FrameMetadata = { kind: "metadata", ...meta };
      port.postMessage(message);
    },
    sendFlush() {
      const message: FlushSignal = { kind: "flush" };
      port.postMessage(message);
    },
  };
}

export function createMetadataReceiver(port: MessagePort): MetadataReceiver {
  let handler: ((message: MetadataChannelMessage) => void) | null = null;
  port.onmessage = (event: MessageEvent<MetadataChannelMessage>) => {
    handler?.(event.data);
  };
  port.start?.();
  return {
    onMessage(h) {
      handler = h;
    },
    close() {
      port.onmessage = null;
      port.close();
    },
  };
}
