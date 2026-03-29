#!/bin/bash

if command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm --needed dotnet-sdk ffmpeg yt-dlp git
elif command -v apt >/dev/null 2>&1; then
    sudo apt update
    sudo apt install -y dotnet-sdk-8.0 ffmpeg yt-dlp git
elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y dotnet-sdk-8.0 ffmpeg yt-dlp git
else
    echo "unsupported"
    exit 1
fi