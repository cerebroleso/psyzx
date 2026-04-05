#!/bin/bash

systemctl is-active --quiet tailscaled || sudo systemctl start tailscaled

pkill -9 -f dotnet
dotnet clean

read -p "⚠️  Are you sure you want to DELETE the database and reset migrations? (y/n): " confirm

if [[ $confirm == "y" || $confirm == "Y" ]]; then
    echo "Proceeding with database drop..."
    dotnet ef database drop --force
    rm -rf Migrations
    dotnet ef migrations add Fresh
    dotnet ef database update
else
    echo "Skipping database reset. Running app with existing data."
fi

dotnet run --urls "http://0.0.0.0:5149"