"use client";

import { useState } from "react";

function googlePhotoUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const googleHost = url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com");
    if (url.protocol !== "https:" || !googleHost || url.username || url.password || url.port) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function UserAvatar({ name, photoURL }: { name: string; photoURL?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = googlePhotoUrl(photoURL);
  const label = name.trim() || "Mi cuenta";
  if (url && url !== failedUrl) {
    return <img key={url} src={url} alt={`Foto de ${label}`} width={32} height={32} referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} className="h-8 w-8 shrink-0 rounded-full bg-sarin-soft object-cover" />;
  }
  return <span role="img" aria-label={label} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sarin-soft text-xs font-semibold text-sarin-blue">{Array.from(label)[0].toUpperCase()}</span>;
}
