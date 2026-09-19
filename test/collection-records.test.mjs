import test from 'node:test';
import assert from 'node:assert/strict';
import {recordsFrom} from '../integration/collection-records.mjs';

const raw=(text,options)=>recordsFrom(text,{format:'text'},'s1',options);
const reconstruct=records=>records.map((record,index)=>record.text.slice(index?record.chunk.overlap_before:0)).join('');

test('wrapped JSON records_path and flat primitive projection preserve field values',()=>{
  const input={result:{groups:[{items:[{title:'줄1\n줄2',count:3,active:true,note:null,ignored:{large:'not projected'}}]}]}};
  const [record]=recordsFrom(JSON.stringify(input),{format:'json',records_path:['result','groups',0,'items'],text_fields:['title','count','active','note']},'s2');
  assert.equal(record.text,'title: 줄1\n줄2\ncount: 3\nactive: true\nnote: null');assert.equal(record.representation,'fields');assert.equal(record.offset_basis,'representation');assert.equal(record.record_index,0);
  assert.deepEqual(record.records_path,['result','groups',0,'items']);assert.deepEqual(record.text_fields,['title','count','active','note']);
  assert.deepEqual(record.fields.map(field=>record.text.slice(field.value_span.start,field.value_span.end)),['줄1\n줄2','3','true','null']);
  assert.deepEqual(record.fields.map(field=>field.value_type),['string','number','boolean','null']);assert.ok(!record.text.includes('not projected'));
});

test('prior JSON string and own text-field contract remains exact',()=>{
  const records=recordsFrom(JSON.stringify(['가😀\n나',{text:'  spaced  ',ignored:'x'}]),{format:'json'},'s3');
  assert.equal(records[0].text,'가😀\n나');assert.equal(records[0].representation,'value');assert.equal(records[1].text,'  spaced  ');assert.equal(records[1].representation,'text_field');assert.equal(records[1].record_index,1);assert.equal(records[1].offset,0);
});

test('JSONL projection retains physical line offsets and logical record indices',()=>{
  const first='{"name":"가😀","ok":false}',second='{"name":"다","ok":true}',input=`\n${first}\r\n\n${second}\n`;
  const records=recordsFrom(input,{format:'jsonl',text_fields:['name','ok']},'s4');
  assert.equal(records[0].source_line_offset,1);assert.equal(records[0].source_line_index,1);assert.equal(records[1].source_line_offset,input.indexOf(second));assert.equal(records[1].source_line_index,3);assert.deepEqual(records.map(record=>record.record_index),[0,1]);
  assert.equal(records[0].text,'name: 가😀\nok: false');assert.equal(records[1].text,'name: 다\nok: true');
});

test('CSV handles commas, escaped quotes, quoted newlines and Unicode without changing values',()=>{
  const input='name,note,count\r\n"홍,길동","줄1\n줄2 ""인용"" 😀",3\r\nJane,"",0\r\n';
  const records=recordsFrom(input,{format:'csv',text_fields:['name','note','count']},'s5');
  assert.equal(records.length,2);assert.equal(records[0].text,'name: 홍,길동\nnote: 줄1\n줄2 "인용" 😀\ncount: 3');assert.equal(records[1].text,'name: Jane\nnote: \ncount: 0');
  assert.equal(records[0].representation,'fields');assert.equal(records[0].source_line_offset,input.indexOf('"홍'));
  const note=records[0].fields.find(field=>field.key==='note');assert.equal(input.slice(note.source_span.start,note.source_span.end),'"줄1\n줄2 ""인용"" 😀"');
  assert.equal(input.slice(records[0].source_row_span.start,records[0].source_row_span.end),'"홍,길동","줄1\n줄2 ""인용"" 😀",3');
});

test('CSV without projections requires its text column and preserves decoded text',()=>{
  const records=recordsFrom('\ufefftext,other\n"exact, ""quoted""",unused\n',{format:'csv'},'s6');
  assert.equal(records[0].text,'exact, "quoted"');assert.equal(records[0].representation,'text_field');assert.equal(records[0].fields[0].key,'text');
});

test('UTF-8 chunks reconstruct exact long raw lines with overlap and no surrogate split',()=>{
  const first='  '+('가😀ab'.repeat(700))+'  ',text=`short\n${first}\r\nlast`,records=raw(text),chunks=records.filter(record=>record.line_index===1);
  assert.ok(chunks.length>1);assert.equal(reconstruct(chunks),first+'\r');assert.equal(new Set(records.map(record=>record.id)).size,records.length);
  for(const record of records) {
    assert.ok(Buffer.byteLength(record.text)<=1500);assert.equal(text.slice(record.offset,record.offset+record.text.length),record.text);assert.equal(text.slice(record.source_span.start,record.source_span.end),record.text);
    assert.ok(!/^[\uDC00-\uDFFF]/.test(record.text));assert.ok(!/[\uD800-\uDBFF]$/.test(record.text));assert.equal(record.chunk.unit,'utf16');
  }
  for(const record of chunks.slice(1)){assert.ok(record.chunk.overlap_before>=80&&record.chunk.overlap_before<=81);assert.equal(record.chunk.context_before,true);}
  assert.equal(chunks[0].chunk.context_before,false);assert.equal(chunks.at(-1).chunk.context_after,false);
});

test('projected long values retain exact representation spans through chunks',()=>{
  const value='😀가'.repeat(1000),expected=`title: ${value}\ncount: 2`;
  const records=recordsFrom(JSON.stringify([{title:value,count:2}]),{format:'json',text_fields:['title','count']},'s7');
  assert.equal(reconstruct(records),expected);assert.ok(records.length>1);
  for(const record of records) {
    assert.equal(record.offset,record.chunk.start);assert.equal(record.record_index,0);assert.equal(record.representation,'fields');assert.equal(expected.slice(record.chunk.start,record.chunk.end),record.text);
    for(const field of record.fields)if(field.value_chunk_span){const span=field.value_chunk_span;assert.ok(span.start>=record.chunk.start&&span.end<=record.chunk.end);assert.equal(record.text.slice(span.start-record.chunk.start,span.end-record.chunk.start),expected.slice(span.start,span.end));}
  }
});

test('protection markers propagate to every chunk of the original record',()=>{
  for(const marker of ['ERROR','failed','fatal','Traceback','constraints','must','never','user request','요구사항','제약','수정금지']) {
    const text=marker+': '+('x'.repeat(3200)),records=raw(text);assert.ok(records.length>1);assert.ok(records.every(record=>record.protected));assert.equal(reconstruct(records),text);
  }
  assert.equal(raw('ordinary source line')[0].protected,false);
});

test('maxRecords overflow and disabled chunking throw instead of silently omitting content',()=>{
  assert.equal(raw('a\nb',{maxRecords:2}).length,2);assert.throws(()=>raw('a\nb\nc',{maxRecords:2}),/narrow_source_first/);
  assert.throws(()=>raw('가'.repeat(1500),{maxRecords:2}),/narrow_source_first/);assert.throws(()=>raw('x'.repeat(1501),{chunkText:false}),/narrow_source_first/);
  assert.throws(()=>recordsFrom(JSON.stringify(['a','b','c']),{format:'json'},'s8',{maxRecords:2}),/narrow_source_first/);
  assert.throws(()=>recordsFrom('text\na\nb\nc\n',{format:'csv'},'s8',{maxRecords:2}),/narrow_source_first/);
});

test('path/prototype traversal, nonprimitive projections and invalid options are rejected',()=>{
  const text=JSON.stringify({items:[{name:'a',nested:{x:1}}]});
  for(const records_path of [null,'items',['__proto__'],['constructor'],['items','length'],['items',-1],['missing']])assert.throws(()=>recordsFrom(text,{format:'json',records_path},'s9'),/records_path|json_array_required/);
  for(const text_fields of [null,'name',['__proto__'],['constructor'],['name','name'],['missing'],['nested']])assert.throws(()=>recordsFrom(text,{format:'json',records_path:['items'],text_fields},'s9'),/text_fields|record_field_missing|projection_primitive_required/);
  assert.throws(()=>recordsFrom('a',{format:'text',text_fields:['x']},'s9'),/invalid_text_fields/);assert.throws(()=>recordsFrom('"a"',{format:'jsonl',records_path:['items']},'s9'),/invalid_records_path/);
  assert.throws(()=>recordsFrom('[1]',{format:'json'},'s9'),/record_text_required/);assert.throws(()=>raw('x',{maxRecords:769}),/invalid_record_options/);
  assert.throws(()=>raw('x'.repeat(1024*1024+1)),/source_too_large/);assert.throws(()=>raw('\ud800'),/invalid_unicode/);
});

test('malformed CSV, duplicate/unsafe headers and ragged rows are rejected',()=>{
  for(const text of ['text,text\na,b','text,__proto__\na,b','text\n"unfinished','text\n"done"junk','text\na"b','text,other\nonly-one','text\na\rb'])assert.throws(()=>recordsFrom(text,{format:'csv'},'s10'),/invalid_csv/);
  assert.throws(()=>recordsFrom('',{format:'csv'},'s10'),/csv_header_required/);assert.throws(()=>recordsFrom('name\na',{format:'csv'},'s10'),/record_field_missing/);
});
