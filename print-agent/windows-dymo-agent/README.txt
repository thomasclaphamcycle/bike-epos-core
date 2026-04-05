CorePOS Dymo Product Label Agent Bundle
=======================================

This bundle is the standalone Windows-host helper for CorePOS direct Dymo product-label printing.
It does not require the CorePOS repo checkout or npm on the printer host.

Files:
- Start-CorePOSDymoProductLabelAgent.ps1 : local HTTP helper for product-label print jobs
- corepos-dymo-product-label-agent.cmd : simple launcher for the helper
- corepos-dymo-product-label-agent.config.example.json : copy to corepos-dymo-product-label-agent.config.json and edit
- print_product_label_windows.ps1 : Windows printer helper used by the agent

Setup:
1. Copy this whole folder to the Windows Dymo host.
2. Copy corepos-dymo-product-label-agent.config.example.json to corepos-dymo-product-label-agent.config.json.
3. Edit the config values. Leave bindHost as 127.0.0.1 unless you intentionally need LAN access.
4. Start the helper by double-clicking corepos-dymo-product-label-agent.cmd or launching it from PowerShell.
5. Point the CorePOS backend at the helper URL with COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL.
6. In CorePOS Settings, register the Dymo printer and set it as the default product-label printer.

Notes:
- Default port is 3212 so it can live beside the Zebra shipment print agent on 3211.
- WINDOWS_PRINTER jobs require the installed Windows printer name in CorePOS printer settings.
- DRY_RUN writes rendered PNG labels to the configured dryRunOutputDir for safe testing.
