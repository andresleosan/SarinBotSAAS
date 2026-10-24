"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useAccountConsent } from '@/components/consent-panel';
import { useOwnerConfigurationSession, type ConfigurationScope } from '@/components/owner-configuration-provider';
import type { OwnerConfigurationController } from '@/components/owner-configuration-workspace';
import { useBusiness } from '@/hooks/useBusiness';
import { useBookingDataPolicy } from '@/hooks/useBookingDataPolicy';
import { configurationFingerprint, createOwnerConfigurationDraft, validateOwnerConfiguration, type ConfigurationIssue } from '@/lib/owner-configuration';
import { errorMessage } from '@/lib/client/api';
import { isSubscriptionAllowed } from '@/lib/sarin/subscription';
import type { Business } from '@/types/firestore';

const sameScope = (left: ConfigurationScope | null, right: ConfigurationScope | null) => Boolean(left && right && left.uid === right.uid && left.authEpoch === right.authEpoch && left.businessId === right.businessId);

type VerifiedEntry = { key: string; business: Business | null; ignoredCacheFingerprint: string | null };

export function useOwnerConfiguration() {
  const { user, authEpoch, isCurrentSession } = useAuth();
  const accountConsent = useAccountConsent();
  const cached = useBusiness();
  const owner = useOwnerConfigurationSession();
  const [entry, setEntry] = useState<VerifiedEntry | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ConfigurationIssue[]>([]);
  const [attempt, setAttempt] = useState(0);
  const uid = user?.uid;
  const entryKey = JSON.stringify([uid, authEpoch, cached.business?.id ?? null]);
  const identity = useRef({ uid, authEpoch, entryKey });
  identity.current = { uid, authEpoch, entryKey };
  const cacheRef = useRef(cached); cacheRef.current = cached;
  const savedRef = useRef<unknown>(null);
  const policy = useBookingDataPolicy(uid, entry?.key === entryKey ? entry.business?.id : undefined);
  const { verifyOwner, protect, revoke, observe, edit, go, discard, save, checkOutcome, loadExternal } = owner;

  useEffect(() => {
    if (!uid) return;
    let active = true;
    setEntry(null);
    setProbeError(null);
    setIssues([]);
    const cacheAtEntry = cacheRef.current.business;
    const ignoredCacheFingerprint = cacheAtEntry ? configurationFingerprint(createOwnerConfigurationDraft(cacheAtEntry)) : null;
    if (cached.error && owner.authority.scope) protect(owner.authority.scope, cached.error);
    void verifyOwner({ uid, authEpoch, expectedBusinessId: cacheAtEntry?.id }).then(business => {
      if (!active || identity.current.entryKey !== entryKey) return;
      setEntry({ key: entryKey, business, ignoredCacheFingerprint });
    }).catch(cause => {
      if (active && identity.current.entryKey === entryKey) setProbeError(errorMessage(cause));
    });
    return () => { active = false; };
    // A cached business is deliberately not evidence of ownership. Each entry/error episode gets its own probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authEpoch, entryKey, cached.error, attempt, verifyOwner, protect]);

  const freshEntry = entry?.key === entryKey ? entry : null;
  const expectedScope: ConfigurationScope | null = uid && freshEntry?.business ? { uid, authEpoch, businessId: freshEntry.business.id } : null;
  const currentIdentity = Boolean(uid && isCurrentSession(uid, authEpoch));
  const verified = currentIdentity && (!cached.business || cached.business.ownerUid === uid) && !cached.error && Boolean(freshEntry?.business) && owner.authority.state === 'verified' && sameScope(owner.authority.scope, expectedScope) && sameScope(owner.session?.scope ?? null, expectedScope);

  useEffect(() => {
    const business = cached.business;
    if (!business || !expectedScope || business.id !== expectedScope.businessId) return;
    if (business.ownerUid !== expectedScope.uid) { revoke(expectedScope, 'No tienes acceso a este negocio.'); return; }
    if (!verified) return;
    const fingerprint = configurationFingerprint(createOwnerConfigurationDraft(business));
    const freshFingerprint = configurationFingerprint(createOwnerConfigurationDraft(freshEntry!.business!));
    // The poller's original cache may predate the authoritative entry read.
    if (fingerprint === freshEntry!.ignoredCacheFingerprint && fingerprint !== freshFingerprint) return;
    observe(expectedScope, business);
    if (business !== freshEntry!.business) setEntry(previous => previous?.key === entryKey ? { ...previous, business } : previous);
  }, [cached.business, verified, entryKey, freshEntry, expectedScope?.uid, expectedScope?.authEpoch, expectedScope?.businessId, observe, revoke]);

  useEffect(() => {
    if (!verified || !owner.session?.savedConfiguration || savedRef.current === owner.session.savedConfiguration) return;
    savedRef.current = owner.session.savedConfiguration;
    cacheRef.current.refresh();
  }, [verified, owner.session?.savedConfiguration]);

  const retryAuthority = useCallback(() => {
    cacheRef.current.refresh();
    setAttempt(value => value + 1);
  }, []);
  const onLogoSaved = useCallback((business: Business) => {
    if (!uid || business.ownerUid !== uid || identity.current.entryKey !== entryKey) return;
    cacheRef.current.setBusiness(business);
    setEntry(previous => previous?.key === entryKey && previous.business?.id === business.id ? { ...previous, business } : previous);
  }, [uid, entryKey]);

  const session = verified ? owner.session : null;
  const business = verified ? freshEntry!.business : null;
  const busy = session?.phase === 'checking' || session?.phase === 'saving';
  const writeBlocked = busy || Boolean(session?.pendingCommand) || !accountConsent.active || !policy.ready || !policy.capability || !isSubscriptionAllowed(business);
  const controller: OwnerConfigurationController | null = session && expectedScope ? {
    session: issues.length ? { ...session, issues } : session,
    configured: Boolean(business?.sarinConfig.onboardingCompleted),
    dirty: configurationFingerprint(session.draft) !== configurationFingerprint(session.baseline),
    busy,
    writeBlocked,
    canSave: !writeBlocked,
    change: next => { if (writeBlocked) return; setIssues([]); edit(expectedScope, next); },
    go: section => { setIssues([]); go(expectedScope, section); },
    review: () => {
      if (!policy.capability) return;
      const nextIssues = validateOwnerConfiguration(session.draft, policy.capability);
      setIssues(nextIssues);
      go(expectedScope, nextIssues[0]?.section ?? 'review');
    },
    save: reviewedExternalFingerprint => {
      if (writeBlocked || !policy.capability) return;
      setIssues([]);
      void save({ scope: expectedScope, capability: policy.capability, consentActive: accountConsent.active, reviewedExternalFingerprint });
    },
    discard: () => { if (!writeBlocked) { setIssues([]); discard(expectedScope); } },
    checkOutcome: () => { void checkOutcome(expectedScope); },
    loadExternal: () => { if (!writeBlocked) { setIssues([]); loadExternal(expectedScope); } },
  } : null;

  return {
    loading: cached.loading || (!freshEntry && !probeError && owner.authority.state !== 'unavailable' && owner.authority.state !== 'revoked'),
    error: cached.error || probeError || owner.authority.error,
    business,
    capability: policy.capability,
    policyReady: policy.ready,
    policyError: policy.error,
    retryPolicy: policy.refresh,
    consentActive: accountConsent.active,
    authority: owner.authority,
    retryAuthority,
    controller,
    onLogoSaved,
    // A successful authoritative absence can still explain the existing purchase/invitation flow.
    absent: Boolean(freshEntry && !freshEntry.business && owner.authority.state === 'revoked' && owner.authority.error === null),
  };
}
