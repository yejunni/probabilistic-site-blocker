# tools/make_release.py
# 다른 사람에게 나눠줄 확장 프로그램 zip을 만든다.
#
# 실행: 저장소 맨 위 폴더에서  python tools/make_release.py
# 결과: release/probabilistic-site-blocker.zip
#
# 하는 일
#   1. secrets.js의 키가 anon 키인지 확인한다 (service_role이면 멈춘다)
#   2. 확장에 필요한 파일만 골라 담는다 (dashboard, supabase, 메모 파일은 뺀다)
#   3. 담을 때 config.js의 devMode를 false로 바꾼다 (테스트 칸이 안 보이게)
#      내 컴퓨터의 config.js는 그대로 둔다. 나는 계속 테스트해야 하므로.
#
# 주의: 만들어진 zip에는 Supabase anon 키가 들어 있다.
#       release/ 폴더는 .gitignore에 있어 저장소에 올라가지 않는다.
#       zip은 GitHub Releases에 따로 올린다.

import base64
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / 'release'
ZIP_NAME = 'probabilistic-site-blocker.zip'

# zip을 풀면 이 이름의 폴더가 하나 나오게 한다.
# (파일이 바탕화면에 흩어지지 않게, 그리고 '폴더 선택'이 쉽게)
FOLDER_IN_ZIP = 'probabilistic-site-blocker'

# 확장이 실제로 쓰는 파일만. 새 파일을 만들면 여기에도 추가해야 한다.
EXTENSION_FILES = [
    'manifest.json',
    'rules.json',
    'config.js',
    'probability.js',
    'background.js',
    'supabase.js',
    'secrets.js',
    'blocked.html',
    'blocked.js',
    'options.html',
    'options.js',
    'timer.js',
    'extension.css',
]


def stop(message):
    print('멈춤:', message)
    sys.exit(1)


# secrets.js 안의 키가 anon 키인지 확인한다. 키 값 자체는 화면에 찍지 않는다.
#
# 왜 확인하나: service_role 키는 RLS를 통째로 무시한다.
# 그 키가 zip에 들어가면 받은 사람 누구나 기록을 읽고 지울 수 있게 된다.
def check_key():
    path = ROOT / 'secrets.js'
    if not path.exists():
        stop('secrets.js가 없습니다. 키 없이 만들면 기록 기능이 꺼진 zip이 됩니다.')

    text = path.read_text(encoding='utf-8')
    found = re.search(r"anonKey\s*:\s*['\"]([^'\"]+)['\"]", text)
    if not found:
        stop('secrets.js에서 anonKey를 찾지 못했습니다.')

    key = found.group(1)

    # 새 방식 키: 이름 앞부분으로 구분한다
    if key.startswith('sb_secret_'):
        stop('secret 키가 들어 있습니다. publishable(공개) 키로 바꾸세요.')
    if key.startswith('sb_publishable_'):
        return

    # 옛 방식 키(JWT): 가운데 부분에 role이 적혀 있다
    try:
        middle = key.split('.')[1]
        middle += '=' * (-len(middle) % 4)
        role = json.loads(base64.urlsafe_b64decode(middle)).get('role')
    except Exception:
        stop('키 모양을 알아볼 수 없습니다.')

    if role != 'anon':
        stop(f'anon 키가 아닙니다 (role={role}). 절대 배포하면 안 됩니다.')


# devMode: true 를 false로 바꾼 config.js 내용을 돌려준다.
def config_for_release():
    text = (ROOT / 'config.js').read_text(encoding='utf-8')
    changed, count = re.subn(r'devMode:\s*true', 'devMode: false', text)
    if count == 0 and 'devMode: false' not in text:
        stop('config.js에서 devMode를 찾지 못했습니다.')
    return changed


def main():
    check_key()

    for name in EXTENSION_FILES:
        if not (ROOT / name).exists():
            stop(f'{name} 파일이 없습니다.')

    OUT_DIR.mkdir(exist_ok=True)
    zip_path = OUT_DIR / ZIP_NAME

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name in EXTENSION_FILES:
            target = f'{FOLDER_IN_ZIP}/{name}'
            if name == 'config.js':
                zf.writestr(target, config_for_release())
            else:
                zf.write(ROOT / name, target)

    print('만들었습니다:', zip_path)
    print('파일', len(EXTENSION_FILES), '개, devMode=false, anon 키 확인됨')


main()
