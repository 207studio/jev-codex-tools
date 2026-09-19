import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {publicURL,publicIPv4,fetchPublic,readSource,parseRecords} from '../integration/collection-sources.mjs';

test('public source policy rejects private, credential, query and redirect targets',()=>{
  for (const url of ['http://docs.typesafe.ai/a','https://localhost/a','https://127.0.0.1/a','https://[::1]/a','https://u:p@host.com/a','https://host.com/a?token=x','https://host.com/a#x','https://host.com:444/a','https://host.local/a']) assert.throws(()=>publicURL(url));
  assert.equal(publicURL('https://docs.typesafe.ai/api.md').hostname,'docs.typesafe.ai');
  for (const ip of ['10.0.0.1','100.64.0.1','127.1.2.3','169.254.169.254','172.16.0.1','192.168.1.1','192.0.2.1','198.18.0.1','224.1.1.1','::1']) assert.equal(publicIPv4(ip),false);
  assert.equal(publicIPv4('8.8.8.8'),true);
});

test('bounded source reads reject large and sensitive files',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'jev-source-'));
  try {
    const file=path.join(root,'input.txt');await writeFile(file,'source text');
    const result=await readSource({file,format:'text'});assert.equal(result.text,'source text');assert.match(result.sha256,/^[a-f0-9]{64}$/);
    await writeFile(file,Buffer.alloc(65537));await assert.rejects(()=>readSource({file,format:'text'}));
    await assert.rejects(()=>readSource({file:path.join(root,'.env'),format:'text'}));
    await assert.rejects(()=>readSource({file,url:'https://docs.typesafe.ai/a',format:'text'}));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('HTTP retrieval pins public DNS and stops at redirects or oversized bodies',async()=>{
  const resolveDNS=async()=>[{address:'8.8.8.8',family:4}];let calls=0;
  const requestHTTPS=(_url,options,respond)=>{
    calls++;options.lookup('ignored',{all:true},(error,value)=>{assert.equal(error,null);assert.deepEqual(value,[{address:'8.8.8.8',family:4}]);});
    queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=302;response.headers={location:'http://127.0.0.1/private','content-type':'text/plain'};response.destroy=()=>{};respond(response);});
    return new EventEmitter();
  };
  await assert.rejects(()=>fetchPublic('https://public.host/path',{resolveDNS,requestHTTPS}),/unsupported_http_response/);
  assert.equal(calls,1);
  await assert.rejects(()=>fetchPublic('https://public.host/path',{resolveDNS:async()=>[{address:'127.0.0.1',family:4}],requestHTTPS}),/non_public_address/);
  assert.equal(calls,1);
  await assert.rejects(()=>fetchPublic('https://public.host/path',{resolveDNS,requestHTTPS:(_url,_options,respond)=>{
    queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'text/plain'};response.destroy=()=>{};respond(response);response.emit('data',Buffer.alloc(65537));});return new EventEmitter();
  }}),/source_too_large/);
});

test('text and structured records keep exact source locations and never truncate',()=>{
  const records=parseRecords('가나다\nsecond\n','text','s1');
  assert.equal(records[1].offset,4);assert.equal(records[0].text,'가나다');
  const row=parseRecords('{"text":"a\\nb"}\n{"text":"c"}','jsonl','s2');
  assert.equal(row[0].text,'a\nb');assert.equal(row[1].record_index,1);
  assert.equal(row[1].offset,0);assert.equal(row[1].source_line_offset,'{"text":"a\\nb"}\n'.length);
  assert.equal(parseRecords('[{"text":"a"},"b"]','json','s3')[1].text,'b');
  assert.throws(()=>parseRecords('a'.repeat(1501),'text','s1'));
  assert.throws(()=>parseRecords('x\n'.repeat(97),'text','s1'));
  assert.throws(()=>parseRecords('[{"missing":"a"}]','json','s1'));
});
