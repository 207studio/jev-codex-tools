import json
import sys
from pathlib import Path

ITEMS = Path(__file__).with_name('items.jsonl')
items = [json.loads(line) for line in ITEMS.read_text(encoding='utf-8').splitlines()]
page = int(sys.argv[1])
assert 0 <= page < 4
payload = json.dumps(items[page * 6:(page + 1) * 6], ensure_ascii=False, separators=(',', ':'))
assert len(payload.encode('utf-8')) <= 4000
print(payload)
