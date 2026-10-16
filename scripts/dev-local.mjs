import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { javaMajorVersion, localDevelopmentEnvironment, parseLocalArguments, pnpmFirebaseInvocation } from './lib/local-development.mjs';
import { LOCAL_FIREBASE_AUTH_HOST } from '../src/lib/firebase/emulator-constants.mjs';

const options=parseLocalArguments(process.argv.slice(2));
if (options.help) {
  console.log('Uso: pnpm run dev:local [--port 3030]\nInicia Auth y Firestore locales (proyecto demo-sarin-bot) y Next en loopback.\nRequiere pnpm 11.23.0, Node 24 y Java 21+. No necesita proyecto Firebase ni credenciales.');
  process.exit(0);
}
const root=fileURLToPath(new URL('../',import.meta.url));
const children=new Set(); let stopping=false;

function launch(args,env,command=process.execPath) {
  const child=spawn(command,args,{cwd:root,env,stdio:'inherit',windowsHide:true,detached:process.platform!=='win32'});
  children.add(child);
  child.on('error',()=>void shutdown(1));
  child.on('exit',(code)=>{children.delete(child);if(!stopping)void shutdown(code??1);});
  return child;
}
async function shutdown(code=0) {
  if (stopping) return;
  stopping=true;
  await Promise.all([...children].map(child=>new Promise(resolve=>{
    if (child.exitCode!==null || !child.pid) {resolve();return;}
    if(process.platform==='win32') {
      const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
      killer.on('error',resolve);killer.on('exit',resolve);
    } else {
      try {process.kill(-child.pid,'SIGTERM');}catch{/* Child already exited. */}
      child.once('exit',resolve);setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}resolve();},3000).unref();
    }
  })));
  process.exit(code);
}
process.on('SIGINT',()=>void shutdown(0));process.on('SIGTERM',()=>void shutdown(0));

function occupied(port) {
  return new Promise(resolve=>{
    const socket=createConnection({host:'127.0.0.1',port});
    socket.once('connect',()=>{socket.destroy();resolve(true);});
    socket.once('error',()=>{socket.destroy();resolve(false);});
    socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});
  });
}
async function javaHome() {
  const candidates=[process.env.JAVA_HOME,null];
  if(process.platform==='win32') {
    const base=path.join(process.env.ProgramFiles??'C:/Program Files','Eclipse Adoptium');
    try {for(const item of (await readdir(base,{withFileTypes:true})).filter(item=>item.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true}))) candidates.push(path.join(base,item.name));}catch{/* Optional installation directory. */}
  }
  for(const home of candidates) {
    if(home===undefined)continue;
    const binary=home?path.join(home,'bin',process.platform==='win32'?'java.exe':'java'):'java';
    const result=spawnSync(binary,['-version'],{encoding:'utf8',windowsHide:true,timeout:5000});
    const major=javaMajorVersion(`${result.stdout??''}\n${result.stderr??''}`);
    if(result.status===0 && major!==null && major>=21)return home;
  }
  throw new Error('Configura JAVA_HOME con Java 21 o posterior. No se modificó la configuración del sistema.');
}

try {
  if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Este proyecto requiere Node.js 24.');
  const firebase=pnpmFirebaseInvocation(process.env,root,process.execPath);
  const manager=spawnSync(firebase.command,firebase.versionArgs,{encoding:'utf8',windowsHide:true,timeout:5000});
  if(manager.status!==0 || manager.stdout?.trim()!=='11.23.0')throw new Error('El launcher requiere la CLI real de pnpm 11.23.0.');
  for(const port of [options.port,8080,9099,4400,4500])if(await occupied(port))throw new Error(`El puerto local ${port} está ocupado. Detén el servicio correspondiente antes de iniciar Sarin local.`);
  const env=localDevelopmentEnvironment(process.env);const home=await javaHome();
  if(home) {
    env.JAVA_HOME=home;
    // Firebase CLI invokes "java" from PATH instead of consulting JAVA_HOME.
    const pathKey=Object.keys(env).find(name=>name.toLowerCase()==='path')??'PATH';
    env[pathKey]=`${path.join(home,'bin')}${path.delimiter}${env[pathKey]??''}`;
  }
  // Work around a missing es_US resource bundle in the official Firestore emulator.
  env.JAVA_TOOL_OPTIONS='-Duser.language=en -Duser.country=US';
  console.log('Iniciando Firebase Auth + Firestore oficiales en loopback. Las cuentas y negocios son temporales.');
  console.log('La primera ejecución descarga Firebase CLI 15.33.0 en la caché externa de pnpm dlx (sin añadirlo al workspace).');
  const emulators=launch(firebase.args,env,firebase.command);
  let ready=false;
  for(let attempt=0;attempt<360;attempt++) {
    if(emulators.exitCode!==null)throw new Error('Los emuladores no pudieron iniciarse.');
    try {
      const checks=await Promise.all([fetch(`http://${LOCAL_FIREBASE_AUTH_HOST}/`,{signal:AbortSignal.timeout(1500)}),fetch('http://127.0.0.1:8080/',{signal:AbortSignal.timeout(1500)})]);
      if(checks.every(response=>response.ok)){ready=true;break;}
    }catch{/* Booting. */}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!ready)throw new Error('Los emuladores no están listos. Revisa Java y la descarga inicial.');
  const seed=spawn(process.execPath,['scripts/seed-local.mjs'],{cwd:root,env,stdio:'inherit',windowsHide:true});
  const seeded=await new Promise((resolve,reject)=>{seed.on('error',reject);seed.on('exit',resolve);});
  if(seeded!==0)throw new Error('No se pudieron preparar las cuentas de prueba.');
  console.log(`\nSarin local: http://127.0.0.1:${options.port}\nSelecciona una cuenta en Google emulado; no uses credenciales reales.\nCtrl+C detiene los servicios de esta sesión.\n`);
  launch(['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(options.port)],env);
  // Child services keep the launcher alive until Ctrl+C or a service failure.
}catch(error){console.error(error instanceof Error?error.message:'No se pudo iniciar Sarin local.');await shutdown(1);}
