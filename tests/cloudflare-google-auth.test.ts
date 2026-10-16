import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudflareCredentialConfiguration } from "../scripts/lib/cloudflare-credentials.mjs";

// Resolve the exact Google client used by Firebase Admin, without adding a dependency.
const require = createRequire(import.meta.url);
const firebaseRequire = createRequire(require.resolve("firebase-admin/app"));
const { GoogleAuth } = firebaseRequire("google-auth-library");
const googleRequire = createRequire(firebaseRequire.resolve("google-auth-library"));
const { Gaxios } = googleRequire("gaxios");

const AUDIENCE = "//iam.googleapis.com/projects/153690559048/locations/global/workloadIdentityPools/sarin-cloudflare/providers/worker-oidc";
const SOURCE_URL = "http://sarin-google.internal/token";
const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_URL = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/sarin-runtime@sarinbotsaas.iam.gserviceaccount.com:generateAccessToken";
const SCOPES = ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/identitytoolkit"];
const START = Date.UTC(2026, 9, 16, 12);
const runtime = {
  FIREBASE_ADMIN_CREDENTIAL_MODE: "adc",
  FIREBASE_ADMIN_PROJECT_ID: "sarinbotsaas",
  FIREBASE_WIF_AUDIENCE: AUDIENCE,
  FIREBASE_WIF_SERVICE_ACCOUNT_EMAIL: "sarin-runtime@sarinbotsaas.iam.gserviceaccount.com",
};

interface TransportOptions {
  url: string | URL;
  method?: string;
  headers?: HeadersInit;
  data?: unknown;
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  data: unknown;
}

function syntheticSubject(generation: number): string {
  return `synthetic.subject-${generation}.signature`;
}

function syntheticFederated(generation: number): string {
  return `synthetic-federated-${generation}`;
}

function syntheticAccess(generation: number): string {
  return `synthetic-access-${generation}`;
}

function configuration() {
  const config = createCloudflareCredentialConfiguration(runtime);
  if (!config) throw new Error("Startup must create the reviewed URL-sourced ADC configuration.");
  return config;
}

function transportFixture() {
  const calls: RecordedRequest[] = [];
  const controls = { missingSubject: false, denyImpersonation: false };
  let sourceGeneration = 0;
  let exchangeGeneration = 0;

  // Inspection of google-auth-library shows that STS owns a separate Gaxios
  // instance. Intercept their common I/O boundary, leaving all GoogleAuth,
  // IdentityPoolClient, URL supplier, token exchange and cache logic real.
  vi.spyOn(Gaxios.prototype, "request").mockImplementation(async (...args: unknown[]) => {
    const input = args[0];
    if (!input || typeof input !== "object" || !("url" in input)) throw new Error("Unexpected transport options.");
    const options = input as TransportOptions;
    const url = String(options.url);
    calls.push({ url, method: options.method ?? "GET", headers: new Headers(options.headers), data: options.data });
    let data: unknown;
    if (url === SOURCE_URL) {
      sourceGeneration += 1;
      data = controls.missingSubject ? {} : { subject_token: syntheticSubject(sourceGeneration) };
    } else if (url === STS_URL) {
      exchangeGeneration += 1;
      data = { access_token: syntheticFederated(exchangeGeneration), expires_in: 3600, token_type: "Bearer", issued_token_type: "urn:ietf:params:oauth:token-type:access_token" };
    } else if (url === IAM_URL) {
      if (controls.denyImpersonation) throw new Error("Synthetic impersonation denial.");
      data = { accessToken: syntheticAccess(exchangeGeneration), expireTime: new Date(Date.now() + 3_600_000).toISOString() };
    } else {
      throw new Error("Unexpected network destination blocked by the test transport.");
    }
    return { data, status: 200, statusText: "OK", headers: new Headers(), config: options };
  });
  // Any accidental escape from the installed client's transport fails locally.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network access is disabled in this synthetic integration."); }));
  return { calls, controls };
}

async function clientFromStartup() {
  const auth = new GoogleAuth({ projectId: "sarinbotsaas", credentials: configuration(), scopes: SCOPES });
  const client = await auth.getClient();
  expect(client.constructor.name).toBe("IdentityPoolClient");
  return { auth, client };
}

describe("installed GoogleAuth with Cloudflare URL-sourced WIF ADC", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("exchanges the private URL assertion through STS and service-account impersonation", async () => {
    const { calls } = transportFixture();
    const { auth, client } = await clientFromStartup();
    const result = await client.getAccessToken();
    expect(result.token === syntheticAccess(1)).toBe(true);
    expect(calls.map(({ url, method }) => ({ url, method }))).toEqual([
      { url: SOURCE_URL, method: "GET" },
      { url: STS_URL, method: "POST" },
      { url: IAM_URL, method: "POST" },
    ]);
    const exchange = new URLSearchParams(String(calls[1].data));
    expect(exchange.get("audience")).toBe(AUDIENCE);
    expect(exchange.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(exchange.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:jwt");
    expect(exchange.get("requested_token_type")).toBe("urn:ietf:params:oauth:token-type:access_token");
    expect(exchange.get("subject_token") === syntheticSubject(1)).toBe(true);
    expect(exchange.get("scope")).toBe("https://www.googleapis.com/auth/cloud-platform");
    expect(calls[1].headers.has("Authorization")).toBe(false);
    expect(calls[2].headers.get("Authorization") === `Bearer ${syntheticFederated(1)}`).toBe(true);
    expect(calls[2].data).toEqual({ scope: SCOPES, lifetime: "3600s" });
    expect((await auth.getCredentials()).client_email).toBe("sarin-runtime@sarinbotsaas.iam.gserviceaccount.com");
    expect(await auth.getProjectId()).toBe("sarinbotsaas");
    expect(calls).toHaveLength(3);
  });

  it("caches the impersonated token and renews the complete chain before expiration", async () => {
    const { calls } = transportFixture();
    const { client } = await clientFromStartup();
    const initial = await client.getAccessToken();
    vi.setSystemTime(START + 54 * 60_000);
    const cached = await client.getAccessToken();
    expect(cached.token === initial.token).toBe(true);
    expect(calls).toHaveLength(3);
    vi.setSystemTime(START + 56 * 60_000);
    const renewed = await Promise.all(Array.from({ length: 4 }, () => client.getAccessToken()));
    expect(renewed.every((result) => result.token === syntheticAccess(2))).toBe(true);
    expect(calls.map(({ url }) => url)).toEqual([SOURCE_URL, STS_URL, IAM_URL, SOURCE_URL, STS_URL, IAM_URL]);
    const secondExchange = new URLSearchParams(String(calls[4].data));
    expect(secondExchange.get("subject_token") === syntheticSubject(2)).toBe(true);
    expect(calls[5].headers.get("Authorization") === `Bearer ${syntheticFederated(2)}`).toBe(true);
  });

  it("does not contact STS or IAM when the internal source omits its assertion", async () => {
    const { calls, controls } = transportFixture();
    controls.missingSubject = true;
    const { client } = await clientFromStartup();
    await expect(client.getAccessToken()).rejects.toThrow();
    expect(calls.map(({ url }) => url)).toEqual([SOURCE_URL]);
  });

  it("does not cache a failed impersonation and recovers through a fresh assertion", async () => {
    const { calls, controls } = transportFixture();
    controls.denyImpersonation = true;
    const { client } = await clientFromStartup();
    await expect(client.getAccessToken()).rejects.toThrow("Synthetic impersonation denial.");
    controls.denyImpersonation = false;
    expect((await client.getAccessToken()).token === syntheticAccess(2)).toBe(true);
    expect(calls.map(({ url }) => url)).toEqual([SOURCE_URL, STS_URL, IAM_URL, SOURCE_URL, STS_URL, IAM_URL]);
  });
});
