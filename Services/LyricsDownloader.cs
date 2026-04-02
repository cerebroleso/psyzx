namespace psyzx.Services;

using System;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using psyzx.Models;

public class LyricsDownloader
{
    private readonly HttpClient _httpClient;
    private readonly string _basePath;

    public LyricsDownloader(IConfiguration config)
    {
        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "psyzx-server/3.0");
        _basePath = config["MusicSettings:BasePath"] ?? "";
    }

    public async Task DownloadLyricsForTrackAsync(Track track)
    {
        if (string.IsNullOrWhiteSpace(_basePath) || string.IsNullOrWhiteSpace(track.FilePath)) return;

        var relativeAudioDir = Path.GetDirectoryName(track.FilePath) ?? "";
        var fileNameWithoutExt = Path.GetFileNameWithoutExtension(track.FilePath);
        
        var lrcDir = Path.Combine(_basePath, "lrc", relativeAudioDir);
        var lrcPath = Path.Combine(lrcDir, $"{fileNameWithoutExt}.lrc");

        if (File.Exists(lrcPath))
        {
            Console.WriteLine($"[Lyrics] SKIPPED (Already exists) -> {fileNameWithoutExt}");
            return;
        }

        var cleanTrackName = CleanTitle(track.Title ?? "");
        var artistName = track.Album?.Artist?.Name ?? "";

        Console.WriteLine($"[Lyrics] SEARCHING -> {artistName} - {cleanTrackName}");

        string? fetchedLyrics = null;

        fetchedLyrics = await FetchFromLrcLibSearch(artistName, cleanTrackName);

        if (string.IsNullOrEmpty(fetchedLyrics))
        {
            fetchedLyrics = await FetchFromLyricsOvh(artistName, cleanTrackName);
        }

        if (!string.IsNullOrEmpty(fetchedLyrics))
        {
            if (!Directory.Exists(lrcDir))
            {
                Directory.CreateDirectory(lrcDir);
            }
            await File.WriteAllTextAsync(lrcPath, fetchedLyrics);
            Console.WriteLine($"[Lyrics] SUCCESS! Saved -> {lrcPath}");
        }
        else
        {
            Console.WriteLine($"[Lyrics] FAILED (Not found anywhere) -> {fileNameWithoutExt}");
        }
    }

    private string CleanTitle(string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return "";
        string clean = Regex.Replace(title, @"^\d+[\.\-\s]+", "");
        clean = Regex.Replace(clean, @"\s*[\(\[].*?(feat|ft\.|remaster|mix|edit).*?[\)\]]", "", RegexOptions.IgnoreCase);
        return clean.Trim();
    }

    private async Task<string?> FetchFromLrcLibSearch(string artistName, string trackName)
    {
        try
        {
            Console.WriteLine("  -> Querying LRCLIB Search API...");
            var query = Uri.EscapeDataString($"{artistName} {trackName}");
            var url = $"https://lrclib.net/api/search?q={query}";
            
            var response = await _httpClient.GetAsync(url);
            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                
                if (doc.RootElement.ValueKind == JsonValueKind.Array && doc.RootElement.GetArrayLength() > 0)
                {
                    foreach (var item in doc.RootElement.EnumerateArray())
                    {
                        if (item.TryGetProperty("syncedLyrics", out var synced) && 
                            synced.ValueKind == JsonValueKind.String && 
                            !string.IsNullOrWhiteSpace(synced.GetString()))
                        {
                            return synced.GetString();
                        }
                    }

                    foreach (var item in doc.RootElement.EnumerateArray())
                    {
                        if (item.TryGetProperty("plainLyrics", out var plain) && 
                            plain.ValueKind == JsonValueKind.String && 
                            !string.IsNullOrWhiteSpace(plain.GetString()))
                        {
                            return plain.GetString();
                        }
                    }
                }
            }
        }
        catch { }
        return null;
    }

    private async Task<string?> FetchFromLyricsOvh(string artistName, string trackName)
    {
        try
        {
            Console.WriteLine("  -> Querying Lyrics.ovh API...");
            var artist = Uri.EscapeDataString(artistName);
            var title = Uri.EscapeDataString(trackName);

            var url = $"https://api.lyrics.ovh/v1/{artist}/{title}";
            
            var response = await _httpClient.GetAsync(url);
            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                
                if (doc.RootElement.TryGetProperty("lyrics", out var lyricsEl) && lyricsEl.ValueKind == JsonValueKind.String)
                {
                    var text = lyricsEl.GetString();
                    if (!string.IsNullOrWhiteSpace(text)) return text; 
                }
            }
        }
        catch { }
        return null;
    }
}