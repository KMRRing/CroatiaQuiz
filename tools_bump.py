# Deterministic build bump: sets ALL build markers by regex and asserts the result.
import re, sys
new = sys.argv[1]
c = open('js/config.js').read()
c2, n1 = re.subn(r'export const BUILD = "[^"]+";', f'export const BUILD = "{new}";', c)
open('js/config.js','w').write(c2)
open('version.json','w').write('{ "build": "%s" }\n' % new)
x = open('index.html').read()
x2, n2 = re.subn(r'\?v=[a-z0-9-]+', f'?v={new}', x)
open('index.html','w').write(x2)
assert n1 == 1, "config BUILD line not found"
assert n2 >= 11, f"import map entries: {n2}"
for f, want in (('js/config.js', 1), ('version.json', 1)):
    assert open(f).read().count(new) == want, f
print(f"bumped to {new}: config 1, version 1, map {n2}")
