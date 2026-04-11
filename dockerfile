# 1. Use the .NET Runtime as the base
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app

# 2. Install Python, FFmpeg, and Pip
# We use 'apt-get' because the official .NET images are Debian-based
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 3. Install the Spotipy library for Python
RUN pip3 install spotipy --break-system-packages

# 4. Build stage (standard .NET build)
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["psyzx.csproj", "."]
RUN dotnet restore "psyzx.csproj"
COPY . .
RUN dotnet build "psyzx.csproj" -c Release -o /app/build

# 5. Publish stage
FROM build AS publish
RUN dotnet publish "psyzx.csproj" -c Release -o /app/publish

# 6. Final Stage
FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

# Ensure your local binaries (yt-dlp_linux) are copied and executable
# If you keep them in a folder called 'binaries' in your project root:
COPY ./binaries/* /app/Music/
RUN chmod +x /app/Music/yt-dlp_linux

ENTRYPOINT ["dotnet", "psyzx.dll"]