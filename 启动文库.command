#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  print '请先安装 Node.js 22.13 或更高版本：https://nodejs.org'
  read '?按回车关闭…'
  exit 1
fi
node scripts/service.mjs start --open
result=$?
if (( result != 0 )); then read '?按回车关闭…'; fi
exit $result
