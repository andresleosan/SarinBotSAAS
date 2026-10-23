"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function AdminModulePanel({ id, active, title, description, children }: {
  id: string;
  active: boolean;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) heading.current?.focus();
    wasActive.current = active;
  }, [active]);
  return (
    <section id={id} hidden={!active} inert={!active} aria-labelledby={`${id}-title`}>
      <header className="mb-5">
        <h2 ref={heading} id={`${id}-title`} tabIndex={-1} className="text-xl font-semibold text-sarin-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-sarin-muted">{description}</p>
      </header>
      {children}
    </section>
  );
}
