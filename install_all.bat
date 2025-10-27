@echo off

echo Updating winget source...
winget source update

:: --- Python Installation Fix ---
echo Installing Python 3 (Latest Stable)...
:: Using Python.Python.3.11 is often more reliable than the generic Python.Python.3.
:: We will try the generic ID first, and if that fails, the user may need to find a specific version ID.
set "PYTHON_ID=Python.Python.3.11"
winget install -e --id "%PYTHON_ID%" --accept-package-agreements --silent --disable-interactivity || (
echo.
echo WARNING: Failed to install %PYTHON_ID%. Trying generic Python.Python.3...
set "PYTHON_ID=Python.Python.3"
winget install -e --id "%PYTHON_ID%" --accept-package-agreements --silent --disable-interactivity
echo.
)

echo Checking if Python is now available...
where python >nul 2>nul
if %errorlevel% neq 0 (
echo.
echo WARNING: Python may not be immediately available in the PATH.
echo Please ensure the Python installer added it to the system PATH.
echo.
)

echo Installing required Python libraries from requirements.txt...
:: This step assumes the Python installer successfully added 'python' to the system's PATH.
python -m pip install -r requirements.txt

:: --- Apple App Installation Fix (Forcing MS Store Source) ---
echo Installing Apple Music...
:: REVERTED: Using the specific Microsoft Store App ID (9PFHDD62MXS1) for maximum reliability, as the friendly name failed to resolve.
winget install -e --id 9PFHDD62MXS1 --source msstore --accept-package-agreements --silent --disable-interactivity

echo Installing Apple Devices app...
:: REVERTED: Using the specific Microsoft Store App ID (9NM4T8B9JQZ1) for maximum reliability, as the friendly name failed to resolve.
winget install -e --id 9NM4T8B9JQZ1 --source msstore --accept-package-agreements --silent --disable-interactivity

echo.
echo All installations complete.

