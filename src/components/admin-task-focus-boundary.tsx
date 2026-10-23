"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, type ReactNode } from "react";

const AutoFocusContext = createContext<() => boolean>(() => true);

/** Navigation owns focus until the user interacts with the retained sensitive task. */
export function AdminTaskFocusBoundary({ active, noticeKey, children }: {
  active: boolean;
  noticeKey: string | null;
  children: ReactNode;
}) {
  const ownership = useRef({ active, noticeKey, suppressed: noticeKey !== null });
  useLayoutEffect(() => {
    if (ownership.current.noticeKey !== noticeKey) {
      ownership.current.noticeKey = noticeKey;
      ownership.current.suppressed = noticeKey !== null;
    }
    ownership.current.active = active;
  }, [active, noticeKey]);
  const canAutoFocus = useCallback(() => ownership.current.active && !ownership.current.suppressed, []);
  function interact() {
    if (ownership.current.active) ownership.current.suppressed = false;
  }
  return <AutoFocusContext.Provider value={canAutoFocus}>
    <div onPointerDownCapture={interact} onKeyDownCapture={interact} onClickCapture={interact}>{children}</div>
  </AutoFocusContext.Provider>;
}

export function useAdminTaskAutoFocus() {
  return useContext(AutoFocusContext);
}
