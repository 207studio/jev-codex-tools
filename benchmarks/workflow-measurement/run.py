#!/usr/bin/env python3
"""Run the frozen A/B/C protocol; raw stdout/stderr remain in the private output directory."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write_new(path,value):
    with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n')
    path.chmod(0o600)

def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--runtime',type=Path,required=True);p.add_argument('--codex',type=Path,required=True);p.add_argument('--node',type=Path,required=True);p.add_argument('--env-file',type=Path,required=True);a=p.parse_args()
    fixture=Path(__file__).resolve().parent;out=a.out.resolve();out.mkdir(parents=True,exist_ok=True);out.chmod(0o700)
    expected=json.loads((fixture/'expected.json').read_text());cases=json.loads((fixture/'cases.json').read_text());common=(fixture/'prompt.txt').read_text()
    assert len(cases)==6 and {c['id'] for c in cases}==set(expected)
    order=['A1','B1','C1','C2','B2','A2'];flags=['exec','--json','--ephemeral','--ignore-user-config','-c','project_doc_max_bytes=0','-c','model_reasoning_effort="ultra"','-c','tool_output_token_limit=1000','-m','gpt-6-astra','-s','read-only','--skip-git-repo-check']
    manifest={'started_unix':time.time(),'order':order,'cli_flags':flags,'files':{p.name:digest(p) for p in fixture.iterdir() if p.is_file()},'runtime_files':{name:digest(a.runtime/'integration'/name) for name in ['workflow-policy.mjs','workflow-cli.mjs','choice.mjs']},'codex_sha256':digest(a.codex),'node_version':subprocess.check_output([str(a.node),'--version'],text=True).strip(),'codex_version':subprocess.check_output([str(a.codex),'--version'],text=True).strip()}
    write_new(out/'manifest.json',manifest)
    env={k:v for k,v in os.environ.items() if not k.startswith(('JEV_','TYPESAFE_'))};pre=out/'prepared'
    with (out/'preprocess.stdout.log').open('x') as stdout,(out/'preprocess.stderr.log').open('x') as stderr:
        r=subprocess.run([str(a.node),'--env-file='+str(a.env_file),str(fixture/'preprocess.mjs'),str(a.runtime),str(fixture),str(pre)],env=env,stdout=stdout,stderr=stderr)
    write_new(out/'preprocess.exit.json',{'exit':r.returncode})
    if r.returncode:raise SystemExit('preprocessing failed; retain logs, do not rerun the same experiment')
    reports=[]
    for label in order:
        trial=out/label;trial.mkdir();workspace=trial/'workspace';workspace.mkdir()
        prep={'records':cases,'cold_ms':0,'requests':0,'provider':[]} if label[0]=='A' else json.loads((pre/(label+'.json')).read_text())
        prompt=common+json.dumps(prep['records'],separators=(',',':'))+'\n';(trial/'prompt.txt').write_text(prompt)
        cmd=[str(a.codex),*flags,'-C',str(workspace),'-o',str(trial/'final.txt'),'-'];start=time.monotonic();timeout=False
        with (trial/'events.jsonl').open('x') as stdout,(trial/'stderr.log').open('x') as stderr:
            try:r=subprocess.run(cmd,input=prompt,text=True,env=env,stdout=stdout,stderr=stderr,timeout=120);exit_code=r.returncode
            except subprocess.TimeoutExpired:timeout=True;exit_code=None
        elapsed=time.monotonic()-start;events=[]
        for line in (trial/'events.jsonl').read_text().splitlines():
            try:events.append(json.loads(line))
            except json.JSONDecodeError:pass
        usages=[e['usage'] for e in events if e.get('type')=='turn.completed' and isinstance(e.get('usage'),dict)];usage=usages[-1] if usages else {}
        predictions=None;malformed=False
        try:
            predictions=json.loads((trial/'final.txt').read_text());assert isinstance(predictions,dict) and set(predictions)==set(expected) and all(isinstance(x,str) for x in predictions.values())
        except Exception:malformed=True
        scores={'correct':0,'wrong':0,'unknown':0,'malformed':len(expected) if malformed else 0}
        if not malformed:
            for key,want in expected.items():scores['correct' if predictions[key]==want else 'unknown' if predictions[key]=='UNKNOWN' else 'wrong']+=1
        input_tokens=usage.get('input_tokens');cached=usage.get('cached_input_tokens')
        report={'run':label,'exit':exit_code,'timeout':timeout,'completed_turns':len(usages),'prompt_bytes':len(prompt.encode()),'input_tokens':input_tokens,'cached_input_tokens':cached,'uncached_input_tokens':input_tokens-cached if isinstance(input_tokens,int) and isinstance(cached,int) else None,'output_tokens':usage.get('output_tokens'),'reasoning_output_tokens':usage.get('reasoning_output_tokens'),'astra_seconds':round(elapsed,3),'preprocess_ms':prep['cold_ms'],'jev_requests':prep['requests'],'jev_provider':prep['provider'],'warm_additional_requests':prep.get('warm_additional_requests'),'scores':scores,'predictions':predictions,'event_types':sorted(set(e.get('type','') for e in events)),'tool_items':sum(e.get('item',{}).get('type') in ['command_execution','mcp_tool_call','web_search'] for e in events if e.get('type')=='item.completed'),'events_sha256':digest(trial/'events.jsonl'),'prompt_sha256':digest(trial/'prompt.txt')}
        write_new(trial/'run.json',report);reports.append(report);print(json.dumps({k:report[k] for k in ['run','exit','input_tokens','cached_input_tokens','output_tokens','scores','jev_requests','tool_items']}),flush=True)
        errors='\n'.join(str(e.get('error',''))+' '+str(e.get('message','')) for e in events if e.get('type') in ['error','turn.failed'])
        if any(s in errors.lower() for s in ['usage limit','rate limit','not authenticated','unauthorized','insufficient credits']):break
    write_new(out/'results.json',{'manifest_sha256':digest(out/'manifest.json'),'planned_runs':order,'runs':reports,'missing_runs':[x for x in order if x not in [r['run'] for r in reports]]})

if __name__=='__main__':main()
