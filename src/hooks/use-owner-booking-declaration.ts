"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/client/api';
import { BOOKING_DECLARATION_TEXT_VERSION } from '@/lib/booking-declaration';
import type { BookingAdmissionCapability } from '@/lib/booking-admission';

export type OwnerBookingDeclarationView = {
  capability: BookingAdmissionCapability;
  origin: 'owner' | 'admin' | null;
  declaration: { textVersion: string; receiptId: string } | null;
  operation?: {
    requestId: string;
    action: 'declare' | 'withdraw' | 'classify' | 'suspend' | 'resume';
    phase: 'transitioning' | 'applied';
    previousRevision: number;
    targetRevision: number;
    occurredAt: number;
    textVersion?: string;
  };
  outcome?: 'applied' | 'pending';
};

export type OwnerBookingDeclarationController = {
  view: OwnerBookingDeclarationView | null;
  loading: boolean;
  error: string | null;
  pending: boolean;
  declare: () => Promise<void>;
  withdraw: () => Promise<void>;
  refresh: () => Promise<void>;
};

function generateRequestId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useOwnerBookingDeclaration(
  uid: string | undefined,
  authEpoch: number,
  businessId: string | undefined
): OwnerBookingDeclarationController {
  const sessionKey = uid && businessId ? JSON.stringify([uid, authEpoch, businessId]) : null;
  const activeSession = useRef(sessionKey);
  activeSession.current = sessionKey;

  const generation = useRef(0);
  const declareReqIdRef = useRef<string | null>(null);
  const withdrawReqIdRef = useRef<string | null>(null);

  const [view, setView] = useState<OwnerBookingDeclarationView | null>(null);
  const [loading, setLoading] = useState(Boolean(sessionKey));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const fetchView = useCallback(async (key: string, currentUid: string, currentBusinessId: string, signal?: AbortSignal) => {
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<OwnerBookingDeclarationView>(
        `/api/businesses/${encodeURIComponent(currentBusinessId)}/booking-declaration`,
        { signal },
        currentUid
      );
      if (activeSession.current === key && generation.current === gen) {
        setView(data);
        setError(null);
      }
    } catch (cause) {
      if (signal?.aborted) return;
      if (activeSession.current === key && generation.current === gen) {
        setError(errorMessage(cause));
      }
    } finally {
      if (activeSession.current === key && generation.current === gen) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    setView(null);
    setError(null);
    setPending(false);
    declareReqIdRef.current = null;
    withdrawReqIdRef.current = null;

    if (!sessionKey || !uid || !businessId) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    void fetchView(sessionKey, uid, businessId, controller.signal);

    return () => {
      controller.abort();
      generation.current++;
    };
  }, [sessionKey, uid, businessId, fetchView]);

  const declare = useCallback(async () => {
    if (pending || !uid || !businessId || !view || !sessionKey) return;
    setPending(true);
    setError(null);
    const reqId = declareReqIdRef.current || generateRequestId('dec');
    declareReqIdRef.current = reqId;
    try {
      const result = await apiFetch<OwnerBookingDeclarationView>(
        `/api/businesses/${encodeURIComponent(businessId)}/booking-declaration`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'declare',
            requestId: reqId,
            expectedRevision: view.capability.revision,
            textVersion: BOOKING_DECLARATION_TEXT_VERSION,
          }),
        },
        uid
      );
      if (activeSession.current === sessionKey) {
        declareReqIdRef.current = null;
        setView(result);
        setError(null);
      }
    } catch (cause) {
      if (activeSession.current === sessionKey) {
        setError(errorMessage(cause));
      }
    } finally {
      if (activeSession.current === sessionKey) {
        setPending(false);
      }
    }
  }, [pending, uid, businessId, view, sessionKey]);

  const withdraw = useCallback(async () => {
    if (pending || !uid || !businessId || !view || !sessionKey) return;
    setPending(true);
    setError(null);
    const reqId = withdrawReqIdRef.current || generateRequestId('wth');
    withdrawReqIdRef.current = reqId;
    try {
      const result = await apiFetch<OwnerBookingDeclarationView>(
        `/api/businesses/${encodeURIComponent(businessId)}/booking-declaration`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'withdraw',
            requestId: reqId,
            expectedRevision: view.capability.revision,
          }),
        },
        uid
      );
      if (activeSession.current === sessionKey) {
        withdrawReqIdRef.current = null;
        setView(result);
        setError(null);
      }
    } catch (cause) {
      if (activeSession.current === sessionKey) {
        setError(errorMessage(cause));
      }
    } finally {
      if (activeSession.current === sessionKey) {
        setPending(false);
      }
    }
  }, [pending, uid, businessId, view, sessionKey]);

  const refresh = useCallback(async () => {
    if (!sessionKey || !uid || !businessId) return;
    await fetchView(sessionKey, uid, businessId);
  }, [sessionKey, uid, businessId, fetchView]);

  return {
    view,
    loading,
    error,
    pending,
    declare,
    withdraw,
    refresh,
  };
}
