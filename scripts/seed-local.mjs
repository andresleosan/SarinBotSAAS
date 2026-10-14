import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { LOCAL_FIREBASE_PROJECT_ID, LOCAL_FIREBASE_AUTH_HOST, LOCAL_FIREBASE_FIRESTORE_HOST, LOCAL_TEST_ACCOUNTS } from '../src/lib/firebase/emulator-constants.mjs';

// This command cannot seed any cloud project or non-loopback emulator.
if (process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_FIREBASE_EMULATORS !== 'true'
  || process.env.FIREBASE_ADMIN_PROJECT_ID !== LOCAL_FIREBASE_PROJECT_ID
  || process.env.FIREBASE_AUTH_EMULATOR_HOST !== LOCAL_FIREBASE_AUTH_HOST
  || process.env.FIRESTORE_EMULATOR_HOST !== LOCAL_FIREBASE_FIRESTORE_HOST) {
  throw new Error('La inicialización de cuentas solo se admite desde pnpm run dev:local.');
}
const app=initializeApp({projectId:LOCAL_FIREBASE_PROJECT_ID},'sarin-local-accounts');
try {
  const result=await getAuth(app).importUsers(LOCAL_TEST_ACCOUNTS.map(user=>({uid:user.uid,email:user.email,displayName:user.displayName,emailVerified:true,
    providerData:[{providerId:'google.com',uid:user.providerUid,email:user.email,displayName:user.displayName}],
  })));
  if (result.failureCount) throw new Error('No se pudieron crear las cuentas locales.');
  console.log('Cuentas de prueba listas: admin@sarin.local, negocio@sarin.local y cliente@sarin.local.');
} finally { await deleteApp(app); }
