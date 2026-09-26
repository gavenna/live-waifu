#!/usr/bin/env python3
# verify_label.py -- static check that the viewer-label patch landed in the jar.
# Usage: python verify_label.py <patched.jar>
import sys, zipfile

if len(sys.argv) < 2:
    print("usage: python verify_label.py <patched.jar>"); sys.exit(2)
jar = sys.argv[1]
DBG = "com/corrodinggames/librocket/scripts/Debug.class"
G_CLS = "com/corrodinggames/rts/gameFramework/f/g.class"

z = zipfile.ZipFile(jar)
names = set(z.namelist())
ok = True
for n in (DBG, G_CLS):
    if n in names:
        print("OK  present: " + n)
    else:
        print("FAIL missing: " + n); ok = False

try:
    d = z.read(DBG)
    if b"label-V1" in d:
        print("OK  Debug.class has marker 'label-V1'")
    else:
        print("FAIL Debug.class missing marker 'label-V1'"); ok = False
    if b"LABELS" in d:
        print("OK  Debug.class has field 'LABELS'")
    else:
        print("FAIL Debug.class missing 'LABELS'"); ok = False
    if b"drawLabels" in d:
        print("OK  Debug.class has method 'drawLabels'")
    else:
        print("FAIL Debug.class missing 'drawLabels'"); ok = False
except KeyError:
    ok = False

try:
    g = z.read(G_CLS)
    if b"drawLabels" in g:
        print("OK  g.class references drawLabels (hook inserted)")
    else:
        print("FAIL g.class does NOT reference drawLabels (hook missing)"); ok = False
except KeyError:
    ok = False

print("RESULT: " + ("PASS" if ok else "FAIL"))
sys.exit(0 if ok else 1)
