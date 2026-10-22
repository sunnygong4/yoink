"""python -m songstore [root] — adopt karaoke-era meta.json folders and print what the store holds."""
import sys

from . import open_store, work_key

store = open_store(sys.argv[1] if len(sys.argv) > 1 else None)
print(f"store: {store.root}  imported: {store.import_meta_json()}  rekeyed: {store.rekey()}")
for d in store.all():
    print(f"  {d['id']:<22} {work_key(d) or '-':<40} {sorted(store.holders(d['id'])) or ''}")
