@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-CorePOSDymoProductLabelAgent.ps1" -ConfigPath "%SCRIPT_DIR%corepos-dymo-product-label-agent.config.json"
endlocal
