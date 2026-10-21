import { describe, expect, it } from 'vitest';
import { validatePlatformAudioDescriptor as validate } from '../shared/platform-whatsapp-audio';

const audio = () => ({ id: '123456789', link: 'https://api.ycloud.com/v2/whatsapp/media/download/123456789', sha256: Buffer.alloc(32, 7).toString('base64'), mimeType: 'audio/ogg' });
describe('closed local audio descriptor policy', () => {
  it.each(['', '?sig=opaque%2Bbytes', '?payload=opaque', '?payload=one&sig=two'])('preserves opaque allowed URL %s and normalizes Ogg MIME', query => {
    const input = { ...audio(), link: audio().link + query };
    const result = validate(input);
    expect(result).toEqual({ ...input, mimeType: 'audio/ogg; codecs=opus' }); expect(result).not.toBe(input);
  });
  it.each(['audio/ogg', 'AUDIO/OGG', 'audio/ogg; codecs=opus', 'audio/ogg;codecs="opus"', 'audio/ogg ; codecs=Opus'])('accepts Ogg/Opus spelling %s', mimeType => {
    expect(validate({ ...audio(), mimeType })?.mimeType).toBe('audio/ogg; codecs=opus');
  });
  it.each([
    { id: '0' }, { id: '01' }, { id: '1'.repeat(33) }, { id: '123456789\n' }, { id: 123456789 },
    { sha256: 'A'.repeat(42) + 'B=' }, { sha256: Buffer.alloc(31).toString('base64') }, { sha256: audio().sha256 + '\n' },
    { mimeType: 'audio/mp4' }, { mimeType: 'audio/ogg; codecs=vorbis' }, { mimeType: 'audio/mpeg' }, { mimeType: 'audio/ogg\n' }, { mimeType: 'audio/ogg; codecs=opus; x=1' },
    { extra: true }, { mimeType: undefined },
  ])('rejects invalid closed fields %j', patch => { expect(validate({ ...audio(), ...patch })).toBeNull(); });
  it.each([
    'http://api.ycloud.com/v2/whatsapp/media/download/123456789',
    'https://api.ycloud.com:443/v2/whatsapp/media/download/123456789',
    'https://user@api.ycloud.com/v2/whatsapp/media/download/123456789',
    'https://api.ycloud.com.evil.invalid/v2/whatsapp/media/download/123456789',
    'https://api.ycloud.com/v2/whatsapp/media/download/123456788',
    'https://api.ycloud.com/v2/whatsapp/media/download/123456789#fragment',
    'https://api.ycloud.com/v2/whatsapp/media/../media/download/123456789',
    audio().link + '?sig=a#', audio().link + '?redirect=https://evil.invalid', audio().link + '?sig=', audio().link + '?sig=a&sig=b',
    audio().link + '?payload=a&payload=b', audio().link + '?sig=' + 'a'.repeat(2049), audio().link + '\n',
  ])('rejects unsupported URL %s', link => { expect(validate({ ...audio(), link })).toBeNull(); });
  it('enforces canonical hash pad bits and descriptor serialization bounds', () => {
    const hash = audio().sha256;
    expect(validate({ ...audio(), sha256: hash.slice(0, -2) + 'd=' })).toBeNull();
    expect(validate({ ...audio(), link: audio().link + '?sig=' + 'a'.repeat(2000) + '&payload=' + 'b'.repeat(2000) })).toBeNull();
    for (const value of [null, [], 7, 'audio']) expect(validate(value)).toBeNull();
  });
});

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';
import { handlePlatformAudioOutbound } from '../cloudflare/tests/platform-whatsapp-audio-bridge.mjs';
import { voice, exactBytes, mutatePage } from '../cloudflare/tests/fixtures/platform-whatsapp-ogg.mjs';
import { createCloudflareDatabase, StorageError, type DataTransport } from '@/lib/storage/database';
import type { Database } from '@/lib/storage/types';
import type { Lease } from '../shared/platform-whatsapp-work';
import { buildWorkAudioScenario } from './platform-whatsapp-work-scenario';
import { now } from './platform-whatsapp-test-fixtures';
import { encryptPlatformWhatsAppContent, decryptPlatformWhatsAppContent } from '@/lib/server/platform-whatsapp-crypto';
import { transcribePlatformAudio } from '@/lib/server/platform-whatsapp-audio';
import { createPlatformWorkStore } from '@/lib/server/platform-whatsapp-work-store';
const backend = vi.hoisted(() => ({ db: null as Database | null, getUser: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { if (!backend.db) throw new Error('Default backend forbidden'); return backend.db; }, getAdminAuth: () => ({ getUser: backend.getUser }) }));

describe('A4 complete adapter on actual local D1, synthetic Firebase/fetch/AI only', () => {
  let runtime: Awaited<ReturnType<typeof createDataTestRuntime>>, db: Database, second: Database, lease: Lease;
  let bytes: Buffer, sourcePath: string, bodyExpiry: number, fetches: number, aiCalls: number;
  let workerEnv: any, source: Record<string, any>;
  let media: () => Promise<Response>, infer: () => Promise<unknown>;
  let bridgeResult: ((r: Response) => Promise<Response>) | null;
  const transport: DataTransport = async command => { const response = await runtime.fetch(command); const data = await response.json(); if (!response.ok) throw new StorageError(response.status, (data as {code:string}).code); return data as any; };
  beforeAll(async () => { runtime = await createDataTestRuntime(); }, 30000);
  afterAll(async () => { await runtime?.dispose(); });
  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now); backend.getUser.mockReset().mockImplementation(async uid => ({ uid, disabled: false }));
    await runtime.db.exec('DELETE FROM app_documents; DELETE FROM app_commits;');
    db = createCloudflareDatabase(transport); second = createCloudflareDatabase(transport); backend.db = db;
    const scenario = await buildWorkAudioScenario(); lease = scenario.lease;
    await db.runTransaction(async tx => { await tx.get(db.collection('serverSettings').doc('platform_whatsapp')); for (const [p, row] of scenario.rows) { const [root, id] = p.split('/'); tx.set(db.collection(root).doc(id), row); } });
    const job = (await db.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
    sourcePath = 'platformWhatsAppEvents/' + job.sourceEventId; source = (await db.collection('platformWhatsAppEvents').doc(job.sourceEventId as string).get()).data()!; bodyExpiry = job.bodyExpiresAt as number;
    bytes = voice(); await replaceBytes(bytes);
    fetches = aiCalls = 0; bridgeResult = null;
    media = async () => response(bytes);
    infer = async () => ({ text: '  ACEPTO / APRUEBA: consulta synthetic  ', unusedDiagnostics: 'never persisted' });
    workerEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('PLATFORM_'))), PLATFORM_YCLOUD_API_KEY: 'synthetic-media-key', SARIN_DB: runtime.db, SARIN_FILES: new Proxy({}, { get() { throw new Error('Audio must never use R2'); } }), SARIN_APP: { idFromName: () => ({ toString: () => 'singleton' }) }, AI: { run: async (model: string, input: unknown) => { aiCalls++; expect(model).toBe('@cf/openai/whisper-large-v3-turbo'); expect(input).toEqual({ audio: bytes.toString('base64'), task: 'transcribe' }); return infer(); } } };
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url === 'http://sarin-audio.internal/transcribe') {
        expect(JSON.parse(options.body as string)).toEqual(lease); expect(Object.keys(JSON.parse(options.body as string))).toEqual(['jobId','epoch','token']);
        const r = await handlePlatformAudioOutbound(new Request(url, options), workerEnv, { className: 'SarinApp', containerId: 'singleton' }); return bridgeResult ? bridgeResult(r) : r;
      }
      fetches++; expect(url).toBe(audio().link); expect(options.method).toBe('GET'); expect(options.redirect).toBe('manual'); expect(options.headers).toEqual({ 'X-API-Key': 'synthetic-media-key' }); expect(options.signal).toBeInstanceOf(AbortSignal); return media();
    }));
  });
  afterEach(() => { backend.db = null; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  function response(content: BodyInit | Buffer | null, init: ResponseInit = {}) { const r = new Response(content instanceof Uint8Array ? new Uint8Array(content) : content, { headers: { 'Content-Type': 'audio/ogg' }, ...init }); Object.defineProperty(r, 'url', { value: audio().link }); return r; }
  async function replaceBytes(value: Buffer, mutate?: (payload: any) => void) {
    bytes = value; const key = Buffer.from(process.env.PLATFORM_WHATSAPP_CONTENT_KEY!, 'base64');
    const payload = decryptPlatformWhatsAppContent(source.content, sourcePath, key) as any;
    payload.audio = { ...audio(), sha256: createHash('sha256').update(value).digest('base64') }; mutate?.(payload);
    source = { ...source, content: encryptPlatformWhatsAppContent(payload, sourcePath, key) };
    await db.collection('platformWhatsAppEvents').doc(sourcePath.split('/')[1]).set(source);
  }
  const transcribe = () => transcribePlatformAudio(lease, new AbortController().signal);
  const worker = () => handlePlatformAudioOutbound(new Request('http://sarin-audio.internal/transcribe', { method: 'POST', body: JSON.stringify(lease) }), workerEnv, { className: 'SarinApp', containerId: 'singleton' });
  const job = async () => (await second.collection('platformWhatsAppJobs').doc(lease.jobId).get()).data()!;
  const call = async () => (await second.collection('platformWhatsAppBudgetCalls').get()).docs.map(d => d.data()).find(d => d.stage === 'audio')!;
  it('one exact AI call, integral metering, encrypted transcript, original TTL and Node token stripping', async () => {
    await replaceBytes(voice(1, { preSkip: 313 }));
    expect(await transcribe()).toEqual({ ok: true, text: 'ACEPTO / APRUEBA: consulta synthetic', durationSeconds: (48000 - 313) / 48000 });
    expect([fetches, aiCalls]).toEqual([1,1]);
    const stored = await job(); expect(stored).toMatchObject({ audioState: 'completed', bodyExpiresAt: bodyExpiry });
    expect(decryptPlatformWhatsAppContent(stored.content, 'platformWhatsAppJobs/' + lease.jobId, Buffer.from(process.env.PLATFORM_WHATSAPP_CONTENT_KEY!, 'base64'))).toMatchObject({ question: 'ACEPTO / APRUEBA: consulta synthetic' });
    expect(await call()).toMatchObject({ status: 'settled', actualMicros: 1, usageAudioMilliseconds: 994 });
    expect((await db.collection('platformWhatsAppEvents').doc(sourcePath.split('/')[1]).get()).data()).toMatchObject({ state: 'body_erased', content: null, bodyExpiresAt: bodyExpiry });
    expect((await transcribe()).ok).toBe(false); expect(aiCalls).toBe(1);
  });
  it.each(['off','key','ai','budget','zero_tariff','content_key','reservation','epoch','scope','firebase'])('initial %s denial has no media/AI', async kind => {
    if (kind === 'off') workerEnv.PLATFORM_WHATSAPP_AUDIO_ENABLED = 'false';
    if (kind === 'key') delete workerEnv.PLATFORM_YCLOUD_API_KEY;
    if (kind === 'ai') delete workerEnv.AI;
    if (kind === 'budget') workerEnv.PLATFORM_WHATSAPP_AUDIO_DAILY_BUDGET_MICROS = '0';
    if (kind === 'zero_tariff') { const p = JSON.parse(workerEnv.PLATFORM_WHATSAPP_TARIFF_POLICY); p.audio.numerator = 0; workerEnv.PLATFORM_WHATSAPP_TARIFF_POLICY = JSON.stringify(p); }
    if (kind === 'content_key') workerEnv.PLATFORM_WHATSAPP_CONTENT_KEY += '\n';
    if (kind === 'reservation') { const c = await call(); await db.collection('platformWhatsAppBudgetCalls').doc(c.reservationId as string).delete(); }
    if (kind === 'epoch') lease = { ...lease, epoch: '00000000-0000-4000-8000-000000000009' };
    if (kind === 'scope') workerEnv.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '999999';
    if (kind === 'firebase') backend.getUser.mockResolvedValue({ uid: 'wrong-user', disabled: true });
    const r = kind === 'reservation' ? await (await worker()).json() : await transcribe(); expect(r.ok).toBe(false); expect([fetches, aiCalls]).toEqual([0,0]);
  });
  it.each(['uid','receipt','extra','phone','own_phone','descriptor','extra_payload'])('decrypted original %s mismatch is rejected before fetch', async kind => {
    await replaceBytes(bytes, p => { if (kind === 'uid') p.retentionAnchor.uid += 'wrong'; if (kind === 'receipt') p.retentionAnchor.account.receiptId += 'wrong'; if (kind === 'extra') p.retentionAnchor.extra = true; if (kind === 'phone') p.customerPhone = '+12025550999'; if (kind === 'own_phone') p.customerPhone = workerEnv.PLATFORM_WHATSAPP_PHONE_E164; if (kind === 'descriptor') p.audio.link = 'https://example.invalid/audio'; if (kind === 'extra_payload') p.extra = true; });
    const r = await (await worker()).json(); expect(r.ok).toBe(false); expect([fetches,aiCalls]).toEqual([0,0]); expect((await call()).status).toBe('released');
  });
  it.each(['type','encoding','range','length','negative','decimal','oversized','tiny','redirect','status','url','empty','sha','crc','duration','frame'])('invalid %s media cannot enter AI', async kind => {
    if (kind === 'sha') { await replaceBytes(bytes,p=>p.audio.sha256=Buffer.alloc(32).toString('base64')); }
    if (kind === 'crc') { const damaged=Buffer.from(bytes); damaged[damaged.length-1]^=1; await replaceBytes(damaged); }
    if (kind === 'duration') await replaceBytes(voice(120.001,{granuleSamples:5760048}));
    if (kind === 'frame') await replaceBytes(mutatePage(bytes,2,(p: Buffer)=>{p[p.length-3]=0xfb;p[p.length-2]=0;}));
    media = async () => {
      const h: Record<string,string> = { 'Content-Type': kind === 'type' ? 'audio/mp4' : 'audio/ogg' };
      if (kind === 'encoding') h['Content-Encoding']='gzip'; if (kind === 'range') h['Content-Range']='bytes 0-10/11';
      if (['length','negative','decimal','oversized','tiny'].includes(kind)) h['Content-Length']=({length:'bad',negative:'-1',decimal:'1.2',oversized:'2097153',tiny:'1'} as any)[kind];
      const r=response(kind==='empty'?null:kind==='tiny'?Buffer.alloc(2097153):bytes,{headers:h,status:kind==='redirect'?302:kind==='status'?500:200});
      if(kind==='url')return new Response(new Uint8Array(bytes),{headers:h});return r;
    };
    expect((await transcribe()).ok).toBe(false);expect(fetches).toBe(1);expect(aiCalls).toBe(0);expect(await call()).toMatchObject({status:'released',actualMicros:0});
  });
  it('exact2MiB valid padded Opus reaches one AI and never binary persistence',async()=>{await replaceBytes(exactBytes());expect((await transcribe()).ok).toBe(true);expect(aiCalls).toBe(1);const rows=await runtime.db.prepare('SELECT data FROM app_documents').all();expect(JSON.stringify(rows)).not.toContain(bytes.toString('base64'));});
  it.each(['takeover','expiry','anchor','policy'])('current %s loss during media read prevents AI',async kind=>{
    media=async()=>{const j=await job();if(kind==='takeover')await createPlatformWorkStore(second).cancelConversation(j.conversationId as string,j.conversationRevision as number);
      if(kind==='expiry')vi.mocked(Date.now).mockReturnValue(now+120000);
      if(kind==='anchor'){const path='platformWhatsAppLinks/'+j.linkId;const row=(await second.collection('platformWhatsAppLinks').doc(j.linkId as string).get()).data()!;await second.collection('platformWhatsAppLinks').doc(j.linkId as string).set({...row,linkRevision:Number(row.linkRevision)+1});}
      if(kind==='policy')workerEnv.PLATFORM_WHATSAPP_AUDIO_DAILY_BUDGET_MICROS='101';return response(bytes);};
    expect((await transcribe()).ok).toBe(false);expect(aiCalls).toBe(0);
  });
  it('concurrent complete requests on two DB handles only download/infer once',async()=>{const first=transcribe();backend.db=second;const results=await Promise.all([first,transcribe()]);expect(results.filter(r=>r.ok)).toHaveLength(1);expect([fetches,aiCalls]).toEqual([1,1]);expect((await call()).status).toBe('settled');});
  it.each(['disabled','deleted','cutoff','unavailable'])('fresh Firebase %s after AI drops text before Node success',async kind=>{
    infer=async()=>{if(kind==='deleted')backend.getUser.mockRejectedValue(Object.assign(new Error('synthetic'),{code:'auth/user-not-found'}));else if(kind==='unavailable')backend.getUser.mockRejectedValue(new Error('synthetic unavailable'));else backend.getUser.mockImplementation(async uid=>({uid,disabled:kind==='disabled',tokensValidAfterTime:kind==='cutoff'?new Date(now+1000).toISOString():undefined}));return{text:'do not expose this answer'};};
    const r=await transcribe();expect(r.ok).toBe(false);expect(JSON.stringify(r)).not.toContain('answer');expect((await job()).audioState).toBe('result_pending');expect(aiCalls).toBe(1);expect((await transcribe()).ok).toBe(false);expect(aiCalls).toBe(1);
  });
  it('AI throw retains uncertainty/maximum hold and restart never retranscribes',async()=>{infer=async()=>{throw new Error('secret synthetic provider body');};expect(await transcribe()).toEqual({ok:false,reason:'unknown'});expect(await call()).toMatchObject({status:'uncertain',actualMicros:null,usageAudioMilliseconds:null});expect((await transcribe()).ok).toBe(false);expect([fetches,aiCalls]).toEqual([1,1]);});
  it('lost result after Worker finish remains result_pending without a recovered invocation',async()=>{bridgeResult=async()=>{throw new Error('lost response');};expect(await transcribe()).toEqual({ok:false,reason:'unknown'});expect((await job()).audioState).toBe('result_pending');expect(await call()).toMatchObject({status:'settled',actualMicros:1});expect((await transcribe()).ok).toBe(false);expect(aiCalls).toBe(1);});
  it.each([null,'text',[],{}, {text:''},{text:'\0'},{text:'\ud800'},{text:'x'.repeat(4097)}])('known invalid provider result settles measured attempt without retry',async value=>{infer=async()=>value;expect(await transcribe()).toEqual({ok:false,reason:'invalid_audio'});expect(await call()).toMatchObject({status:'settled',actualMicros:1});expect((await transcribe()).ok).toBe(false);expect(aiCalls).toBe(1);});
  it.each([400,403,405,413,500,503])('Node refuses success object on HTTP%s',async status=>{bridgeResult=async r=>new Response(await r.text(),{status});const r=await transcribe();expect(r).toEqual({ok:false,reason:[400,403,405].includes(status)?'denied':status===413?'limit':'unknown'});expect((await job()).audioState).toBe('result_pending');});
  it.each(['token','duration','extra','large'])('Node rejects malformed internal %s result before completion',async kind=>{bridgeResult=async r=>{const v=await r.json() as any;if(kind==='token')v.audioToken='invalid';if(kind==='duration')v.durationSeconds=121;if(kind==='extra')v.extra=true;if(kind==='large')v.text='x'.repeat(32769);return Response.json(v);};expect((await transcribe()).ok).toBe(false);expect((await job()).audioState).toBe('result_pending');});
  it('ambiguous durable start never recovers an AI invocation and retains the maximum', async () => {
    const database = runtime.db; let hideJournal = 0, lost = false;
    workerEnv.SARIN_DB = {
      prepare(sql: string) {
        if (hideJournal > 0 && sql.startsWith('SELECT fingerprint')) { hideJournal--; return { bind() { return { first: async () => { throw new Error('Synthetic lost journal response'); } }; } }; }
        return database.prepare(sql);
      },
      async batch(statements: any[]) {
        const result = await database.batch(statements);
        const row = await database.prepare('SELECT data FROM app_documents WHERE path = ?').bind('platformWhatsAppJobs/' + lease.jobId).first();
        if (!lost && row && JSON.parse(row.data).audioState === 'started') { lost = true; hideJournal = 3; throw new Error('Synthetic lost start response'); }
        return result;
      },
    };
    expect(await transcribe()).toEqual({ ok: false, reason: 'unknown' }); expect(lost).toBe(true); expect(aiCalls).toBe(0);
    expect(await call()).toMatchObject({ status: 'uncertain', actualMicros: null });
    expect((await transcribe()).ok).toBe(false); expect(aiCalls).toBe(0);
  });
  it('a lost prepare response grants neither download nor a recovered invocation', async () => {
    const database = runtime.db; let hideJournal = 0, lost = false;
    workerEnv.SARIN_DB = {
      prepare(sql: string) {
        if (hideJournal > 0 && sql.startsWith('SELECT fingerprint')) { hideJournal--; return { bind() { return { first: async () => { throw new Error('Synthetic lost prepare journal'); } }; } }; }
        return database.prepare(sql);
      },
      async batch(statements: any[]) {
        const result = await database.batch(statements);
        const row = await database.prepare('SELECT data FROM app_documents WHERE path = ?').bind('platformWhatsAppJobs/' + lease.jobId).first();
        if (!lost && row && JSON.parse(row.data).audioState === 'preparing') { lost = true; hideJournal = 3; throw new Error('Synthetic lost prepare response'); }
        return result;
      },
    };
    expect(await transcribe()).toEqual({ ok: false, reason: 'unknown' }); expect(lost).toBe(true); expect([fetches, aiCalls]).toEqual([0,0]);
    expect((await job()).audioState).toBe('preparing'); expect((await transcribe()).ok).toBe(false); expect([fetches, aiCalls]).toEqual([0,0]);
  });
  it('two Node completion handles serialize the exact same pending result, preserving original TTL', async () => {
    const { commitPlatformAudioResult } = await import('@/lib/server/platform-whatsapp-work-audio');
    const r = await (await worker()).json(); expect(r.ok).toBe(true);
    const results = await Promise.all([commitPlatformAudioResult(lease,r.audioToken,r.text,r.durationSeconds,db,now),commitPlatformAudioResult(lease,r.audioToken,r.text,r.durationSeconds,second,now)]);
    expect(results).toEqual([true,true]); expect(await job()).toMatchObject({audioState:'completed',bodyExpiresAt:bodyExpiry}); expect(aiCalls).toBe(1);
  });
  it('D1 takeover between private result and Node completion drops text and preserves newer control state', async () => {
    bridgeResult = async r => { const j = await job(); await createPlatformWorkStore(second).cancelConversation(j.conversationId as string,j.conversationRevision as number); return r; };
    expect(await transcribe()).toEqual({ok:false,reason:'denied'}); const stored = await job(); expect(stored.audioState).not.toBe('completed'); expect(stored.bodyExpiresAt).toBe(bodyExpiry); expect(aiCalls).toBe(1);
  });
  it('caller abort during a cancellation-ignoring AI cannot expose late text or retranscribe', async () => {
    const controller = new AbortController(); let release!: (v: unknown) => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    infer = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const pending = transcribePlatformAudio(lease, controller.signal); await started; controller.abort();
    expect(await pending).toEqual({ok:false,reason:'unknown'}); release({text:'late result must disappear'});
    // Flush the already-started cleanup transaction; it cannot issue an AI effect.
    for (let n = 0; n < 30 && (await call()).status === 'started'; n++) await new Promise(r => setTimeout(r, 10));
    expect((await call()).status).toBe('uncertain'); expect((await transcribe()).ok).toBe(false); expect(aiCalls).toBe(1);
  });
  it('caller abort during a cancellation-ignoring fetch cancels its late body and never calls AI', async () => {
    const controller = new AbortController(); let release!: (v: Response) => void, entered!: () => void, cancelled = 0;
    const fetching = new Promise<void>(resolve => { entered = resolve; });
    media = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const pending = transcribePlatformAudio(lease,controller.signal); await fetching; controller.abort();
    expect(await pending).toEqual({ok:false,reason:'unknown'});
    release(response(new ReadableStream({cancel(){cancelled++;}})));
    for (let n = 0; n < 30 && (await call()).status === 'reserved'; n++) await new Promise(r => setTimeout(r, 10));
    expect(cancelled).toBe(1); expect(aiCalls).toBe(0); expect((await transcribe()).ok).toBe(false); expect(fetches).toBe(1);
  });
});
