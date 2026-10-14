import { parseLocalArguments } from './lib/local-development.mjs';
import { LOCAL_FIREBASE_AUTH_HOST, LOCAL_TEST_ACCOUNTS } from '../src/lib/firebase/emulator-constants.mjs';

// Exercises the actual local SDK/REST -> Next API -> Admin SDK -> Firestore path.
// This script accepts a loopback port only, never a production URL or token.
const options=parseLocalArguments(process.argv.slice(2));
if(options.help){console.log('Uso: pnpm run test:local [--port 3030]\nRequiere pnpm run dev:local activo. Solo cuentas de prueba; no necesita Ollama.');process.exit(0);}
const base=`http://127.0.0.1:${options.port}`;
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
async function json(url,init={}) {
  const response=await fetch(url,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>null);
  return {response,data};
}
async function login(account) {
  const {response,data}=await json(`http://${LOCAL_FIREBASE_AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=sarin-local-emulator-only`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({requestUri:base,returnSecureToken:true,
      postBody:new URLSearchParams({providerId:'google.com',id_token:JSON.stringify({sub:account.providerUid,email:account.email,email_verified:true,name:account.displayName})}).toString()}),
  });
  assert(response.ok && typeof data?.idToken==='string','No se pudo autenticar la cuenta del emulador.');
  assert(data.localId===account.uid,'El emulador no corresponde a las cuentas locales preparadas.');
  return data.idToken;
}
const request=(path,token,method='GET',body)=>json(`${base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
try {
  const health=await json(`http://${LOCAL_FIREBASE_AUTH_HOST}/`);
  assert(health.response.ok && health.data?.authEmulator?.ready===true,'Inicia pnpm run dev:local antes de esta prueba.');
  const admin=await login(LOCAL_TEST_ACCOUNTS.find(account=>account.role==='admin'));
  const client=await login(LOCAL_TEST_ACCOUNTS.find(account=>account.role==='client'));
  const [session,consoleResult,forbiddenConsole,forbiddenVault,emptyVault]=await Promise.all([
    request('/api/session',admin),request('/api/admin',admin),request('/api/admin',client),request('/api/sarin/vault',client,'POST',{}),request('/api/sarin/vault',admin,'POST',{}),
  ]);
  assert(session.response.ok && session.data?.isSuperadmin===true,'La sesión local no habilitó el UID administrador.');
  assert(consoleResult.response.ok && Array.isArray(consoleResult.data?.businesses),'La consola no pudo consultar Firestore local.');
  assert(forbiddenConsole.response.status===403 && forbiddenVault.response.status===403,'El cliente accedió a una ruta reservada.');
  assert(emptyVault.response.status===400,'La API Vault no validó el contenido después de autorizar al administrador.');
  console.log('OK: autenticación emulada, UID administrador, Admin SDK/Firestore y rechazo 403 del cliente.');
  const [billing,business]=await Promise.all([request('/api/billing',admin),request('/api/businesses',admin)]);
  assert(billing.response.ok && Array.isArray(billing.data?.receipts) && Array.isArray(billing.data?.settings?.bankAccounts),'La facturación local no cargó su estado real.');
  assert(business.response.ok && 'business' in business.data,'La configuración de negocio no respondió.');
  console.log('OK: facturación y configuración sin datos bancarios ni negocio inventados.');
  console.log('Prueba local completada. No se crearon negocios, pagos ni conversaciones y no se ejecutó inferencia.');
}catch(error){console.error(error instanceof Error?error.message:'Falló la prueba local.');process.exitCode=1;}
