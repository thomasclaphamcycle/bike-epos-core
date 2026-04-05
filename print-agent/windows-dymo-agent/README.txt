CorePOS Dymo Product Label Agent Bundle
=======================================

This packaged folder is the standalone Windows-host helper for CorePOS direct Dymo product-label printing.
It does not require the CorePOS repo checkout or npm on the printer host.

Files:
- corepos-dymo-product-label-agent.exe : packaged Windows helper for product-label print jobs
- corepos-dymo-product-label-agent.config.example.json : copy to corepos-dymo-product-label-agent.config.json and edit
- README.txt : deployment notes

Setup:
1. Copy this whole folder to the Windows Dymo host.
2. Copy corepos-dymo-product-label-agent.config.example.json to corepos-dymo-product-label-agent.config.json.
3. Edit the config values. Leave bindHost as 127.0.0.1 unless you intentionally need LAN access.
4. Start the helper by double-clicking corepos-dymo-product-label-agent.exe.
5. Point the CorePOS backend at the helper URL with COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL.
6. In CorePOS Settings, register the Dymo printer and set it as the default product-label printer.

Notes:
- Default port is 3212 so it can live beside the Zebra shipment print agent on 3211.
- WINDOWS_PRINTER jobs require the installed Windows printer name in CorePOS printer settings.
- DRY_RUN writes rendered PNG labels to the configured dryRunOutputDir for safe testing.
- The packaged EXE embeds the Dymo helper scripts internally, so the host does not need loose `.ps1` files.
