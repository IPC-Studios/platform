import json, re, os

D = r'C:\Users\vishu\AppData\Local\Temp\claude\E--BuildOurs-IPC-Studios-CRM\15195dc1-4c7e-41df-9304-9a897d9b706e\scratchpad'
old = json.load(open(os.path.join(D, 'old-app.json'), encoding='utf-8-sig'))
new = json.load(open(os.path.join(D, 'new-app.json'), encoding='utf-8-sig'))

def norm(s):
    s = s.lower().strip()
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'[\u20b9$,]', '', s)
    s = re.sub(r'\d+', '#', s)          # "completed0" vs "completed3"
    s = re.sub(r'[^a-z# ]', '', s).strip()
    return s

KINDS = ['tabs', 'steps', 'labels', 'cols', 'btns', 'opts']

rows = []
for path, o in old.items():
    n = new.get(path, {})
    if 'error' in o:
        continue
    missing = {}
    for k in KINDS:
        ov = {norm(x): x for x in o.get(k, []) if norm(x)}
        nv = {norm(x) for x in n.get(k, []) if norm(x)}
        # An item present anywhere on our screen counts as present.
        nv_all = set()
        for kk in KINDS:
            nv_all |= {norm(x) for x in n.get(kk, []) if norm(x)}
        gone = [label for key, label in ov.items() if key not in nv_all]
        if gone:
            missing[k] = gone
    total_old = sum(len(o.get(k, [])) for k in KINDS)
    total_missing = sum(len(v) for v in missing.values())
    rows.append({
        'path': path,
        'ours': n.get('ours', '—'),
        'old_items': total_old,
        'missing': total_missing,
        'pct': round(100 * total_missing / total_old) if total_old else 0,
        'detail': missing,
    })

rows.sort(key=lambda r: (-r['missing'], -r['pct']))

print(f"{'old screen':<34}{'ours':<28}{'old':>4}{'miss':>6}{'%':>5}")
print('-' * 80)
for r in rows:
    if r['missing'] == 0:
        continue
    print(f"{r['path']:<34}{r['ours']:<28}{r['old_items']:>4}{r['missing']:>6}{r['pct']:>4}%")

clean = [r['path'] for r in rows if r['missing'] == 0]
print(f"\nAt parity or better ({len(clean)}): {', '.join(clean)}")

with open(os.path.join(D, 'gaps.json'), 'w', encoding='utf-8') as f:
    json.dump(rows, f, indent=1)
print(f"\nwrote gaps.json ({len(rows)} screens)")
