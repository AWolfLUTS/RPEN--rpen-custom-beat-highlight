#!/usr/bin/env python3
"""Package the mod into dist/ as <zhName>-<enName>-v<version>.{rpenmod,zip}.

版本号唯一来源：项目根目录的 VERSION 文件。
构建时会自动同步到 mod.json 与两份 README 的版本引用。
"""
import json
import os
import re
import shutil
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'beat-grid-guide')
DIST = os.path.join(ROOT, 'dist')
VERSION_FILE = os.path.join(ROOT, 'VERSION')
MANIFEST = os.path.join(SRC, 'mod.json')
TOP_README = os.path.join(ROOT, 'README.md')
MOD_README = os.path.join(SRC, 'README.zh-CN.md')


def safe(text):
    return str(text).strip().replace(' ', '-')


def read_version():
    try:
        with open(VERSION_FILE, 'r', encoding='utf-8') as handle:
            return handle.read().strip() or None
    except FileNotFoundError:
        return None


def sync_manifest(version):
    with open(MANIFEST, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    if data.get('version') == version:
        return False
    data['version'] = version
    with open(MANIFEST, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    return True


def sync_readme(path, version, top):
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            text = handle.read()
    except FileNotFoundError:
        return False
    before = text
    if top:
        text = re.sub(r'版本 \*\*[^*]+\*\*', '版本 **' + version + '**', text)
        text = re.sub(r'v\d+\.\d+\.\d+', 'v' + version, text)
    else:
        text = re.sub(r'版本 `[^`]+`', '版本 `' + version + '`', text)
    if text == before:
        return False
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text)
    return True


def main():
    version = read_version()
    if version:
        changed = []
        if sync_manifest(version):
            changed.append('beat-grid-guide/mod.json')
        if sync_readme(TOP_README, version, True):
            changed.append('README.md')
        if sync_readme(MOD_README, version, False):
            changed.append('beat-grid-guide/README.zh-CN.md')
        print('version=' + version)
        if changed:
            print('synced: ' + ', '.join(changed))

    with open(MANIFEST, 'r', encoding='utf-8') as handle:
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
