"""Package only the sources needed for Cloudflare; never ship local dependencies."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent


def main():
    archive = ROOT.parent / 'ai文字-Cloudflare网页版.zip'
    files = ['package.json', 'package-lock.json', 'wrangler.jsonc', '.gitignore',
             'providers.json', 'profiles.json', 'Cloudflare部署说明.md']
    for directory in ('cloudflare', 'web', 'prompts'):
        files.extend(str(path.relative_to(ROOT)) for path in (ROOT / directory).rglob('*') if path.is_file())
    files.extend(str(path.relative_to(ROOT)) for path in (ROOT / 'tests').glob('*.cjs'))
    with ZipFile(archive, 'w', compression=ZIP_DEFLATED) as release:
        for name in files:
            release.write(ROOT / name, Path(name).as_posix())
        release.write(ROOT / 'Cloudflare部署说明.md', 'README.md')
    with ZipFile(archive) as release:
        assert release.testzip() is None
        assert 'wrangler.jsonc' in release.namelist()
        assert not any('node_modules' in name or '.dev.vars' in name for name in release.namelist())
        print(f'Cloudflare archive verified: {len(release.namelist())} files, {archive.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
