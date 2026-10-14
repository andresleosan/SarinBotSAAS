"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function SarinArrival() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [imagesReady, setImagesReady] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setMotionAllowed(!preference.matches);
    const updateVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    const images = Array.from(scene.querySelectorAll("img"));
    const updateImages = () => setImagesReady(images.every(image => image.complete && image.naturalWidth > 0));
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      if (entry) setInView(entry.isIntersecting && entry.intersectionRatio >= 0.3);
    }, { threshold: [0, 0.3] });

    updatePreference();
    updateVisibility();
    updateImages();
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    images.forEach(image => image.addEventListener("load", updateImages));
    if (observer) observer.observe(scene);
    else setInView(true);

    return () => {
      observer?.disconnect();
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
      images.forEach(image => image.removeEventListener("load", updateImages));
    };
  }, []);

  const animated = motionAllowed && imagesReady;
  const motion = !animated ? "static" : inView && pageVisible ? "running" : "paused";

  return <div ref={sceneRef} className="sarin-arrival" data-motion={motion}>
    <div className="sarin-arrival-content">
      <div className="sarin-arrival-actor" aria-hidden="true">
        <Image src="/brand/sarin-flight.png" alt="" width={320} height={383} loading="eager" className="sarin-arrival-flight" />
        <Image src="/brand/sarin-welcome.png" alt="" width={320} height={480} loading="eager" className="sarin-arrival-landed" />
      </div>
      <div className="sarin-arrival-greeting"><p><strong>¡Hola, soy Sarin!</strong><span>Tu asistente para los días ocupados.</span></p></div>
    </div>
  </div>;
}
