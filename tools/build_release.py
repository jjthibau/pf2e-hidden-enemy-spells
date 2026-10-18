"""Build a reproducible, allowlisted Foundry module release using Python stdlib."""
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ('module.json', 'scripts/main.js', 'scripts/plans.js', 'scripts/recognition.js', 'scripts/recognition-foundry.js', 'styles/cards.css', 'README.md', 'LICENSE', 'CHANGELOG.md')


def build(tag=None):
    manifest = json.loads((ROOT / 'module.json').read_text(encoding='utf-8'))
    version = manifest['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version):
        raise ValueError('Manifest version must be semantic.')
    if tag is not None and tag != f'v{version}':
        raise ValueError('Release tag must match the manifest version.')
    repository = manifest['url'].rstrip('/')
    expected_download = f'{repository}/releases/download/v{version}/module.zip'
    if manifest['download'] != expected_download:
        raise ValueError('Manifest download URL does not match the release version.')
    if manifest['manifest'] != f'{repository}/releases/latest/download/module.json':
        raise ValueError('Manifest update URL must point to the latest release asset.')
    out = ROOT / 'dist'
    out.mkdir(exist_ok=True)
    with zipfile.ZipFile(out / 'module.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (ROOT / name).read_bytes())
    (out / 'module.json').write_bytes((ROOT / 'module.json').read_bytes())
    sums = ''.join(f'{hashlib.sha256((out / name).read_bytes()).hexdigest()}  {name}\n' for name in ('module.json', 'module.zip'))
    (out / 'SHA256SUMS').write_text(sums, encoding='utf-8', newline='\n')
    changelog = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    marker = f'## {version}\n'
    if marker not in changelog:
        raise ValueError('Changelog is missing this release version.')
    notes = changelog.split(marker, 1)[1].split('\n## ', 1)[0].strip() + '\n'
    (out / 'RELEASE_NOTES.md').write_text(notes, encoding='utf-8', newline='\n')
    print(f'Built {manifest["id"]} {version}: {len(FILES)} allowlisted files.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', help='Optional exact Git tag, e.g. v0.1.0.')
    build(parser.parse_args().tag)
