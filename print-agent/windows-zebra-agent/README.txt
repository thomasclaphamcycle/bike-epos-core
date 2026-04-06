CorePOS Zebra Shipment Agent Bundle
===================================

This packaged folder is the standalone Windows-host helper for CorePOS shipment-label printing to a USB-connected Zebra printer.
It does not require the CorePOS repo checkout or npm on the printer host.

Files:
- corepos-zebra-shipment-agent.exe : packaged Windows helper for shipment-label print jobs
- corepos-zebra-shipment-agent.config.example.json : copy to corepos-zebra-shipment-agent.config.json and edit
- README.txt : deployment notes

Setup:
1. Copy this whole folder to the Windows Zebra host.
2. Copy corepos-zebra-shipment-agent.config.example.json to corepos-zebra-shipment-agent.config.json.
3. Edit the config values. Leave bindHost as 127.0.0.1 unless you intentionally need LAN access.
4. Start the helper by double-clicking corepos-zebra-shipment-agent.exe.
5. Point the CorePOS backend at the helper URL with COREPOS_SHIPPING_PRINT_AGENT_URL.
6. In CorePOS Settings, register the Zebra printer with transport mode WINDOWS_PRINTER and enter the installed Windows printer name.
7. Set that printer as the default shipping-label printer or choose it explicitly when printing.

Notes:
- Default port is 3211 so it can replace the repo-local Zebra shipment print agent on the Windows host.
- WINDOWS_PRINTER jobs require the installed Windows printer name in CorePOS printer settings.
- DRY_RUN writes shipment ZPL to the configured dryRunOutputDir for safe testing.
- The packaged EXE embeds the Zebra helper scripts internally, so the host does not need loose `.ps1` files.
