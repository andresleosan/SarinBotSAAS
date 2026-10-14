"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "@/components/auth-provider";
import { getFirebaseClient } from "@/lib/firebase/client";
import { errorMessage } from "@/lib/client/api";
import type { Business } from "@/types/firestore";

export function useBusiness() {
  const { user } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setBusiness(null);
    setError(null);
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      return onSnapshot(
        query(
          collection(getFirebaseClient().db, "businesses"),
          where("ownerUid", "==", user.uid),
        ),
        (snapshot) => {
          const first = snapshot.docs[0];
          setBusiness(
            first ? ({ ...first.data(), id: first.id } as Business) : null,
          );
          setLoading(false);
        },
        (cause) => {
          setError(errorMessage(cause));
          setLoading(false);
        },
      );
    } catch (cause) {
      setError(errorMessage(cause));
      setLoading(false);
    }
  }, [user]);
  return { business, loading, error };
}
