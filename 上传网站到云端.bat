@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

set "TCB=tcb"
set "ENV=<ENV_ID>"
set "SITE=https://<ENV_ID>-<APPID>.tcloudbaseapp.com/"

if not exist "%TCB%" (
  echo 找不到 CloudBase 命令行工具：%TCB%
  goto :end
)

echo 正在把 nte-companion 上传到静态托管（环境 %ENV%）……
echo.
call "%TCB%" hosting deploy "nte-companion" -e %ENV% --verify

if errorlevel 1 (
  echo.
  echo 上传失败。若提示未登录，先在这个窗口执行：tcb login
) else (
  echo.
  echo 已上线：%SITE%
  echo 页面没更新的话等一两分钟让 CDN 刷新，或用无痕窗口打开。
)

:end
echo.
pause
