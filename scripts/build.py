#!/usr/bin/env python3
"""Package the mod into dist/ as <zhName>-<enName>-v<version>.{rpenmod,zip}."""
import json
import os
import shutil
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'beat-grid-guide')
DIST = os.path.join(ROOT, 'dist')


def safe(text):
    return str(text).strip().replace(' ', '-')


def main():
    with open(os.path.join(SRC, 'mod.json'), 'r', encoding='utf-8') as handle:
        manifest = json.load(handle)
    name = manifest.get('name') or {}
    zh = name.get('zh-CN', 'mod') if isinstance(name, dict) else str(name)
    en = name.get('en-US', '') if isinstance(name, dict) else ''
    version = manifest.get('version', '0.0.0')
    stem = '-'.join(part for part in (safe(zh), safe(en), 'v' + str(version)) if part)
    os.makedirs(DIST, exist_ok=True)
    zip_path = os.path.join(DIST, stem + '.zip')
    mod_path = os.path.join(DIST, stem + '.rpenmod')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for base, _dirs, files in os.walk(SRC):
            for file_name in files:
                full = os.path.join(base, file_name)
                rel = os.path.relpath(full, SRC).replace(os.sep, '/')
                archive.write(full, rel)
    shutil.copyfile(zip_path, mod_path)
    print(zip_path)
    print(mod_path)
    print('entries=' + str(len(zipfile.ZipFile(zip_path).namelist())))


if __name__ == '__main__':
    main()
