#!/bin/bash

# 1. Ensure Tailscale is running
systemctl is-active --quiet tailscaled || sudo systemctl start tailscaled

# 2. Kill existing dotnet processes (using -9 is aggressive, but effective for dev)
pkill -9 -f dotnet
dotnet clean

# 3. Database Reset Logic
read -p "⚠️  Delete database and reset migrations? (y/n): " confirm

if [[ "$confirm" =~ ^[yY]$ ]]; then
    read -p "⚠️  [FINAL WARNING] Are you absolutely sure? (y/n): " final_confirm
    if [[ "$final_confirm" =~ ^[yY]$ ]]; then
        echo "🔥 Dropping database and clearing migrations..."
        dotnet ef database drop --force
        rm -rf Migrations
        dotnet ef migrations add Fresh
        dotnet ef database update
    else
        echo "Skipping reset."
    fi
else
    echo "Skipping reset. Using existing data."
fi

# 4. Launch
dotnet run --urls "http://0.0.0.0:5149"