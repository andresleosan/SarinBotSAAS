import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketingHome } from "@/components/marketing-home";

const links = (html: string) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => ({
  href: match[1],
  label: match[2].replace(/<[^>]*>/g, "").trim(),
}));

describe("marketing entry links", () => {
  it("keeps standalone visitors on useful sections while application access is not enabled", () => {
    const html = renderToStaticMarkup(createElement(MarketingHome, { standalone: true }));
    const anchors = links(html);
    expect(anchors.some(link => /^\/(dashboard|admin|api|b)(\/|$)/.test(link.href))).toBe(false);
    expect(anchors.some(link => link.href === "#planes")).toBe(true);
    expect(anchors.some(link => link.href === "#empezar")).toBe(true);
    expect(anchors.some(link => /^\/(privacidad|ayuda)(\/|$)/.test(link.href))).toBe(false);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    for (const link of anchors.filter(link => link.href.startsWith("#"))) expect(ids.has(link.href.slice(1))).toBe(true);
  });

  it("opens business actions only at the explicitly enabled public application origin", () => {
    const html = renderToStaticMarkup(createElement(MarketingHome, { standalone: true, publicAppUrl: "https://sarinbotsaas.pages.dev/" }));
    const anchors = links(html);
    expect(anchors.find(link => link.label === "Mi negocio")?.href).toBe("https://sarinbotsaas.pages.dev/dashboard");
    expect(anchors.find(link => link.label === "Empezar por $5.000 COP")?.href).toBe("https://sarinbotsaas.pages.dev/dashboard/onboarding");
    expect(anchors.some(link => link.href === "/admin")).toBe(false);
    expect(anchors.find(link => link.label === "Privacidad")?.href).toBe("https://sarinbotsaas.pages.dev/privacidad");
    expect(anchors.find(link => link.label === "Ayuda")?.href).toBe("https://sarinbotsaas.pages.dev/ayuda");
  });

  it("preserves application entry routes on the full application homepage", () => {
    const anchors = links(renderToStaticMarkup(createElement(MarketingHome)));
    expect(anchors.find(link => link.label === "Mi negocio")?.href).toBe("/dashboard");
    expect(anchors.find(link => link.label === "Empezar por $5.000 COP")?.href).toBe("/dashboard/onboarding");
    expect(anchors.find(link => link.label === "Privacidad")?.href).toBe("/privacidad");
    expect(anchors.find(link => link.label === "Ayuda")?.href).toBe("/ayuda");
  });

  it.each([
    "http://sarinbotsaas.pages.dev",
    "javascript:alert(1)",
    "//sarinbotsaas.pages.dev",
    "https://user:secret@sarinbotsaas.pages.dev",
    "https://sarinbotsaas.pages.dev?token=secret",
    "https://sarinbotsaas.pages.dev#dashboard",
    "https://sarinbotsaas.pages.dev?",
    "https://sarinbotsaas.pages.dev#",
    "https://sarinbotsaas.pages.dev/dashboard",
    "https://sarinbotsaas.pages.dev:8443",
    "https://sarinbotsaas.pages.dev.example.com",
    "https://localhost",
  ])("rejects an unsafe or unapproved application destination: %s", publicAppUrl => {
    expect(() => renderToStaticMarkup(createElement(MarketingHome, { standalone: true, publicAppUrl }))).toThrow("SARIN_PUBLIC_APP_URL");
  });
});
