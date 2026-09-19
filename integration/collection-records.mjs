const MAX_SOURCE_BYTES=1024*1024,MAX_RECORD_BYTES=1500,OVERLAP=80;
const forbidden=new Set(['__proto__','prototype','constructor']);
const byteLength=value=>Buffer.byteLength(value,'utf8');
const own=(value,key)=>Object.hasOwn(value,key);
const protectedText=/error|failed|fatal|traceback|constraints?|must|never|user[\s_-]+request|요구사항|제약|수정\s*금지/i;
const safeKey=key=>typeof key==='string'&&key.length>0&&byteLength(key)<=128&&!forbidden.has(key);
const isHigh=unit=>unit>=0xd800&&unit<=0xdbff;
const isLow=unit=>unit>=0xdc00&&unit<=0xdfff;

function validateUnicode(value) {
  for(let index=0;index<value.length;index++) {
    const unit=value.charCodeAt(index);
    if(isHigh(unit)){if(!isLow(value.charCodeAt(index+1)))throw Error('invalid_unicode');index++;}
    else if(isLow(unit))throw Error('invalid_unicode');
  }
}
function boundedEnd(value,start) {
  let end=start,size=0;
  while(end<value.length) {
    const point=value.codePointAt(end),width=point>0xffff?2:1,count=point<0x80?1:point<0x800?2:point<0x10000?3:4;
    if(size+count>MAX_RECORD_BYTES)break;
    size+=count;end+=width;
  }
  return end;
}
function* lines(text) {
  let offset=0,index=0;
  while(offset<text.length) {
    const newline=text.indexOf('\n',offset),end=newline<0?text.length:newline;
    yield {text:text.slice(offset,end),offset,line_index:index++};
    if(newline<0)return;
    offset=end+1;
  }
}
function primitive(value) {
  return value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);
}
function projection(row,keys,cellSpans) {
  if(!row||typeof row!=='object'||Array.isArray(row))throw Error('record_object_required');
  let text='';
  const fields=[];
  for(const key of keys) {
    if(!own(row,key))throw Error('record_field_missing');
    const value=row[key];
    if(!primitive(value))throw Error('projection_primitive_required');
    const rendered=value===null?'null':String(value);
    validateUnicode(rendered);
    if(text)text+='\n';
    const start=text.length;
    text+=key+': ';
    const valueStart=text.length;
    text+=rendered;
    fields.push({key,value_type:value===null?'null':typeof value,span:{start,end:text.length},
      value_span:{start:valueStart,end:text.length},...(cellSpans?.[key]?{source_span:cellSpans[key]}:{})});
  }
  return {text,representation:'fields',fields,text_fields:[...keys]};
}
function structured(row,keys,cellSpans) {
  if(keys.length)return projection(row,keys,cellSpans);
  if(typeof row==='string')return {text:row,representation:'value',fields:[]};
  if(!row||typeof row!=='object'||Array.isArray(row)||!own(row,'text')||typeof row.text!=='string')throw Error('record_text_required');
  return {text:row.text,representation:'text_field',fields:[{key:'text',value_type:'string',span:{start:0,end:row.text.length},
    value_span:{start:0,end:row.text.length},...(cellSpans?.text?{source_span:cellSpans.text}:{})}],text_fields:['text']};
}
function atPath(root,components) {
  let current=root;
  for(const component of components) {
    if(Array.isArray(current)) {
      if(!Number.isSafeInteger(component)||component<0||component>=current.length||!own(current,component))throw Error('invalid_records_path');
    }else if(!current||typeof current!=='object'||typeof component!=='string'||!own(current,component))throw Error('invalid_records_path');
    current=current[component];
  }
  if(!Array.isArray(current))throw Error('json_array_required');
  return current;
}

// RFC 4180 quoting with CRLF or LF record separators. Cell source spans include quotes.
function* csvRows(text) {
  let index=text.startsWith('\ufeff')?1:0,rowStart=index,fieldStart=index,value='',cells=[],quoted=false,closed=false,started=false;
  const finish=end=>{
    if(cells.length>=256)throw Error('narrow_source_first');
    cells.push({value,source_span:{start:fieldStart,end}});value='';quoted=false;closed=false;started=false;
  };
  while(index<text.length) {
    const char=text[index];
    if(quoted) {
      if(char==='"') {
        if(text[index+1]==='"'){value+='"';index+=2;continue;}
        quoted=false;closed=true;index++;continue;
      }
      value+=char;index++;continue;
    }
    if(char===','||char==='\n'||char==='\r') {
      const end=index;
      if(char==='\r'&&text[index+1]!=='\n')throw Error('invalid_csv');
      finish(end);
      index+=char==='\r'?2:1;
      fieldStart=index;
      if(char!==','){yield {cells,source_span:{start:rowStart,end}};cells=[];rowStart=index;}
      continue;
    }
    if(closed)throw Error('invalid_csv');
    if(char==='"') {
      if(started)throw Error('invalid_csv');
      quoted=true;started=true;index++;continue;
    }
    value+=char;started=true;index++;
  }
  if(quoted)throw Error('invalid_csv');
  if(cells.length||started||closed){finish(index);yield {cells,source_span:{start:rowStart,end:index}};}
}

/** Convert a bounded raw source into records. All offsets and spans are UTF-16. */
export function recordsFrom(text,source,id,{maxRecords=768,chunkText=true}={}) {
  if(typeof text!=='string'||byteLength(text)>MAX_SOURCE_BYTES)throw Error('source_too_large');
  validateUnicode(text);
  if(!source||typeof source!=='object'||Array.isArray(source)||!['text','json','jsonl','csv'].includes(source.format))throw Error('invalid_format');
  if(typeof id!=='string'||!id||byteLength(id)>80)throw Error('invalid_source_id');
  if(!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>768||typeof chunkText!=='boolean')throw Error('invalid_record_options');
  const keys=source.text_fields===undefined?[]:source.text_fields,components=source.records_path===undefined?[]:source.records_path;
  if(!Array.isArray(keys)||keys.length>32||keys.some(key=>!safeKey(key))||new Set(keys).size!==keys.length||
    source.format==='text'&&keys.length)throw Error('invalid_text_fields');
  if(!Array.isArray(components)||components.length>32||components.some(component=>typeof component==='string'?!safeKey(component):!Number.isSafeInteger(component)||component<0)||
    source.format!=='json'&&components.length)throw Error('invalid_records_path');
  const records=[];
  const add=(item,metadata={})=>{
    const value=item.text;
    if(typeof value!=='string')throw Error('record_text_required');
    validateUnicode(value);
    if(!value.trim())return;
    if(!chunkText&&byteLength(value)>MAX_RECORD_BYTES)throw Error('narrow_source_first');
    const protect=protectedText.test(value);
    let start=0,previousEnd=0,index=0;
    while(start<value.length) {
      if(records.length>=maxRecords)throw Error('narrow_source_first');
      const end=boundedEnd(value,start),raw=source.format==='text';
      const fields=(item.fields??[]).filter(field=>field.span.end>start&&field.span.start<end).map(field=>{
        const from=Math.max(start,field.value_span.start),to=Math.min(end,field.value_span.end);
        return {...field,value_chunk_span:from<=to?{start:from,end:to}:null,
          context_before:field.span.start<start,context_after:field.span.end>end};
      });
      records.push({id:`${id}r${records.length+1}`,source:id,text:value.slice(start,end),
        offset:(raw?metadata.source_line_offset:0)+start,offset_basis:raw?'source':'representation',
        representation:item.representation,...metadata,...(item.text_fields?{text_fields:item.text_fields}:{}),fields,
        protected:protect,chunk:{index,start,end,total_length:value.length,overlap_before:index?previousEnd-start:0,
          context_before:start>0,context_after:end<value.length,unit:'utf16'},
        ...(raw?{source_span:{start:metadata.source_line_offset+start,end:metadata.source_line_offset+end}}:{})});
      if(end===value.length)break;
      previousEnd=end;
      start=Math.max(start+1,end-OVERLAP);
      if(isLow(value.charCodeAt(start))&&isHigh(value.charCodeAt(start-1)))start--;
      index++;
    }
  };
  if(source.format==='text') {
    for(const line of lines(text))add({text:line.text,representation:'raw_text'},{source_line_offset:line.offset,line_index:line.line_index});
  }else if(source.format==='json') {
    const rows=atPath(JSON.parse(text),components);
    for(let index=0;index<rows.length;index++)add(structured(rows[index],keys),{record_index:index,records_path:[...components]});
  }else if(source.format==='jsonl') {
    let index=0;
    for(const line of lines(text))if(line.text.trim())add(structured(JSON.parse(line.text),keys),
      {record_index:index++,source_line_offset:line.offset,source_line_index:line.line_index});
  }else {
    const iterator=csvRows(text),header=iterator.next();
    if(header.done)throw Error('csv_header_required');
    const headers=header.value.cells.map(cell=>cell.value);
    if(headers.some(key=>!safeKey(key))||new Set(headers).size!==headers.length)throw Error('invalid_csv_headers');
    if((keys.length?keys:['text']).some(key=>!headers.includes(key)))throw Error('record_field_missing');
    let index=0;
    for(const row of iterator) {
      if(row.cells.length!==headers.length)throw Error('invalid_csv');
      const object=Object.create(null),spans=Object.create(null);
      headers.forEach((key,column)=>{object[key]=row.cells[column].value;spans[key]=row.cells[column].source_span;});
      add(structured(object,keys,spans),{record_index:index++,source_line_offset:row.source_span.start,source_row_span:row.source_span});
    }
  }
  return records;
}
