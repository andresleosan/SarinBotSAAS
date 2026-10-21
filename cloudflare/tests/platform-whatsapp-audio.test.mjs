import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedOpusSamples, opusPacketSamples } from '../src/platform-whatsapp-opus.ts';
import { handlePlatformAudioOutbound } from '../src/platform-whatsapp-audio.ts';
import { AudioOperation, audioLease, internalAudioResult, readAudioBytes } from '../../shared/platform-whatsapp-audio-protocol.ts';
import { voice, page, checksum, pagesOf, mutatePage, syntheticWhatsAppOffsetVoice, exactBytes, paddedPacket } from './fixtures/platform-whatsapp-ogg.mjs';
const bad=bytes=>assert.throws(()=>verifiedOpusSamples(bytes),e=>['invalid_audio','limit'].includes(e.reason));
const context={className:'SarinApp',containerId:'singleton'};
const env={SARIN_APP:{idFromName:()=>({toString:()=> 'singleton'})},get SARIN_DB(){assert.fail('Denied caller/config must not touch D1');}};
const lease={jobId:'job_'+'a'.repeat(64),epoch:'00000000-0000-4000-8000-000000000001',token:'00000000-0000-4000-8000-000000000002'};
test('private guard rejects caller before URL/method/body/D1; exact URL and safe statuses',async()=>{
  const poison={get url(){assert.fail('caller must be checked first');}};
  for(const ctx of [{className:'Other',containerId:'singleton'},{className:'SarinApp',containerId:'other'}])assert.equal((await handlePlatformAudioOutbound(poison,env,ctx)).status,403);
  for(const url of ['https://sarin-audio.internal/transcribe','http://sarin-audio.internal/transcribe?x=1','http://sarin-audio.internal/other'])assert.equal((await handlePlatformAudioOutbound(new Request(url),env,context)).status,403);
  const method=await handlePlatformAudioOutbound(new Request('http://sarin-audio.internal/transcribe'),env,context);assert.equal(method.status,405);assert.equal(method.headers.get('Allow'),'POST');
  for(const [body,status,reason] of [['{',400,'denied'],[JSON.stringify({...lease,url:'forbidden'}),400,'denied'],[' '.repeat(1025),413,'limit'],[JSON.stringify(lease),200,'denied']]){
    const r=await handlePlatformAudioOutbound(new Request('http://sarin-audio.internal/transcribe',{method:'POST',body}),env,context);assert.equal(r.status,status);assert.deepEqual(await r.json(),{ok:false,reason});assert.equal(r.headers.get('Cache-Control'),'no-store');
  }
});
test('strict lease/result protocol validates Unicode, exact fields and all bounds',()=>{
  assert.equal(audioLease(lease),true);for(const patch of [{epoch:'bad'},{jobId:lease.jobId+'\n'},{extra:true}])assert.equal(audioLease({...lease,...patch}),false);
  const result={ok:true,audioToken:lease.token,text:'😀'.repeat(4096),durationSeconds:120};assert.equal(internalAudioResult(result),true);
  for(const patch of [{text:'😀'.repeat(4097)},{text:'\ud800'},{text:'\0'},{text:' x '},{durationSeconds:120.001},{durationSeconds:NaN},{durationSeconds:0},{audioToken:'bad'},{extra:true}])assert.equal(internalAudioResult({...result,...patch}),false);
});
test('CRC oracle, mono/stereo, preSkip and exact 120s/120.001s verified sample boundaries',()=>{
  assert.equal(checksum(Buffer.from('123456789')),0x89a1897f);
  for(const channels of [1,2])assert.equal(verifiedOpusSamples(voice(1,{channels})),48000);
  assert.equal(verifiedOpusSamples(voice(1,{preSkip:312})),48000-312);
  assert.equal(verifiedOpusSamples(voice(120)),5760000);
  for(const seconds of [120.001,120.02,120.04,121])bad(voice(seconds,{granuleSamples:Math.round(seconds*48000)}));
  bad(voice(121,{granuleSamples:48000}));
});
test('valid code3 padding gives exact 2MiB acceptance and 2MiB+1 rejection',()=>{
  const bytes=exactBytes();assert.equal(bytes.length,2097152);assert.equal(verifiedOpusSamples(bytes),38400);
  const over=exactBytes(2097153);assert.equal(over.length,2097153);bad(over);
});
test('RFC6716 full code0/1/2/3 framing and packet duration families',()=>{
  for(let config=0;config<32;config++){
    const frame=config>=16?120<<(config&3):config>=12?480<<(config&1):(config&3)===3?2880:480<<(config&3);
    assert.equal(opusPacketSamples(Uint8Array.of(config<<3)),frame);
    assert.equal(opusPacketSamples(Uint8Array.of((config<<3)|1)),frame*2);
    assert.equal(opusPacketSamples(Uint8Array.of((config<<3)|2,0)),frame*2);
    assert.equal(opusPacketSamples(Uint8Array.of((config<<3)|3,1)),frame);
  }
  for(const packet of [[],[0xf9,1],[0xfa],[0xfa,252],[0xfa,2,1],[0xfb],[0xfb,0],[0xfb,7],[0xfb,0x41],[0xfb,0x41,255],[0xfb,0x41,2,0],[0xfb,0x82,2,0],[0xfb,2,1]])assert.throws(()=>opusPacketSamples(Uint8Array.from(packet)));
  for(const code of [0,1]){const packet=Buffer.alloc(code===0?1277:2553);packet[0]=0xf8|code;assert.throws(()=>opusPacketSamples(packet));}
  assert.equal(opusPacketSamples(Uint8Array.of(0xfb,0x82,1,0,0)),1920);
  assert.equal(opusPacketSamples(paddedPacket(65536)),960);
});
test('structural pages reject corrupted framing, CRC, sequence, serial, granules and trailing data',()=>{
  const bytes=voice();
  for(const mutate of [p=>p[0]=0,p=>p[4]=1,p=>p[5]=8,p=>p[5]=0,p=>p.writeUInt32LE(1,18),p=>p.writeBigUInt64LE(1n,6)])bad(mutatePage(bytes,0,mutate));
  for(const mutate of [p=>p[5]|=2,p=>p[5]|=1,p=>p.writeUInt32LE(99,14),p=>p.writeUInt32LE(99,18),p=>p.writeBigUInt64LE(0xffffffffffffffen,6),p=>p.writeBigUInt64LE(960n,6),p=>p.writeBigUInt64LE(48001n,6)])bad(mutatePage(bytes,2,mutate));
  for(const n of [0,1,26,27,46,bytes.length-1])bad(bytes.subarray(0,n));
  for(const at of [22,bytes.length-1]){const changed=Buffer.from(bytes);changed[at]^=1;bad(changed);}
  bad(Buffer.concat([bytes,Buffer.from([0])]));bad(Buffer.concat([bytes,bytes]));
});
test('Head/Tags strict framing and original preSkip reject malformed headers/comments',()=>{
  const bytes=voice();
  for(const [offset,value] of [[8,2],[9,0],[9,3],[18,1]])bad(mutatePage(bytes,0,p=>p[28+offset]=value));
  bad(voice(1,{preSkip:48000}));
  for(const mutate of [p=>p[28]=0,p=>p.writeUInt32LE(999,36),p=>p.writeUInt32LE(16385,40),p=>p.writeUInt32LE(1,40)])bad(mutatePage(bytes,1,mutate));
  bad(Buffer.concat(pagesOf(bytes).slice(0,2)));
});
test('empty EOS accepts only complete terminal unset granule and preserves preSkip',()=>{
  const bytes=voice(1,{emptyEos:true,preSkip:312});assert.equal(verifiedOpusSamples(bytes),47688);
  assert.equal(verifiedOpusSamples(voice(120,{emptyEos:true})),5760000);
  bad(voice(120.02,{emptyEos:true}));
  for(const mutate of [p=>p[5]=0,p=>p.writeBigUInt64LE(48000n,6),p=>p.writeUInt32LE(4,18),p=>p.writeUInt32LE(9,14)])bad(mutatePage(bytes,3,mutate));
  bad(bytes.subarray(0,-1));bad(Buffer.concat([bytes,Buffer.from([0])]));
});
test('narrow complete offset EOF accepts synthetic WhatsApp variant, rejects ordinary incomplete streams and drift',()=>{
  assert.equal(verifiedOpusSamples(syntheticWhatsAppOffsetVoice()),504960-312);
  for(const options of [{offset:313},{offset:-1},{offsetByPage:{2:313}}])bad(syntheticWhatsAppOffsetVoice(options));
  bad(voice(1,{noEos:true}));bad(syntheticWhatsAppOffsetVoice().subarray(0,-1));
  assert.equal(verifiedOpusSamples(voice(120,{noEos:true,preSkip:312,granuleOffset:312,granuleSamples:5760000})),5760000-312);
  bad(voice(120.02,{noEos:true,preSkip:312,granuleOffset:312}));
});
test('lacing permits exact255 terminal0 and continuation across pages; rejects unmatched continuation and unfinished EOF',()=>{
  const headers=pagesOf(voice()).slice(0,2), packet=paddedPacket(510);
  const full=page([packet],2,{flags:4,granule:960});assert.equal(verifiedOpusSamples(Buffer.concat([...headers,full])),960);
  // First half has one 255 lace without packet completion; second completes it.
  const first=Buffer.alloc(27+1+255);first.write('OggS');first.writeBigUInt64LE(0xffffffffffffffffn,6);first.writeUInt32LE(10,14);first.writeUInt32LE(2,18);first[26]=1;first[27]=255;first.set(packet.subarray(0,255),28);first.writeUInt32LE(checksum(first),22);
  const last=page([packet.subarray(255)],3,{flags:5,granule:960});
  const stream=Buffer.concat([...headers,first,last]);assert.equal(verifiedOpusSamples(stream),960);
  bad(mutatePage(stream,2,p=>p.writeBigUInt64LE(0n,6)));bad(mutatePage(stream,3,p=>p[5]=4));bad(Buffer.concat([...headers,first]));
  bad(Buffer.concat([...headers,page([Buffer.alloc(0)],2,{flags:4,granule:960})]));
});
test('3s per-read deadline races cancellation-ignoring read and cancels reader',async context=>{
  context.mock.timers.enable({apis:['setTimeout','Date']});let cancelled=0;
  const operation=new AudioOperation(new AbortController().signal);
  const pending=readAudioBytes(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}}),100,operation);
  const rejected=assert.rejects(pending,e=>e.reason==='unknown');context.mock.timers.tick(3000);await rejected;operation.close();assert.equal(cancelled,1);
});
test('45s global deadline never extends across awaits and suppresses late effects',async context=>{
  context.mock.timers.enable({apis:['setTimeout','Date']});const operation=new AudioOperation(new AbortController().signal);let release, effects=0;
  const pending=operation.wait(new Promise(r=>release=r)).then(()=>effects++);const rejected=assert.rejects(pending,e=>e.reason==='unknown');context.mock.timers.tick(45000);await rejected;release(true);await Promise.resolve();assert.equal(effects,0);operation.close();
});

test('private body read has a single 3s deadline even when individual chunks arrive sooner',async context=>{
  context.mock.timers.enable({apis:['setTimeout','Date']});let enqueue;
  const body=new ReadableStream({start(c){enqueue=c;}});
  const pending=handlePlatformAudioOutbound(new Request('http://sarin-audio.internal/transcribe',{method:'POST',body,duplex:'half'}),env,contextForBody());
  enqueue.enqueue(new TextEncoder().encode('{'));for(let n=0;n<10;n++)await Promise.resolve();
  context.mock.timers.tick(2000);enqueue.enqueue(new TextEncoder().encode(' '));for(let n=0;n<10;n++)await Promise.resolve();
  context.mock.timers.tick(1000);const r=await pending;assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,reason:'unknown'});
  function contextForBody(){return{className:'SarinApp',containerId:'singleton'};}
});
test('multiple sub3s reads still exhaust one immutable45s operation deadline',async context=>{
  context.mock.timers.enable({apis:['setTimeout','Date']});const operation=new AudioOperation(new AbortController().signal);let controller;
  const pending=readAudioBytes(new ReadableStream({start(c){controller=c;}}),100,operation);
  const rejected=assert.rejects(pending,e=>e.reason==='unknown');
  for(let n=0;n<15;n++){context.mock.timers.tick(2900);controller.enqueue(Uint8Array.of(1));for(let i=0;i<10;i++)await Promise.resolve();}
  context.mock.timers.tick(1500);await rejected;operation.close();
});

test('emptyEOS and offsetEOF retain exact120s and reject120.001s with sample-exact preSkip',()=>{
  for(const options of [{emptyEos:true},{noEos:true,granuleOffset:960}])assert.equal(verifiedOpusSamples(voice(120.02,{preSkip:960,...options})),5760000);
  for(const options of [{emptyEos:true},{noEos:true,granuleOffset:912}])bad(voice(120.02,{preSkip:912,...options}));
});
test('Ogg packet/tag/lace semantic boundary matrix has independent valid CRC',()=>{
  const base=voice(2), pages=pagesOf(base), headers=pages.slice(0,2);
  for(const mutate of [p=>p.writeBigUInt64LE(47999n,6),p=>p.writeBigUInt64LE(48001n,6),p=>p.writeBigUInt64LE(0xffffffffffffffffn,6)])bad(mutatePage(base,2,mutate));
  bad(mutatePage(base,3,p=>p.writeBigUInt64LE(47999n,6)));
  const head=Buffer.from(pages[0].subarray(28));const tags=Buffer.alloc(16);tags.write('OpusTags');
  for(const packet of [head.subarray(0,18),Buffer.concat([head,Buffer.from([0])])])bad(Buffer.concat([page([packet],0,{flags:2}),...pages.slice(1)]));
  for(const packet of [Buffer.alloc(0),tags.subarray(0,15),Buffer.concat([tags,Buffer.from([0])])]){
    if(packet.length===17){packet.writeUInt32LE(1,12);}
    bad(Buffer.concat([pages[0],page([packet],1),...pages.slice(2)]));
  }
  bad(Buffer.concat([pages[0],page([tags,Buffer.from([0xf8])],1),...pages.slice(2)]));
  const tooLarge=Buffer.alloc(65537);tooLarge[0]=0xfb;tooLarge[1]=1;
  const first=Buffer.alloc(27+255+65025);first.write('OggS');first.writeBigUInt64LE(0xffffffffffffffffn,6);first.writeUInt32LE(10,14);first.writeUInt32LE(2,18);first[26]=255;first.fill(255,27,282);first.set(tooLarge.subarray(0,65025),282);first.writeUInt32LE(checksum(first),22);
  bad(Buffer.concat([...headers,first,page([tooLarge.subarray(65025)],3,{flags:5,granule:960})]));
  const truncatedTable=Buffer.from(pages[2]);truncatedTable[26]=255;bad(Buffer.concat([...headers,truncatedTable.subarray(0,40)]));
  const unfinished=Buffer.from(pages[2]);unfinished[unfinished.length-1]^=1;bad(Buffer.concat([...headers,unfinished]));
});
test('Opus variable size encoding and code3 VBR/padding boundaries',()=>{
  for(const length of [0,1,251,252,1275]){
    const size=length<252?[length]:[252+(length%4),Math.floor((length-252)/4)];
    const packet=Buffer.concat([Buffer.from([0xfa,...size]),Buffer.alloc(length)]);assert.equal(opusPacketSamples(packet),1920);
  }
  for(const packet of [[0xfb,0x82,252],[0xfb,0x82,255,255],[0xfb,0xc2,0,2,0],[0xfb,0x41,10],[0xfb,0xff,0]])assert.throws(()=>opusPacketSamples(Uint8Array.from(packet)));
  assert.equal(opusPacketSamples(Uint8Array.of(0xfb,0xc2,0,0)),1920);
});
