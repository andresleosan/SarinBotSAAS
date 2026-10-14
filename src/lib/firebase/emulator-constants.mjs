/** Explicit, isolated local resources. These are never production credentials. */
export const LOCAL_FIREBASE_PROJECT_ID = "demo-sarin-bot";
export const LOCAL_FIREBASE_AUTH_HOST = "127.0.0.1:9099";
export const LOCAL_FIREBASE_FIRESTORE_HOST = "127.0.0.1:8080";
export const LOCAL_SUPERADMIN_UID = "sarin-local-admin";

export const LOCAL_TEST_ACCOUNTS = Object.freeze([
  Object.freeze({
    role: "admin",
    uid: LOCAL_SUPERADMIN_UID,
    email: "admin@sarin.local",
    displayName: "Administrador local",
    providerUid: `${LOCAL_SUPERADMIN_UID}-google`,
  }),
  Object.freeze({
    role: "owner",
    uid: "sarin-local-owner",
    email: "negocio@sarin.local",
    displayName: "Negocio local",
    providerUid: "sarin-local-owner-google",
  }),
  Object.freeze({
    role: "client",
    uid: "sarin-local-client",
    email: "cliente@sarin.local",
    displayName: "Cliente local",
    providerUid: "sarin-local-client-google",
  }),
]);
