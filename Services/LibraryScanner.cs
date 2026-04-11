namespace psyzx.Services;

using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Playwright;
using psyzx.Data;
using psyzx.Models;

public class LibraryScanner
{
    private readonly AppDbContext _context;
    private readonly string _basePath;
    private readonly HttpClient _httpClient;
    private readonly string _browserExecutablePath;

    public LibraryScanner(AppDbContext context, IConfiguration config, HttpClient httpClient)
    {
        _context = context;
        _basePath = config["MusicSettings:BasePath"] ?? "";
        _browserExecutablePath = config["PlaywrightSettings:ExecutablePath"] ?? "";
        _httpClient = httpClient;
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "psyzx/1.0");
    }

    public async Task ScanAsync(bool hardScan = false)
    {
        Console.WriteLine($"DEBUG: Scanner started (HardScan: {hardScan})...");
        if (string.IsNullOrWhiteSpace(_basePath) || !Directory.Exists(_basePath))
        {
            Console.WriteLine("DEBUG: BasePath invalid or missing.");
            return;
        }

        // 1. Cleanup: Remove DB entries where physical files/folders are missing
        var dbArtists = await _context.Artists
            .Include(a => a.Albums)
            .ThenInclude(a => a.Tracks)
            .ToListAsync();

        foreach (var dbArtist in dbArtists)
        {
            var artistPath = Path.Combine(_basePath, dbArtist.Name.Trim());

            if (!Directory.Exists(artistPath))
            {
                foreach (var album in dbArtist.Albums.ToList())
                {
                    _context.Tracks.RemoveRange(album.Tracks);
                }
                _context.Albums.RemoveRange(dbArtist.Albums);
                _context.Artists.Remove(dbArtist);
                continue;
            }

            foreach (var album in dbArtist.Albums.ToList())
            {
                var albumPath = Path.Combine(artistPath, album.Title.Trim());
                if (!Directory.Exists(albumPath))
                {
                    _context.Tracks.RemoveRange(album.Tracks);
                    _context.Albums.Remove(album);
                }
                else
                {
                    foreach (var track in album.Tracks.ToList())
                    {
                        var trackPath = Path.Combine(_basePath, track.FilePath);
                        if (!File.Exists(trackPath))
                        {
                            _context.Tracks.Remove(track);
                        }
                    }
                }
            }
        }
        await _context.SaveChangesAsync();

        // 2. Discovery: Find new artists/albums and handle missing images
        var artistDirs = Directory.GetDirectories(_basePath);

        foreach (var artistDir in artistDirs)
        {
            var artistName = Path.GetFileName(artistDir).Trim();
            var artist = await _context.Artists.FirstOrDefaultAsync(a => a.Name == artistName);
            bool isNewArtist = false;

            if (artist == null)
            {
                artist = new Artist { Name = artistName };
                _context.Artists.Add(artist);
                await _context.SaveChangesAsync();
                isNewArtist = true;
            }

            // Logic for Artist Image
            var artistImagePath = Path.Combine(artistDir, "artist.jpg");
            if (!File.Exists(artistImagePath) && (isNewArtist || hardScan))
            {
                Console.WriteLine($"Artist image missing for: {artistName}. Attempting fetch...");
                string pictureUrl = await FetchArtistImageUrlAsync(artistName);

                if (!string.IsNullOrWhiteSpace(pictureUrl))
                {
                    await SaveImageAsync(pictureUrl, artistImagePath);
                    Console.WriteLine($"Artist image saved: {artistName}");
                }
            }

            if (File.Exists(artistImagePath))
            {
                artist.ImagePath = Path.GetRelativePath(_basePath, artistImagePath);
                await _context.SaveChangesAsync();
            }

            // --- Album Processing ---
            var albumDirs = Directory.GetDirectories(artistDir);
            foreach (var albumDir in albumDirs)
            {
                var albumName = Path.GetFileName(albumDir).Trim();
                var album = await _context.Albums.FirstOrDefaultAsync(a => a.Title == albumName && a.ArtistId == artist.Id);
                bool isNewAlbum = false;

                if (album == null)
                {
                    int releaseYear = await GetReleaseYearAsync(albumDir);
                    album = new Album { Title = albumName, ArtistId = artist.Id, ReleaseYear = releaseYear, PlayCount = 0 };
                    _context.Albums.Add(album);
                    await _context.SaveChangesAsync();
                    isNewAlbum = true;
                }

                var coverPath = Path.Combine(albumDir, "cover.jpg");
                if (!File.Exists(coverPath) && (isNewAlbum || hardScan))
                {
                    Console.WriteLine($"Album cover missing for: {artistName} - {albumName}. Attempting fetch...");
                    
                    // Try local extraction first
                    bool localSuccess = await TryExtractLocalCoverAsync(albumDir, coverPath);
                    
                    // Fallback to Google/Playwright
                    if (!localSuccess)
                    {
                        var albumImageUrl = await GetFirstGoogleImageAsync($"{artist.Name} {albumName} album cover");
                        if (!string.IsNullOrWhiteSpace(albumImageUrl))
                        {
                            await SaveImageAsync(albumImageUrl, coverPath);
                        }
                    }
                }

                if (File.Exists(coverPath))
                {
                    album.CoverPath = Path.GetRelativePath(_basePath, coverPath);
                    await _context.SaveChangesAsync();
                }

                // --- Track Processing ---
                var cdDirs = Directory.GetDirectories(albumDir)
                    .Where(d => {
                        var name = Path.GetFileName(d).ToLower();
                        return name.StartsWith("cd") || name.StartsWith("disc");
                    }).ToList();

                if (cdDirs.Any())
                {
                    foreach (var cdDir in cdDirs)
                    {
                        int discNumber = 1;
                        var numStr = new string(Path.GetFileName(cdDir).Where(char.IsDigit).ToArray());
                        if (!string.IsNullOrEmpty(numStr)) int.TryParse(numStr, out discNumber);
                        await ProcessAudioFilesAsync(cdDir, album.Id, discNumber);
                    }
                }
                else
                {
                    await ProcessAudioFilesAsync(albumDir, album.Id, 1);
                }
                await _context.SaveChangesAsync();
            }
        }
        Console.WriteLine("DEBUG: Scan Complete.");
    }

    private async Task<string> FetchArtistImageUrlAsync(string artistName)
    {
        string pictureUrl = string.Empty;
        try
        {
            var response = await _httpClient.GetAsync($"https://api.deezer.com/search/artist?q={Uri.EscapeDataString(artistName)}");
            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("data", out var dataElement) && dataElement.GetArrayLength() > 0)
                {
                    foreach (var item in dataElement.EnumerateArray())
                    {
                        if (item.TryGetProperty("name", out var nameElement) && 
                            string.Equals(nameElement.GetString(), artistName, StringComparison.OrdinalIgnoreCase))
                        {
                            pictureUrl = item.GetProperty("picture_xl").GetString() ?? "";
                            break;
                        }
                    }
                    if (string.IsNullOrEmpty(pictureUrl))
                        pictureUrl = dataElement[0].GetProperty("picture_xl").GetString() ?? "";
                }
            }
        }
        catch { }

        if (string.IsNullOrWhiteSpace(pictureUrl))
        {
            Console.WriteLine($"Deezer failed for {artistName}, trying Google...");
            pictureUrl = await GetFirstGoogleImageAsync($"{artistName} music artist");
        }
        return pictureUrl;
    }

    private async Task<bool> TryExtractLocalCoverAsync(string albumDir, string coverPath)
    {
        try
        {
            var imageFiles = Directory.GetFiles(albumDir)
                .Where(f => f.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".png", StringComparison.OrdinalIgnoreCase)).ToArray();
            
            var folderImage = imageFiles.FirstOrDefault(f => f.Contains("cover", StringComparison.OrdinalIgnoreCase) || f.Contains("folder", StringComparison.OrdinalIgnoreCase)) ?? imageFiles.FirstOrDefault();

            if (folderImage != null)
            {
                File.Copy(folderImage, coverPath, true);
                return true;
            }

            var firstAudio = Directory.EnumerateFiles(albumDir, "*.*", SearchOption.AllDirectories)
                .FirstOrDefault(f => f.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".flac", StringComparison.OrdinalIgnoreCase));

            if (firstAudio != null)
            {
                var tfile = TagLib.File.Create(firstAudio);
                if (tfile.Tag.Pictures.Length > 0)
                {
                    var pic = tfile.Tag.Pictures[0];
                    await File.WriteAllBytesAsync(coverPath, pic.Data.Data);
                    return true;
                }
            }
        }
        catch { }
        return false;
    }

    private async Task<int> GetReleaseYearAsync(string albumDir)
    {
        var firstAudio = Directory.EnumerateFiles(albumDir, "*.*", SearchOption.AllDirectories)
            .FirstOrDefault(f => f.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".flac", StringComparison.OrdinalIgnoreCase));
        
        if (firstAudio != null)
        {
            try
            {
                var tfile = TagLib.File.Create(firstAudio);
                if (tfile.Tag.Year > 0) return (int)tfile.Tag.Year;
            }
            catch { }
        }
        return DateTime.Now.Year;
    }

    private async Task ProcessAudioFilesAsync(string directoryPath, int albumId, int discNumber)
    {
        var files = Directory.GetFiles(directoryPath)
            .Where(f => f.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".flac", StringComparison.OrdinalIgnoreCase));

        foreach (var file in files)
        {
            var relativePath = Path.GetRelativePath(_basePath, file);
            var trackExists = await _context.Tracks.AnyAsync(t => t.FilePath == relativePath);

            if (!trackExists)
            {
                int duration = 0, trackNum = 0, bitrate = 0;
                try
                {
                    var tfile = TagLib.File.Create(file);
                    duration = (int)tfile.Properties.Duration.TotalSeconds;
                    trackNum = (int)tfile.Tag.Track;
                    bitrate = tfile.Properties.AudioBitrate;
                    if (tfile.Tag.Disc > 0) discNumber = (int)tfile.Tag.Disc;
                }
                catch { }

                _context.Tracks.Add(new Track {
                    Title = Path.GetFileNameWithoutExtension(file),
                    FilePath = relativePath,
                    AlbumId = albumId,
                    DurationSeconds = duration,
                    TrackNumber = trackNum,
                    Bitrate = bitrate,
                    DiscNumber = discNumber
                });
            }
        }
    }

    private async Task<string> GetFirstGoogleImageAsync(string query)
    {
        try
        {
            var profileDir = Path.Combine(Path.GetTempPath(), "psyzx_playwright_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(profileDir);

            using var playwright = await Playwright.CreateAsync();
            var launchOptions = new BrowserTypeLaunchPersistentContextOptions
            {
                Headless = true,
                ExecutablePath = !string.IsNullOrWhiteSpace(_browserExecutablePath) ? _browserExecutablePath : null,
                Args = new[] { "--disable-blink-features=AutomationControlled", "--no-sandbox" }
            };

            await using var context = await playwright.Chromium.LaunchPersistentContextAsync(profileDir, launchOptions);
            var page = await context.NewPageAsync();
            await page.GotoAsync($"https://www.google.com/search?tbm=isch&q={Uri.EscapeDataString(query)}");

            var firstImage = page.Locator("img.rg_i").First;
            await firstImage.WaitForAsync(new LocatorWaitForOptions { Timeout = 5000 });

            var src = await firstImage.GetAttributeAsync("src");
            var dataSrc = await firstImage.GetAttributeAsync("data-src");
            
            // Cleanup profile dir
            try { Directory.Delete(profileDir, true); } catch { }

            return !string.IsNullOrWhiteSpace(src) && !src.StartsWith("data:") ? src : (dataSrc ?? src ?? string.Empty);
        }
        catch { return string.Empty; }
    }

    private async Task<bool> SaveImageAsync(string source, string destinationPath)
    {
        try
        {
            if (source.StartsWith("data:image", StringComparison.OrdinalIgnoreCase))
            {
                var base64Data = source.Substring(source.IndexOf(",") + 1);
                await File.WriteAllBytesAsync(destinationPath, Convert.FromBase64String(base64Data));
                return true;
            }
            var bytes = await _httpClient.GetByteArrayAsync(source);
            await File.WriteAllBytesAsync(destinationPath, bytes);
            return true;
        }
        catch { return false; }
    }
}