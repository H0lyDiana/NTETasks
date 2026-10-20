@echo off
rem Launch the data.js editor with a Python build that includes tkinter.
setlocal
set "APP=%~dp0data_editor.py"
set "PYW="

for %%D in ("D:\Python 3.13" "D:\Python 3.10.11" "D:\Python 3.12" "D:\Python 3.11" "%LocalAppData%\Programs\Python\Python313" "%LocalAppData%\Programs\Python\Python312" "%LocalAppData%\Programs\Python\Python311") do (
  if not defined PYW if exist "%%~D\pythonw.exe" (
    "%%~D\pythonw.exe" -c "import tkinter" >nul 2>nul
    if not errorlevel 1 set "PYW=%%~D\pythonw.exe"
  )
)

if defined PYW (
  start "" "%PYW%" "%APP%"
  exit /b 0
)

where pythonw >nul 2>nul
if not errorlevel 1 (
  start "" pythonw "%APP%"
  exit /b 0
)

echo No Python with tkinter found.
echo Try:  python data_editor.py --help
pause
