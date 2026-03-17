#!/bin/bash

# Config
DB_NAME="bike_epos"
BACKUP_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/CorePOS-Backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
FILENAME="$BACKUP_DIR/corepos_backup_$TIMESTAMP.sql"

# Ensure folder exists
mkdir -p "$BACKUP_DIR"

echo "Backing up database: $DB_NAME"

pg_dump "$DB_NAME" > "$FILENAME"

echo "Backup saved to:"
echo "$FILENAME"