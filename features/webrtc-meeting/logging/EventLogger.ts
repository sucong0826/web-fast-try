export type MeetingLogKind = "signaling" | "peer" | "media" | "stats" | "ui" | "error";

export interface MeetingLogEvent {
  id: string;
  kind: MeetingLogKind;
  message: string;
  data?: unknown;
  createdAt: number;
}

export function createEventLogger(limit = 300) {
  let events: MeetingLogEvent[] = [];

  function append(kind: MeetingLogKind, message: string, data?: unknown): MeetingLogEvent {
    const event: MeetingLogEvent = {
      id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      message,
      data,
      createdAt: Date.now(),
    };
    events = [...events, event].slice(-limit);
    return event;
  }

  function getEvents(): MeetingLogEvent[] {
    return events;
  }

  function clear(): void {
    events = [];
  }

  function toText(): string {
    return events
      .map((event) => {
        const data = event.data === undefined ? "" : ` ${JSON.stringify(event.data)}`;
        return `${new Date(event.createdAt).toISOString()} [${event.kind}] ${event.message}${data}`;
      })
      .join("\n");
  }

  return { append, getEvents, clear, toText };
}
