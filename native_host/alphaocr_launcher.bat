@echo off
rem Chrome native-messaging host entry point. Uses the project venv's Python if
rem present, otherwise falls back to whatever `python` is on PATH.
set "VENV_PY=%~dp0..\venv\Scripts\python.exe"
if exist "%VENV_PY%" (
  "%VENV_PY%" "%~dp0launch_host.py"
) else (
  python "%~dp0launch_host.py"
)
