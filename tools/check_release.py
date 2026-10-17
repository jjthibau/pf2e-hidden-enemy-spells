"""Validate the release contents, metadata, runtime parity and checksums."""
import hashlib
import json
import re
import zipfile
from pathlib import Path
from build_release import FILES, ROOT

out = ROOT / 'dist'
source = json.loads((ROOT / 'module.json').read_text(encoding='utf-8'))
package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
assert source['id'] == 'pf2e-hidden-enemy-spells'
assert source['version'] == package['version']
assert source['license'] == 'LICENSE'
assert source['relationships']['systems'][0]['id'] == 'pf2e'
assert source['relationships']['systems'][0]['compatibility']['minimum'] == '8.6.0'
assert source['compatibility']['verified'] == '14.369'
assert source['esmodules'] == ['scripts/main.js']
assert source['styles'] == ['styles/cards.css']
assert 'packs' not in source
assert (out / 'module.json').read_bytes() == (ROOT / 'module.json').read_bytes()
with zipfile.ZipFile(out / 'module.zip') as archive:
    assert sorted(archive.namelist()) == sorted(FILES)
    assert archive.testzip() is None
    for name in FILES:
        assert archive.read(name) == (ROOT / name).read_bytes(), name
        text = archive.read(name).decode('utf-8')
        assert not re.search(r'C:[/\\]codex|\.cloudapp\.azure\.com|/data/maintenance|FOUNDRY_ADMIN_KEY|session=', text), name
    assert json.loads(archive.read('module.json')) == source
for line in (out / 'SHA256SUMS').read_text(encoding='utf-8').splitlines():
    digest, name = line.split('  ', 1)
    assert digest == hashlib.sha256((out / name).read_bytes()).hexdigest()
assert (out / 'RELEASE_NOTES.md').read_text(encoding='utf-8').strip()
print('Release metadata, exact allowlist, runtime files, privacy boundaries and checksums verified.')
