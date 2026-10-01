"""Build and verify the Windows x64 portable release. Run on Windows."""
import hashlib
import json
from pathlib import Path
import platform
import struct
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent


def main():
    if sys.platform != 'win32' or struct.calcsize('P') != 8 or platform.machine().upper() not in ('AMD64', 'X86_64'):
        raise SystemExit('Build with 64-bit x64 Python on Windows.')
    version = json.loads((ROOT / 'plugin.json').read_text(encoding='utf-8'))['version']
    numeric = tuple(int(n) for n in version.split('.')) + (0,)
    work = ROOT / 'build' / 'windows'
    work.mkdir(parents=True, exist_ok=True)
    version_file = work / 'version.txt'
    version_file.write_text("VSVersionInfo(ffi=FixedFileInfo(filevers=" + repr(numeric) + ", prodvers=" + repr(numeric) +
                           ", mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)), kids=["
                           "StringFileInfo([StringTable('080404B0', [StringStruct('FileDescription', 'ai文字 文学写作台'),"
                           "StringStruct('ProductName', 'ai文字'), StringStruct('FileVersion', '" + version + "'),"
                           "StringStruct('ProductVersion', '" + version + "'), StringStruct('OriginalFilename', 'ai文字.exe')])]),"
                           "VarFileInfo([VarStruct('Translation', [2052, 1200])])])", encoding='utf-8')
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--windowed', '--noupx',
               '--name', 'ai文字', '--distpath', str(ROOT / 'dist'), '--workpath', str(work / 'pyinstaller'),
               '--specpath', str(work), '--version-file', str(version_file)]
    for source, dest in [('web', 'web'), ('prompts', 'prompts'), ('profiles.json', '.'), ('providers.json', '.')]:
        command.extend(['--add-data', f'{ROOT / source}:{dest}'])
    command.append(str(ROOT / 'launcher.py'))
    subprocess.run(command, cwd=ROOT, check=True)
    exe = ROOT / 'dist' / 'ai文字.exe'
    # Launch the actual frozen executable from a directory without app sources.
    smoke_dir = work / 'isolated-smoke'
    smoke_dir.mkdir(exist_ok=True)
    report = smoke_dir / 'report.json'
    if report.exists():
        report.unlink()
    subprocess.run([str(exe), '--self-test', str(report)], cwd=smoke_dir, check=True, timeout=90)
    result = json.loads(report.read_text(encoding='utf-8'))
    if not result.get('ok') or result.get('version') != version:
        raise RuntimeError('Frozen executable verification failed: ' + repr(result))
    archive = ROOT / 'dist' / f'ai文字-v{version}-Windows-x64.zip'
    with ZipFile(archive, 'w', compression=ZIP_DEFLATED) as release:
        release.write(exe, 'ai文字.exe')
        release.write(ROOT / 'Windows使用说明.txt', '先读我.txt')
        release.write(ROOT / 'README.md', 'README.md')
    with ZipFile(archive) as release:
        if release.testzip() is not None:
            raise RuntimeError('Archive verification failed.')
    checksums = ROOT / 'dist' / 'SHA256SUMS.txt'
    checksums.write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n'
                                for file in (exe, archive)), encoding='utf-8')
    print(f'Verified: {archive.name} ({archive.stat().st_size:,} bytes)')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
