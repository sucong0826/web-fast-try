"use client";

import React, { createContext, useContext, useMemo, useReducer } from "react";
import { createInitialMeetingState, meetingReducer } from "./meetingReducer";
import type { MeetingAction } from "./meetingReducer";
import type { MeetingState } from "../types";

const MeetingStateContext = createContext<MeetingState | null>(null);
const MeetingDispatchContext = createContext<React.Dispatch<MeetingAction> | null>(null);

export function MeetingProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(meetingReducer, undefined, createInitialMeetingState);
  const stableState = useMemo(() => state, [state]);

  return (
    <MeetingStateContext.Provider value={stableState}>
      <MeetingDispatchContext.Provider value={dispatch}>
        {children}
      </MeetingDispatchContext.Provider>
    </MeetingStateContext.Provider>
  );
}

export function useMeetingState(): MeetingState {
  const state = useContext(MeetingStateContext);
  if (!state) throw new Error("useMeetingState must be used within MeetingProvider");
  return state;
}

export function useMeetingDispatch(): React.Dispatch<MeetingAction> {
  const dispatch = useContext(MeetingDispatchContext);
  if (!dispatch) throw new Error("useMeetingDispatch must be used within MeetingProvider");
  return dispatch;
}
