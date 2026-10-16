"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { ChatMessage, ChatToolResult, ChatResponse } from "@/types/chat";

interface ChatParams {
  mode: "sarin_onboarding" | "sarin_client" | "sarin_owner_copilot";
  tenantId: string;
  actorUid?: string;
  debounceMs?: number;
  onToolExecuted?: (toolName: string, result: Record<string, unknown>) => void;
}
interface Batch {
  texts: string[];
  requestId: string;
  stateVersion?: number;
}
type Turn = { role: "user" | "assistant"; content: string };

// Keep the full conversation on screen while respecting the model API's
// per-turn and context limits. More messages always become a later turn.
function takeBatch(buffer: string[]): Batch | null {
  if (!buffer.length) return null;
  const texts: string[] = [];
  let length = 0;
  while (buffer.length) {
    const remaining = 12000 - length - (texts.length ? 1 : 0);
    if (remaining <= 0) break;
    const next = buffer[0];
    if (next.length > remaining && texts.length) break;
    texts.push(next.slice(0, remaining));
    length += Math.min(next.length, remaining) + (texts.length > 1 ? 1 : 0);
    if (next.length > remaining) buffer[0] = next.slice(remaining);
    else buffer.shift();
  }
  return { texts, requestId: crypto.randomUUID() };
}

export function useDebouncedChat({
  mode,
  tenantId,
  actorUid = '',
  debounceMs = 2500,
  onToolExecuted,
}: ChatParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isWaitingBatch, setIsWaitingBatch] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [configurationDraft, setConfigurationDraft] = useState<ChatResponse['configurationDraft']>();
  const stateVersion = useRef<number | undefined>(undefined);
  const pending = useRef<string[]>([]);
  const failed = useRef<Batch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const ready = useRef(false);
  const generation = useRef(0);
  const callback = useRef(onToolExecuted);
  callback.current = onToolExecuted;
  const flushRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setConfigurationDraft(undefined);
    stateVersion.current = undefined;
    pending.current = [];
    failed.current = null;
    busy.current = false;
    ready.current = false;
    setMessages([]);
    setError(null);
    setErrorCode(null);
    setIsGenerating(false);
    setIsWaitingBatch(false);
    return () => {
      generation.current++;
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mode, tenantId, actorUid]);

  const flush = useCallback(async () => {
    if (busy.current || !tenantId) return;
    const batch = failed.current ?? takeBatch(pending.current);
    if (!batch) return;
    if (!failed.current) batch.stateVersion = stateVersion.current;
    failed.current = null;
    ready.current = pending.current.length > 0 && timer.current === null;
    busy.current = true;
    const currentGeneration = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setIsWaitingBatch(pending.current.length > 0);
    setIsGenerating(true);
    setError(null);
    const userTurn: Turn = { role: "user", content: batch.texts.join("\n") };
    try {
      const data = await apiFetch<ChatResponse>("/api/sarin/chat", {
        method: "POST",
        signal: abort.signal,
        body: JSON.stringify({
          mode,
          tenantId,
          requestId: batch.requestId,
          messages: [userTurn],
          ...(batch.stateVersion !== undefined ? { stateVersion: batch.stateVersion } : {}),
        }),
      });
      if (generation.current !== currentGeneration) return;
      setErrorCode(null);
      stateVersion.current = data.stateVersion;
      setConfigurationDraft(data.configurationDraft);
      setMessages((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply,
          timestamp: Date.now(),
        },
      ]);
      for (const tool of data.toolResults ?? [])
        callback.current?.(tool.name, tool.result);
    } catch (cause) {
      if (generation.current !== currentGeneration || abort.signal.aborted)
        return;
      const code = cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : null;
      setErrorCode(code);
      failed.current = code === "REQUEST_ALREADY_COMPLETED" ? null : code === 'CHAT_STATE_CONFLICT' ? { texts: batch.texts, requestId: crypto.randomUUID() } : batch;
      if (code === 'CHAT_STATE_CONFLICT') stateVersion.current = undefined;
      if (code === "REQUEST_ALREADY_COMPLETED") {
        ready.current = false;
        setIsWaitingBatch(false);
      }
      setError(errorMessage(cause));
    } finally {
      if (generation.current === currentGeneration) {
        busy.current = false;
        setIsGenerating(false);
        if (ready.current && !failed.current) void flushRef.current();
      }
    }
  }, [mode, tenantId, actorUid]);
  flushRef.current = flush;

  const sendMessage = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || !tenantId || errorCode === "AI_QUOTA_EXHAUSTED") return;
      if (errorCode === "REQUEST_ALREADY_COMPLETED") {
        setError(null);
        setErrorCode(null);
      }
      setMessages((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: "user",
          content,
          timestamp: Date.now(),
        },
      ]);
      pending.current.push(content);
      ready.current = false;
      setIsWaitingBatch(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        ready.current = true;
        if (!busy.current && !failed.current) void flushRef.current();
      }, debounceMs);
    },
    [debounceMs, tenantId, errorCode],
  );

  const retry = useCallback(() => {
    if (!busy.current && failed.current) void flushRef.current();
  }, []);
  return { messages, sendMessage, isWaitingBatch, isGenerating, error, retry, configurationDraft, quotaExhausted: errorCode === "AI_QUOTA_EXHAUSTED", requestAlreadyCompleted: errorCode === "REQUEST_ALREADY_COMPLETED" };
}
