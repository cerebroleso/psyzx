#!/bin/bash

systemctl is-active --quiet tailscaled || sudo systemctl start tailscaled
pkill -9 -f dotnet
dotnet clean
dotnet ef database drop --force
rm -rf Migrations
dotnet ef migrations add Fresh
dotnet ef database update
dotnet run --urls "http://0.0.0.0:5149"