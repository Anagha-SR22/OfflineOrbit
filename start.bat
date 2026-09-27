@echo off
cd /d "%~dp0"
echo.
echo ========================================
echo        OfflineOrbit - Class 4 Learning
echo ========================================
echo.
if not exist package.json (
  echo ERROR: package.json was not found.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check the error above.
    pause
    exit /b 1
  )
)
echo.
echo Starting OfflineOrbit...
echo Keep this window open while using the website.
echo Open the local address shown by Vite in your browser.
echo.
call npm run dev
pause
