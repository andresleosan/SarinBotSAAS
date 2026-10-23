"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { buildAdminHref, resolveAdminLocation, type AdminDestination, type AdminLocation, type AdminPath } from "@/lib/admin-navigation";

export type AdminNavigationController = {
  location: AdminLocation;
  navigate: (destination: AdminDestination) => void;
};

type BoundaryProps = { children: (controller: AdminNavigationController) => ReactNode };

function NavigationLoading() {
  return <p role="status" className="p-6 text-sm text-sarin-muted">Cargando espacio de trabajo…</p>;
}

function AdminNavigationControllerBoundary({ children }: BoundaryProps) {
  const pathname = usePathname();
  // Next changes this object on hash-only canonical URL updates too.
  const search = useSearchParams();
  const router = useRouter();
  const [location, setLocation] = useState<AdminLocation | null>(null);
  useEffect(() => {
    // Next commits the browser URL in an insertion effect. Resolve after that
    // commit, or from hashchange, using all three parts of the same browser URL.
    // Retain the previous selection while the new URL commits; never unmount
    // an established workspace or resolve a new query against a previous hash.
    const readLocation = () => {
      const current = window.location;
      const next = resolveAdminLocation(current.pathname as AdminPath, current.search, current.hash);
      setLocation(previous => previous?.key === next.key ? previous : next);
    };
    readLocation();
    window.addEventListener('hashchange', readLocation);
    return () => window.removeEventListener('hashchange', readLocation);
  }, [pathname, search]);
  const navigate = useCallback((destination: AdminDestination) => {
    router.push(buildAdminHref(destination), { scroll: false });
  }, [router]);
  if (location === null) return <NavigationLoading />;
  return children({ location, navigate });
}

export function AdminNavigationBoundary({ children }: BoundaryProps) {
  return <Suspense fallback={<NavigationLoading />}><AdminNavigationControllerBoundary>{children}</AdminNavigationControllerBoundary></Suspense>;
}
