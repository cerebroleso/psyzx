namespace psyzx.Controllers;

using psyzx.Data;
using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using System.IO;
using System.Text.RegularExpressions;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class SystemController : ControllerBase
{
    private readonly HttpClient _http;
    private readonly IServiceScopeFactory _scopeFactory;
    private static readonly ConcurrentQueue<string> _downloadQueue = new ConcurrentQueue<string>();
    private static int _isProcessing = 0;
    private static Process? _currentProcess;
    private static string _currentTrackInfo = "";

    public SystemController(IHttpClientFactory httpClientFactory, IServiceScopeFactory scopeFactory)
    {
        _http = httpClientFactory.CreateClient();
        _http.DefaultRequestHeaders.Add("User-Agent", "psyzx/1.0");
        _scopeFactory = scopeFactory;
    }

    [HttpGet("lyrics")]
    public async Task<IActionResult> GetLyrics([FromQuery] string artist, [FromQuery] string title)
    {
        // 1. Clean the input to avoid search mistakes
        var cleanArtist = CleanSongString(artist);
        var cleanTitle = CleanSongString(title);

        string? fetchedLyrics = null;

        // Mirror 1: LRCLIB (Best Quality & Synced)
        fetchedLyrics = await FetchFromLrcLib(cleanArtist, cleanTitle);

        // Mirror 2: Lyrics.ovh (Reliable plain-text fallback)
        if (string.IsNullOrEmpty(fetchedLyrics))
            fetchedLyrics = await FetchFromLyricsOvh(cleanArtist, cleanTitle);

        // Mirror 3: PopCat API (Good backup)
        if (string.IsNullOrEmpty(fetchedLyrics))
            fetchedLyrics = await FetchFromPopCat(cleanArtist, cleanTitle);

        // Mirror 4: Lyrist (Another solid text API)
        if (string.IsNullOrEmpty(fetchedLyrics))
            fetchedLyrics = await FetchFromLyrist(cleanArtist, cleanTitle);

        // Mirror 5: SomeRandomApi (Final safety net)
        if (string.IsNullOrEmpty(fetchedLyrics))
            fetchedLyrics = await FetchFromSomeRandomApi(cleanArtist, cleanTitle);

        // Return the result if any mirror succeeded
        if (!string.IsNullOrEmpty(fetchedLyrics))
        {
            return Ok(new { lrc = fetchedLyrics });
        }

        return NotFound(new { message = "Lyrics not found across all mirrors." });
    }

    // ==========================================
    // HELPER: Fix Search Mistakes (Sanitization)
    // ==========================================
    private string CleanSongString(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return input;
        
        // Removes things like: " - Remastered", " (feat. X)", " [Official Video]"
        var pattern = @"(?i)(\s-\sremastered.*|\s-\sradio edit|\s\(feat\..*|\s\[.*\]|\s\(.*version\))";
        return Regex.Replace(input, pattern, "").Trim();
    }

    // ==========================================
    // MIRROR 1: LRCLIB (Prioritizes Synced)
    // ==========================================
    private async Task<string?> FetchFromLrcLib(string artist, string title)
    {
        try
        {
            var url = $"https://lrclib.net/api/get?artist_name={Uri.EscapeDataString(artist)}&track_name={Uri.EscapeDataString(title)}";
            var res = await _http.GetAsync(url);
            
            if (res.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                
                // Try to get synced lyrics first
                if (doc.RootElement.TryGetProperty("syncedLyrics", out var syncLyrics) && !string.IsNullOrWhiteSpace(syncLyrics.GetString()))
                {
                    return syncLyrics.GetString();
                }
                // Fallback to plain text if synced isn't available on LRCLIB
                if (doc.RootElement.TryGetProperty("plainLyrics", out var plainLyrics))
                {
                    return plainLyrics.GetString();
                }
            }
        }
        catch { }
        return null;
    }

    // ==========================================
    // MIRROR 2: Lyrics.ovh
    // ==========================================
    private async Task<string?> FetchFromLyricsOvh(string artist, string title)
    {
        try
        {
            var url = $"https://api.lyrics.ovh/v1/{Uri.EscapeDataString(artist)}/{Uri.EscapeDataString(title)}";
            var res = await _http.GetAsync(url);
            if (res.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("lyrics", out var lrc)) return lrc.GetString();
            }
        }
        catch { }
        return null;
    }

    // ==========================================
    // MIRROR 3: PopCat API
    // ==========================================
    private async Task<string?> FetchFromPopCat(string artist, string title)
    {
        try 
        {
            var query = Uri.EscapeDataString($"{artist} {title}");
            var res = await _http.GetAsync($"https://api.popcat.xyz/lyrics?song={query}");
            if (res.IsSuccessStatusCode) 
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("lyrics", out var lrc)) return lrc.GetString();
            }
        } 
        catch { } 
        return null;
    }

    // ==========================================
    // MIRROR 4: Lyrist
    // ==========================================
    private async Task<string?> FetchFromLyrist(string artist, string title)
    {
        try 
        {
            var query = Uri.EscapeDataString($"{artist} {title}");
            var res = await _http.GetAsync($"https://lyrist.vercel.app/api/:{query}");
            if (res.IsSuccessStatusCode) 
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("lyrics", out var lrc)) return lrc.GetString();
            }
        } 
        catch { } 
        return null;
    }

    // ==========================================
    // MIRROR 5: SomeRandomApi
    // ==========================================
    private async Task<string?> FetchFromSomeRandomApi(string artist, string title)
    {
        try 
        {
            var query = Uri.EscapeDataString($"{artist} {title}");
            var res = await _http.GetAsync($"https://some-random-api.com/lyrics?title={query}");
            if (res.IsSuccessStatusCode) 
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("lyrics", out var lrc)) return lrc.GetString();
            }
        } 
        catch { } 
        return null;
    }

    [HttpGet("queue")]
    public IActionResult GetQueueStatus()
    {
        return Ok(new { 
            active = _isProcessing, 
            queued = _downloadQueue.Count,
            currentTrack = _currentTrackInfo
        });
    }

    [HttpPost("stop")]
    public IActionResult StopDownloads()
    {
        _downloadQueue.Clear();
        _currentTrackInfo = "Interrupted.";
        
        try 
        {
            if (_currentProcess != null && !_currentProcess.HasExited) 
            {
                _currentProcess.Kill(true);
            }
        } 
        catch { }
        
        return Ok(new { text = "Queue cleared." });
    }

    [HttpPost("scan")]
    public async Task<IActionResult> TriggerScan()
    {
        try 
        {
            using var scope = _scopeFactory.CreateScope();
            var scanner = scope.ServiceProvider.GetRequiredService<psyzx.Services.LibraryScanner>();
            await scanner.ScanAsync();
            return Ok(new { text = "Scan complete." });
        } 
        catch (Exception ex) 
        {
            return StatusCode(500, new { text = ex.Message });
        }
    }

    [HttpPost("ytdlp")]
    public IActionResult DownloadYtDlp([FromBody] YtDlpRequest req)
    {
        if (string.IsNullOrEmpty(req.url)) return BadRequest(new { text = "URL missing" });

        _downloadQueue.Enqueue(req.url);

        if (Interlocked.Exchange(ref _isProcessing, 1) == 0)
        {
            var config = HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            var basePath = config["MusicSettings:BasePath"] ?? "Music";
            var fullBasePath = Path.GetFullPath(basePath);
            
            _ = Task.Run(() => ProcessQueue(fullBasePath));
        }

        return Ok(new { text = "Added to queue!" });
    }

    private async Task ProcessQueue(string fullBasePath)
    {
        var ytDlpPath = Path.Combine(fullBasePath, "yt-dlp_linux");
        var spotDlPath = Path.Combine(fullBasePath, "spotdl_linux");
        var cookiePath = Path.Combine(fullBasePath, "cookies.txt");
        var cookieArg = System.IO.File.Exists(cookiePath) ? $"--cookies \"{cookiePath}\" " : "";

        while (_downloadQueue.TryDequeue(out var url))
        {
            _currentTrackInfo = $"Fetch: {url}";
            bool isSpotify = url.Contains("spotify.com", StringComparison.OrdinalIgnoreCase);

            if (isSpotify)
            {
                try
                {
                    _currentProcess = new Process
                    {
                        StartInfo = new ProcessStartInfo
                        {
                            FileName = spotDlPath,
                            Arguments = $"\"{url}\" --output \"{fullBasePath}/{{artist}}/{{album}}/{{title}}.{{ext}}\"",
                            RedirectStandardOutput = true,
                            RedirectStandardError = true,
                            UseShellExecute = false,
                            CreateNoWindow = true,
                            WorkingDirectory = fullBasePath
                        }
                    };

                    _currentProcess.OutputDataReceived += (sender, e) => {
                        if (!string.IsNullOrEmpty(e.Data)) {
                            _currentTrackInfo = "SpotDL active...";
                        }
                    };

                    _currentProcess.Start();
                    _currentProcess.BeginOutputReadLine();
                    
                    await _currentProcess.WaitForExitAsync();
                }
                catch { }
                finally
                {
                    _currentProcess = null;
                }
            }
            else
            {
                string firstArtist = "Unknown Artist";

                try 
                {
                    var getArtistProc = new Process
                    {
                        StartInfo = new ProcessStartInfo
                        {
                            FileName = ytDlpPath,
                            Arguments = $"{cookieArg}--js-runtimes node -i -I 1 --print \"%(artist,uploader|Unknown Artist)s\" \"{url}\"",
                            RedirectStandardOutput = true,
                            UseShellExecute = false,
                            CreateNoWindow = true
                        }
                    };
                    getArtistProc.Start();
                    firstArtist = (await getArtistProc.StandardOutput.ReadToEndAsync()).Trim();
                    await getArtistProc.WaitForExitAsync();
                    
                    if (string.IsNullOrEmpty(firstArtist)) 
                    {
                        firstArtist = "Unknown Artist";
                    }
                    else
                    {
                        string[] seps = { ",", "&", " feat", " ft.", " x ", " vs ", " and " };
                        int minIdx = firstArtist.Length;
                        
                        foreach (var sep in seps)
                        {
                            int idx = firstArtist.IndexOf(sep, StringComparison.OrdinalIgnoreCase);
                            if (idx > 0 && idx < minIdx) minIdx = idx;
                        }
                        
                        if (minIdx < firstArtist.Length) 
                        {
                            firstArtist = firstArtist.Substring(0, minIdx).Trim();
                        }
                    }
                } 
                catch { }

                string safeArtist = SanitizePath(firstArtist);

                try
                {
                    _currentProcess = new Process
                    {
                        StartInfo = new ProcessStartInfo
                        {
                            FileName = ytDlpPath,
                            Arguments = $"{cookieArg}--js-runtimes node -i -x --audio-format mp3 --audio-quality 0 --embed-metadata --embed-thumbnail --replace-in-metadata \"artist\" \".*\" \"{firstArtist}\" --replace-in-metadata \"album_artist\" \".*\" \"{firstArtist}\" -o \"{fullBasePath}/{safeArtist}/%(album,playlist_title|Unknown Album)s/%(title)s.%(ext)s\" \"{url}\"",
                            RedirectStandardOutput = true,
                            RedirectStandardError = true,
                            UseShellExecute = false,
                            CreateNoWindow = true
                        }
                    };

                    _currentProcess.OutputDataReceived += (sender, e) => {
                        if (!string.IsNullOrEmpty(e.Data) && e.Data.Contains("[download] Destination:")) {
                            var filename = Path.GetFileNameWithoutExtension(e.Data.Substring(e.Data.IndexOf("Destination:") + 13).Trim());
                            _currentTrackInfo = filename;
                        }
                    };

                    _currentProcess.Start();
                    _currentProcess.BeginOutputReadLine();
                    
                    await _currentProcess.WaitForExitAsync();
                }
                catch { }
                finally {
                    _currentProcess = null;
                }
            }

            try 
            {
                using var scope = _scopeFactory.CreateScope();
                var scanner = scope.ServiceProvider.GetRequiredService<psyzx.Services.LibraryScanner>();
                await scanner.ScanAsync();
            } 
            catch { }
        }

        _currentTrackInfo = "";
        Interlocked.Exchange(ref _isProcessing, 0); 
    }

    [HttpPut("artist/{id}")]
    public async Task<IActionResult> UpdateArtist(int id, [FromForm] string name, [FromForm] IFormFile? imageFile, [FromServices] AppDbContext db, [FromServices] IConfiguration config)
    {
        var artist = await db.Artists
            .Include(a => a.Albums)
            .ThenInclude(al => al.Tracks)
            .FirstOrDefaultAsync(a => a.Id == id);

        if (artist == null) return NotFound();

        string oldName = artist.Name;
        string newName = name;
        var basePath = Path.GetFullPath(config["MusicSettings:BasePath"] ?? "Music");
        
        var oldDir = Path.Combine(basePath, SanitizePath(oldName));
        var newDir = Path.Combine(basePath, SanitizePath(newName));

        if (Directory.Exists(oldDir) && !string.Equals(oldDir, newDir, StringComparison.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(newDir)) 
            {
                Directory.Move(oldDir, newDir);
                
                artist.ImagePath = artist.ImagePath?.Replace(SanitizePath(oldName), SanitizePath(newName));
                
                foreach (var album in artist.Albums)
                {
                    album.CoverPath = album.CoverPath?.Replace(SanitizePath(oldName), SanitizePath(newName));
                    foreach (var track in album.Tracks)
                    {
                        track.FilePath = track.FilePath?.Replace(SanitizePath(oldName), SanitizePath(newName));
                    }
                }
            }
        }
        else if (!Directory.Exists(newDir))
        {
            Directory.CreateDirectory(newDir);
        }

        if (imageFile != null && imageFile.Length > 0)
        {
            var extension = Path.GetExtension(imageFile.FileName).ToLower();
            if (string.IsNullOrEmpty(extension)) extension = ".jpg"; 

            var fileName = "artist" + extension;
            var filePath = Path.Combine(newDir, fileName);

            var oldFiles = Directory.GetFiles(newDir, "artist.*");
            foreach (var f in oldFiles) System.IO.File.Delete(f);

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await imageFile.CopyToAsync(stream);
            }

            artist.ImagePath = Path.Combine(SanitizePath(newName), fileName);
        }

        artist.Name = newName;
        await db.SaveChangesAsync();
        
        return Ok(new { artist.Name, artist.ImagePath });
    }

    [HttpPut("album/{id}")]
    public async Task<IActionResult> UpdateAlbum(int id, [FromBody] AlbumUpdateDto dto, [FromServices] AppDbContext db, [FromServices] IConfiguration config)
    {
        var album = await db.Albums.Include(a => a.Artist).Include(a => a.Tracks).FirstOrDefaultAsync(a => a.Id == id);
        if (album == null) return NotFound();

        string artistName = album.Artist.Name;
        string oldTitle = album.Title;
        string newTitle = dto.title;

        var basePath = Path.GetFullPath(config["MusicSettings:BasePath"] ?? "Music");
        var oldDir = Path.Combine(basePath, SanitizePath(artistName), SanitizePath(oldTitle));
        var newDir = Path.Combine(basePath, SanitizePath(artistName), SanitizePath(newTitle));

        if (Directory.Exists(oldDir) && !string.Equals(oldDir, newDir, StringComparison.OrdinalIgnoreCase))
        {
            Directory.Move(oldDir, newDir);
            
            if (!string.IsNullOrEmpty(album.CoverPath))
                album.CoverPath = album.CoverPath.Replace(SanitizePath(oldTitle), SanitizePath(newTitle));
                
            foreach (var track in album.Tracks)
            {
                if (!string.IsNullOrEmpty(track.FilePath))
                    track.FilePath = track.FilePath.Replace(SanitizePath(oldTitle), SanitizePath(newTitle));
            }
        }

        album.Title = newTitle;
        if (!string.IsNullOrEmpty(dto.coverPath)) album.CoverPath = dto.coverPath;

        await db.SaveChangesAsync();
        return Ok();
    }

    private string SanitizePath(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "Unknown";
        var invalid = Path.GetInvalidFileNameChars();
        return new string(name.Where(x => !invalid.Contains(x)).ToArray()).Trim().Replace(' ', '_');
    }
}

public class YtDlpRequest { public string url { get; set; } = string.Empty; }
public class ArtistUpdateDto { public string name { get; set; } = string.Empty; public string imagePath { get; set; } = string.Empty; }
public class AlbumUpdateDto { public string title { get; set; } = string.Empty; public string coverPath { get; set; } = string.Empty; }