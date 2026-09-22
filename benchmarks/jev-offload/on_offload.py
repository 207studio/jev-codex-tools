"""Optional reproduction helper; it does not run unless explicitly invoked."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
runner = os.environ.get('JEV_MODE_BIN', 'jev-mode')
command = [runner, 'batch', '--items', 'items.jsonl', '--questions', 'questions.json', '--out', 'jev-answers.jsonl', '--pool', '4', '--retries', '0', '--model', 'jev-1.13.0']
completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
for name, text in [('jev.stdout.log', completed.stdout), ('jev.stderr.log', completed.stderr), ('jev.exit', str(completed.returncode) + '\n')]:
    with os.fdopen(os.open(ROOT / name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as log:
        log.write(text)
if completed.returncode:
    print(json.dumps({'exit_code': completed.returncode}))
    sys.exit(completed.returncode)
rows = [json.loads(line) for line in (ROOT / 'jev-answers.jsonl').read_text(encoding='utf-8').splitlines()]
assert len(rows) == 24
predictions = []
for row in rows:
    answer = (row.get('answers') or {}).get('decision')
    assert answer and not row.get('error')
    predictions.append({'id': row['id'], 'choice': answer['choice'] if answer['confidence'] >= 0.9 else 'unknown'})
(ROOT / 'predictions.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in predictions), encoding='utf-8')
usage = json.loads(completed.stdout)
print(json.dumps({'items': len(predictions), 'unknown': sum(row['choice'] == 'unknown' for row in predictions),
    'jev_input_tokens': usage['input_tokens'], 'jev_output_tokens': usage['output_tokens'], 'exit_code': 0}))
