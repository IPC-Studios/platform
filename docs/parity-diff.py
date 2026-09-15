"""Diff two parity captures and rank screens by what the old app has and we don't.

Usage:
    python docs/parity-diff.py old-app.json new-app.json

The numbers are leads, not verdicts. Read docs/parity-live.md before acting on
them — there are known false-positive sources and every row needs eyes before
it becomes work.
"""
import json
import re
import sys

KINDS = ['tabs', 'steps', 'fields', 'cols', 'actions', 'opts']

# An accessible name often carries the row's subject: "Delete Priya Sharma".
# The old app labels the same control just "Delete". Reduce both to the verb so
# they compare, or every table row reads as a missing feature.
VERBS = {
    'view', 'edit', 'delete', 'remove', 'add', 'new', 'open', 'select', 'export',
    'import', 'download', 'send', 'resend', 'copy', 'print', 'save', 'clear',
    'filter', 'sort', 'search', 'mark', 'issue', 'generate', 'apply', 'seed',
    'next', 'back', 'cancel', 'close', 'discard', 'assign', 'book', 'record',
    'manage', 'refresh', 'retry', 'preview', 'share', 'duplicate', 'archive',
    'deactivate', 'activate', 'rename', 'toggle', 'change', 'drag', 'move',
    'run', 'start', 'stop', 'pause', 'resume', 'connect', 'disconnect', 'reset',
}

# An item on many screens of the same app is chrome — nav, a global header, a
# settings sidebar — not a feature of the screen being compared. Counting it
# makes every settings sub-page look 75% missing because the two apps organise
# their settings nav differently.
UBIQUITY = 5


def norm(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'[₹$,]', '', s)
    s = re.sub(r'\d+', '#', s)            # "completed0" vs "completed3"
    s = re.sub(r'[^a-z# ]', '', s).strip()
    head = s.split(' ')[0] if s else ''
    return head if head in VERBS else s


def chrome(capture: dict) -> set:
    """Normalised items that appear on UBIQUITY or more screens of one app."""
    seen = {}
    for screen in capture.values():
        if not isinstance(screen, dict):
            continue
        keys = {norm(x) for k in KINDS for x in screen.get(k, []) if norm(x)}
        for key in keys:
            seen[key] = seen.get(key, 0) + 1
    return {k for k, n in seen.items() if n >= UBIQUITY}


def main(old_path: str, new_path: str) -> None:
    old = json.load(open(old_path, encoding='utf-8-sig'))
    new = json.load(open(new_path, encoding='utf-8-sig'))
    skip = chrome(old) | chrome(new)

    rows = []
    for path, o in old.items():
        if 'error' in o:
            continue
        n = new.get(path, {})
        ours_all = set()
        for k in KINDS:
            ours_all |= {norm(x) for x in n.get(k, []) if norm(x)}
        ours_all |= skip

        # Dedupe across kinds too: a control that shows up as both a field and
        # an action is one missing thing, not two — otherwise `missing` can
        # exceed the number of distinct old items and the percentage passes 100.
        missing = {}
        counted = set()
        for k in KINDS:
            seen = {}
            for item in o.get(k, []):
                key = norm(item)
                if key and key not in ours_all and key not in counted:
                    seen[key] = item
                    counted.add(key)
            if seen:
                missing[k] = list(seen.values())

        total_old = len({norm(x) for k in KINDS for x in o.get(k, []) if norm(x)} - skip)
        total_missing = len(counted)
        rows.append({
            'path': path,
            'ours': n.get('ours', '—'),
            'old_items': total_old,
            'missing': total_missing,
            'pct': round(100 * total_missing / total_old) if total_old else 0,
            'ours_empty': sum(len(n.get(k, [])) for k in KINDS) == 0,
            'detail': missing,
        })

    rows.sort(key=lambda r: (-r['missing'], -r['pct']))

    print(f"{'old screen':<32}{'ours':<28}{'old':>4}{'miss':>6}{'%':>5}  note")
    print('-' * 86)
    for r in rows:
        if not r['missing']:
            continue
        note = 'OUR CAPTURE EMPTY — recheck' if r['ours_empty'] else ''
        print(f"{r['path']:<32}{r['ours']:<28}{r['old_items']:>4}{r['missing']:>6}{r['pct']:>4}%  {note}")

    clean = [r['path'] for r in rows if not r['missing']]
    print(f"\nAt parity or better ({len(clean)}): {', '.join(clean)}")

    with open('parity-gaps.json', 'w', encoding='utf-8') as f:
        json.dump(rows, f, indent=1)
    print(f"\nwrote parity-gaps.json ({len(rows)} screens)")


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
