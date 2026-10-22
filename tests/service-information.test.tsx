import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacidad/page";
import HelpPage from "@/app/ayuda/page";
import { AuthProvider } from "@/components/auth-provider";

describe("public service information", () => {
  it.each([
    { page: PrivacyPage, route: "/privacidad", related: "/ayuda" },
    { page: HelpPage, route: "/ayuda", related: "/privacidad" },
  ])("renders $route without an authenticated context and exposes its support route", ({ page, related }) => {
    // RootLayout supplies this provider even for signed-out public requests.
    const html = renderToStaticMarkup(createElement(AuthProvider, { children: createElement(page) }));
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);

    expect(links).toContain("mailto:alsdevstudio@alsdevstudio.com");
    expect(links).toContain(related);
    expect(links).toContain("/");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain("Continuar con Google");
  });
});
