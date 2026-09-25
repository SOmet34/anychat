@echo off
setlocal

cd /d "%~dp0"

echo ============================================
echo   AnyChat - starting proxy + app
echo ============================================
echo.

REM --- Start the proxy in a new window so it keeps running ---
start "AnyChat Proxy" cmd /c "node proxy.js"
timeout /t 1 /nobreak >nul

REM --- Serve the app locally (http://localhost:8000) ---
echo Opening app at http://localhost:8000
echo.
echo Settings to configure:
echo   - Base URL: http://127.0.0.1:31415
echo   - Proxy URL: http://localhost:3000
echo   - Provider: OpenAI-compatible
echo.
start "" "http://localhost:8000"

python -m http.server 8000