CorePOS Bike-Tag Print Agent Bundle
===================================

This packaged folder is the standalone Windows-host helper for CorePOS direct bike-tag printing to an installed office printer such as the Xerox VersaLink C405.
It does not require the CorePOS repo checkout or npm on the printer host.

Files:
- corepos-bike-tag-agent.exe : packaged Windows helper for bike-tag print jobs
- corepos-bike-tag-agent.config.example.json : copy to corepos-bike-tag-agent.config.json and edit
- README.txt : deployment notes

Setup:
1. Copy this whole folder to the Windows office-printer host.
2. Copy corepos-bike-tag-agent.config.example.json to corepos-bike-tag-agent.config.json.
3. Edit the config values. Leave bindHost as 127.0.0.1 unless you intentionally need LAN access.
4. Start the helper by double-clicking corepos-bike-tag-agent.exe.
5. Point the CorePOS backend at the helper URL with CorePOS Settings or COREPOS_BIKE_TAG_PRINT_AGENT_URL.
6. In CorePOS Settings, register the office document printer with transport mode WINDOWS_PRINTER and enter the installed Windows printer name.
7. Set that printer as the default bike-tag printer or choose it explicitly when printing.

Notes:
- Default port is 3213 so it can live beside the Zebra shipment helper on 3211 and the Dymo helper on 3212.
- WINDOWS_PRINTER jobs require the installed Windows printer name in CorePOS printer settings.
- DRY_RUN writes rendered bike-tag sheet PNGs to the configured dryRunOutputDir for safe testing.
- The packaged EXE embeds the bike-tag helper scripts internally, so the host does not need loose `.ps1` files.
