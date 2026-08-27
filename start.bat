@echo off
setlocal

REM ============================================================
REM  CHUNKYR // Video Infiltration Protocol
REM  Desktop launcher (Electron + Flask backend)
REM ============================================================

cd /d "%~dp0"

echo ========================================
echo   CHUNKYR // Video Infiltration
echo   Desktop Edition
echo ========================================
echo.

REM Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [!] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if node_modules exist
if not exist "node_modules\" (
    echo [1/3] Installing Electron and dependencies...
    call npm install
    if errorlevel 1 goto :error
)

echo [2/3] Checking Python backend...
where python >nul 2>&1
if errorlevel 1 where py >nul 2>&1
if errorlevel 1 (
    echo [!] Python not found. Install Python 3.10+ from https://python.org/
    pause
    exit /b 1
)

echo [3/3] Launching CHUNKYR...
echo.
call npm start
goto :eof

:error
echo.
echo [!] Launch failed. See error messages above.
pause
