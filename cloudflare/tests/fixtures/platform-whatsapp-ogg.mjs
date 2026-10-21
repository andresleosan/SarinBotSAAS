// Pure SYNTHETIC generators, adapted from public ALS c224477d291e8b78c687bcde281a47e9679b3ce5
// .github/cloudflare/sarin-whatsapp-audio-client.test.mjs (lines 7-44), SHA256
// d96c05dde1ecf88f1c597a03cc885d17b5cdf8525a9ba2a07b91298c70a54f82.
// Independent bitwise CRC oracle; no production CRC import, voice recordings or ALS runtime.
export function checksum(bytes) {
  let crc=0;
  for (let i=0;i<bytes.length;i++) {
    crc ^= (i>=22&&i<26?0:bytes[i])<<24;
    for(let bit=0;bit<8;bit++)crc=(crc<<1)^((crc&0x80000000)?0x04c11db7:0);
  }
  return crc>>>0;
}
export function page(packets,sequence,{flags=0,granule=0,serial=10}={}) {
  const laces=[];
  for(const packet of packets){let left=packet.length;while(left>=255){laces.push(255);left-=255;}laces.push(left);}
  if(laces.length>255)throw new Error('Too many synthetic laces');
  const out=Buffer.alloc(27+laces.length+packets.reduce((n,p)=>n+p.length,0));
  out.write('OggS');out[5]=flags;out.writeBigUInt64LE(BigInt(granule),6);out.writeUInt32LE(serial,14);out.writeUInt32LE(sequence,18);out[26]=laces.length;
  out.set(laces,27);let offset=27+laces.length;for(const packet of packets){out.set(packet,offset);offset+=packet.length;}
  out.writeUInt32LE(checksum(out),22);return out;
}
/** @param {number} [seconds] @param {{channels?:number,preSkip?:number,granuleSamples?:number,serial?:number,emptyEos?:boolean,noEos?:boolean,granuleOffset?:number}} [options] */
export function voice(seconds=1,{channels=1,preSkip=0,granuleSamples,serial=10,emptyEos=false,noEos=false,granuleOffset=0}={}) {
  const head=Buffer.alloc(19);head.write('OpusHead');head[8]=1;head[9]=channels;head.writeUInt16LE(preSkip,10);head.writeUInt32LE(48000,12);
  const tags=Buffer.alloc(16);tags.write('OpusTags');
  const packets=Array.from({length:Math.ceil(seconds*50)},()=>Buffer.from([0xf8,0xff,0xfe]));
  const pages=[page([head],0,{flags:2,serial}),page([tags],1,{serial})];let done=0;
  while(packets.length){const batch=packets.splice(0,50);done+=batch.length*960;pages.push(page(batch,pages.length,{serial,flags:packets.length||emptyEos||noEos?0:4,granule:(packets.length?done:(granuleSamples??done))+granuleOffset}));}
  if(emptyEos)pages.push(page([],pages.length,{serial,flags:4,granule:0xffffffffffffffffn}));
  return Buffer.concat(pages);
}
export function syntheticWhatsAppOffsetVoice({offset=312,offsetByPage={}}={}) {
  // Synthetic eight-page TOC75 stream with pre-skip offset and complete EOF.
  // No byte comes from a recording or contains participant speech.
  const head=Buffer.alloc(19);head.write('OpusHead');head[8]=head[9]=1;head.writeUInt16LE(312,10);head.writeUInt32LE(16000,12);
  const tags=Buffer.alloc(24);tags.write('OpusTags');tags.writeUInt32LE(8,8);tags.write('Fixture!',12);
  const pages=[page([head],0,{flags:2}),page([tags],1)];let done=0;
  for(const [index,count] of [20,15,15,15,16,7].entries()){
    const packets=Array.from({length:count},(_,i)=>{const frames=index===5&&i===count-1?4:6;done+=frames*960;const packet=Buffer.alloc(2+frames*(i<[7,12,12,14,11,5][index]?43:1));packet[0]=75;packet[1]=frames;return packet;});
    pages.push(page(packets,pages.length,{granule:done+(offsetByPage[index]??offset)}));
  }
  return Buffer.concat(pages);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('base64');

// RFC6716 code 3 CBR, one zero-byte frame and legal padding.
export function paddedPacket(size) {
  if(size<3||size>65536)throw new Error('Invalid synthetic packet size');
  const out=Buffer.alloc(size);out[0]=0xfb;out[1]=0x41;
  let padding=size-3, at=2;
  while(padding>=255){out[at++]=255;padding-=255;}
  out[at]=padding;return out;
}
export function exactBytes(target=2097152) {
  const head=Buffer.alloc(19);head.write('OpusHead');head[8]=head[9]=1;
  for(let tagPad=0;tagPad<4;tagPad++) {
    const tags=Buffer.alloc(16+tagPad);tags.write('OpusTags');
    const pages=[page([head],0,{flags:2}),page([tags],1)];
    for(let i=0;i<39;i++)pages.push(page([paddedPacket(52000)],pages.length,{granule:(i+1)*960}));
    const remaining=target-pages.reduce((n,p)=>n+p.length,0);
    for(let size=Math.max(3,remaining-300);size<=Math.min(65536,remaining);size++) {
      if(27+Math.floor(size/255)+1+size===remaining) {
        pages.push(page([paddedPacket(size)],pages.length,{flags:4,granule:40*960}));return Buffer.concat(pages);
      }
    }
  }
  throw new Error('Cannot construct exact synthetic boundary');
}
export function pagesOf(bytes) {
  const result=[];let at=0;
  while(at<bytes.length){let length=27+bytes[at+26];for(let i=0;i<bytes[at+26];i++)length+=bytes[at+27+i];result.push(Buffer.from(bytes.subarray(at,at+length)));at+=length;}
  return result;
}
export function mutatePage(bytes,index,mutate) {
  const pages=pagesOf(bytes);mutate(pages[index]);pages[index].writeUInt32LE(checksum(pages[index]),22);return Buffer.concat(pages);
}
