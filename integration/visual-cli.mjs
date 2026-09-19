import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {enabled} from './features.mjs';
import {boundedJSON} from './collection-artifacts.mjs';
import {digest} from './collection-sources.mjs';
import {review} from './visual-review.mjs';
import {applyTokens} from './visual-tokens.mjs';

try {
  const {values}=parseArgs({options:{spec:{type:'string'},apply:{type:'boolean'},execute:{type:'boolean'},help:{type:'boolean'}}});
  if (values.help) console.log('jev-visual --spec FILE [--apply --execute]\nStructured layout checks or finite candidate selection; Jev never reads pixels. Optional apply changes existing flat design-tokens.json or NAME.tokens.json inside cwd using an exact expected hash and explicit keys.');
  else {
    if (!values.spec || Boolean(values.apply)!==Boolean(values.execute)) throw Error('invalid_arguments');
    if (!enabled('visual_review')) console.log(JSON.stringify({status:'DISABLED',pixel_review:'NOT_PERFORMED'}));
    else {
      const {data:spec,text}=await boundedJSON(values.spec,65536);
      const {destination,...input}=spec;
      const result=await review(input,{active:true});
      let application={applied:false};
      if (values.apply) {
        const chosen=result.candidate_measurements?.find(item=>item.id===result.selected?.id);
        if (spec.mode!=='pick' || !result.selected || !Number.isFinite(result.decision?.confidence) || result.decision.confidence<0.9 || chosen?.measurement?.status!=='PASS') {
          application={applied:false,reason:'no_confirmed_candidate'};process.exitCode=3;
        } else {
          // Candidate/spec edits during the model call invalidate the operation.
          if (digest(await readFile(values.spec))!==digest(text)) throw Error('stale_visual_spec');
          application=await applyTokens(destination,result.selected.tokens);
        }
      }
      const packet={status:result.status,decision:result.decision,selected_id:result.selected?.id??null,
        check_counts:result.measurement?.checks?.reduce((counts,{status})=>({...counts,[status]:(counts[status]||0)+1}),{}),
        candidate_checks:result.candidate_measurements?.map(({id,measurement})=>({id,status:measurement.status})),
        evidence_hash:result.evidence_hash,scope:'supplied_metrics_only',pixel_review:'NOT_PERFORMED',...application};
      const output=JSON.stringify(packet);
      console.log(Buffer.byteLength(output)<=4000?output:JSON.stringify({status:result.status,selected_id:result.selected?.id??null,evidence_hash:result.evidence_hash,applied:application.applied,pixel_review:'NOT_PERFORMED',details:'Use the supplied spec and existing token file for full values.'}));
    }
  }
} catch (error) {
  const known=new Set(['invalid_arguments','stale_visual_spec','invalid_token_destination','token_destination_outside_scope','token_symlink','invalid_token_file','stale_token_file','token_file_too_large','narrow_visual_result']);
  console.log(JSON.stringify({status:'UNKNOWN',reason:known.has(error.message)?error.message:'invalid_or_unavailable_visual_evidence',applied:false,pixel_review:'NOT_PERFORMED'}));
  process.exitCode=2;
}
