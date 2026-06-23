@echo off
:: Registers a Windows Task Scheduler task to run j-Lite on login

set TASK_NAME=jLite
set APP_DIR=%~dp0
set NODE_PATH=node

:: Remove existing task if present
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

:: Create the task: runs on logon, starts hidden, restarts on failure
schtasks /Create ^
  /TN "%TASK_NAME%" ^
  /TR "\"%NODE_PATH%\" \"%APP_DIR%server.js\"" ^
  /SC ONLOGON ^
  /RL HIGHEST ^
  /F

if %ERRORLEVEL% EQU 0 (
  echo Task "%TASK_NAME%" created successfully.
  echo The server will start automatically on next login.
  echo To start it now, run: schtasks /Run /TN "%TASK_NAME%"
  echo To remove it later, run: schtasks /Delete /TN "%TASK_NAME%" /F
) else (
  echo Failed to create task. Try running this script as Administrator.
)

pause
