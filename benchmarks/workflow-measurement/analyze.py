#!/usr/bin/env python3
"""Aggregate every recorded run without replacing failures or imputing missing tokens."""
import argparse,json,statistics
from pathlib import Path

FIELDS=['input_tokens','cached_input_tokens','uncached_input_tokens','output_tokens','reasoning_output_tokens','astra_seconds','prompt_bytes','preprocess_ms']

def stats(values):
    return None if not values or any(v is None for v in values) else {'mean':statistics.mean(values),'min':min(values),'max':max(values),'sum':sum(values)}

def provider_tokens(run,key):
    if run['jev_requests']==0:return 0
    providers=run['jev_provider'];values=[(r.get('usage') or {}).get(key) for r in providers]
    return sum(values) if len(values)==run['jev_requests'] and all(isinstance(v,int) for v in values) else None

def main():
    p=argparse.ArgumentParser();p.add_argument('results',type=Path);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    source=json.loads(a.results.read_text());runs=source['runs'];groups={}
    for label in ['A','B','C']:
        selected=[r for r in runs if r['run'].startswith(label)]
        groups[label]={'runs':len(selected),'exit_success':sum(r['exit']==0 for r in selected),'scores':{k:sum(r['scores'][k] for r in selected) for k in ['correct','wrong','unknown','malformed']},'metrics':{k:stats([r.get(k) for r in selected]) for k in FIELDS},'jev_requests':sum(r['jev_requests'] for r in selected),'jev_input_tokens':stats([provider_tokens(r,'input_tokens') for r in selected]),'jev_output_tokens':stats([provider_tokens(r,'output_tokens') for r in selected])}
    comparisons={}
    for label in ['B','C']:
        comparisons[label+'_vs_A']={}
        for field in FIELDS:
            base=groups['A']['metrics'][field];value=groups[label]['metrics'][field]
            comparisons[label+'_vs_A'][field+'_reduction_percent']=100*(1-value['mean']/base['mean']) if base and value and base['mean'] else None
    result={'manifest_sha256':source['manifest_sha256'],'missing_runs':source['missing_runs'],'groups':groups,'comparisons':comparisons,'runs':runs,'interpretation_limits':['Six constructed routing cases repeated twice; not independent task samples','Treatment supplies precomputed routes; no implementation or task execution measured','Astra cache state uncontrolled; raw input reductions do not equal quota or money saved','Jev token counts and benchmark setup overhead are separate','Code-only UNKNOWN is not a correct answer']}
    with a.out.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps({'groups':groups,'comparisons':comparisons}))

if __name__=='__main__':main()
