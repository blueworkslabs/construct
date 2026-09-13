"""Bounded, idempotent accessibility replacement; no focus tap or blind key injection."""
import time

def replace_text(read_nodes, set_text, value, timeout=5, clock=time.monotonic, sleep=time.sleep):
    def field():
        fields=[n for n in read_nodes() if n.get('class')=='android.widget.EditText' and n.get('package')=='dev.construct.runtime']
        if len(fields)>1:raise RuntimeError('Ambiguous app text field; refusing text replacement')
        return fields[0] if fields else None
    deadline=clock()+timeout
    while field() is None:
        if clock()>=deadline:raise RuntimeError('Unique app text field did not become available')
        sleep(.25)
    for attempt in range(2):
        set_text(value)
        deadline=clock()+timeout
        while clock()<deadline:
            current=field()
            if current is not None and current.get('text')==value:return
            sleep(.25)
    raise RuntimeError('Input text did not exactly match after bounded replacement')

# Compatibility name for the original catalog-only callers. Both paths require
# one app-owned field and verify its actual text before the caller can submit it.
replace_catalog = replace_text
