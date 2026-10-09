@echo off
setlocal
cd /d "%~dp0"

if exist "web\package.json" (
    cd /d "%~dp0web"
) else (
    echo Project folder not found.
    exit /b 1
)

echo Starting Smart Fraud Detection app...

if not exist "node_modules" (
    echo Installing dependencies first...
    npm install
    if errorlevel 1 (
        echo Dependency installation failed.
        exit /b 1
    )
)

npm run dev -- --host 0.0.0.0

endlocal
