import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
items = [json.loads(line) for line in (ROOT / 'items.jsonl').read_text(encoding='utf-8').splitlines()]
expected = json.loads((ROOT / 'expected.json').read_text(encoding='utf-8'))
questions = json.loads((ROOT / 'questions.json').read_text(encoding='utf-8'))
assert len(items) == len(expected) == 24
assert [item['id'] for item in items] == list(expected)
assert set(expected.values()) == set(questions['decision']['criteria'])
assert all(set(item) == {'id', 'text'} and len(item['text'].encode('utf-8')) <= 4000 for item in items)
print(json.dumps({'items': len(items), 'expected': len(expected), 'choices': len(questions['decision']['criteria'])}))
