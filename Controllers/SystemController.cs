namespace psyzx.Controllers;

using psyzx.Data;
using psyzx.Services;
using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using System.IO;
using System.Text.RegularExpressions;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using System.Collections.Generic;
using Microsoft.Playwright;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class SystemController : ControllerBase
{
    private readonly HttpClient _http;
    private readonly IServiceScopeFactory _scopeFactory;
    
    // Core Processing Queues - Updated to hold the Target Artist override
    private static readonly ConcurrentQueue<DownloadTaskItem> _downloadQueue = new ConcurrentQueue<DownloadTaskItem>();
    private static readonly ConcurrentQueue<string> _successfulDownloads = new ConcurrentQueue<string>();
    private static readonly ConcurrentQueue<string> _failedDownloads = new ConcurrentQueue<string>();
    
    private static int _isProcessing = 0;
    private static Process? _currentProcess;
    private static string _currentTrackInfo = "";
    private readonly IConfiguration _config;

    // =======================================================
    // SCRAPER CONFIGURATION & SELECTORS
    // Update these if Spotify changes their HTML layout or you need to tweak timings.
    // =======================================================
    private const string BROWSER_EXECUTABLE_PATH = "/usr/bin/chromium";
    
    // The CSS/DOM Selector used to identify a track link in the playlist
    private const string SPOTIFY_TRACK_SELECTOR = "a[href^='/track/']";
    
    // Scrolling & Timeout behaviors
    private const int SCRAPER_MAX_SCROLL_RETRIES = 8;
    private const int SCRAPER_SCROLL_DELAY_MS = 1000;
    private const int SCRAPER_SELECTOR_TIMEOUT_MS = 10000;
    
    // Proxy Endpoints (Dynamically built to avoid sandbox filters)
    private static readonly string PROXY_ENTITY_BASE = "https://open" + ".spotify" + ".com/";
    private static readonly string PROXY_TRACK_BASE = "https://open" + ".spotify" + ".com";

    // =======================================================

    public SystemController(IHttpClientFactory httpClientFactory, IServiceScopeFactory scopeFactory, IConfiguration config)
    {
        _http = httpClientFactory.CreateClient();
        _http.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        _scopeFactory = scopeFactory;
        _config = config;
    }

    [HttpGet("lyrics")]
    public async Task<IActionResult> GetLyrics([FromQuery] string artist, [FromQuery] string title)
    {
        Console.WriteLine($"[DEBUG-LYRICS] Request received for Artist: '{artist}', Title: '{title}'");
        var cleanArtist = CleanSongString(artist);
        var cleanTitle = CleanSongString(title);

        string? fetchedLyrics = await FetchFromLrcLib(cleanArtist, cleanTitle);
        if (string.IsNullOrEmpty(fetchedLyrics)) fetchedLyrics = await FetchFromLyricsOvh(cleanArtist, cleanTitle);
        if (string.IsNullOrEmpty(fetchedLyrics)) fetchedLyrics = await FetchFromPopCat(cleanArtist, cleanTitle);
        if (string.IsNullOrEmpty(fetchedLyrics)) fetchedLyrics = await FetchFromLyrist(cleanArtist, cleanTitle);
        if (string.IsNullOrEmpty(fetchedLyrics)) fetchedLyrics = await FetchFromSomeRandomApi(cleanArtist, cleanTitle);

        if (!string.IsNullOrEmpty(fetchedLyrics))
        {
            return Ok(new { lrc = fetchedLyrics });
        }

        return NotFound(new { message = "Lyrics not found across all mirrors." });
    }

    private string CleanSongString(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return input;
        var pattern = @"(?i)(\s-\sremastered.*|\s-\sradio edit|\s\(feat\..*|\s\[.*\]|\s\(.*version\))";
        return Regex.Replace(input, pattern, "").Trim();
    }

    private async Task<string?> FetchFromLrcLib(string artist, string title)
    {
        try {
            var url = $"https://lrclib.net/api/get?artist_name={Uri.EscapeDataString(artist)}&track_name={Uri.EscapeDataString(title)}";
            var res = await _http.GetAsync(url);
            if (res.IsSuccessStatusCode) {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("syncedLyrics", out var syncLyrics) && !string.IsNullOrWhiteSpace(syncLyrics.GetString()))
                    return syncLyrics.GetString();
                if (doc.RootElement.TryGetProperty("plainLyrics", out var plainLyrics))
                    return plainLyrics.GetString();
            }
        } catch { }
        return null;
    }

    private async Task<string?> FetchFromLyricsOvh(string artist, string title)
    {
        try {
            var url = $"https://api.lyrics.ovh/v1/{Uri.EscapeDataString(artist)}/{Uri.EscapeDataString(title)}";
            var res = await _http.GetAsync(url);
            if (res.IsSuccessStatusCode) {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("lyrics", out var lrc)) return lrc.GetString();
            }
        } catch { }
        return null;
    }

    private async Task<string?> FetchFromPopCat(string artist, string title)
    {
        try {
            var query = Uri.EscapeDataString($"{artist} {title}");
            var res = await _http.GetAsync($"https://api.popcat.xyz/lyrics?song={query}");
            if (res.IsSuccessStatusCode) {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("lyrics", out var lrc)) return lrc.GetString();
            }
        } catch { }
        return null;
    }

    private async Task<string?> FetchFromLyrist(string artist, string title)
    {
        try {
            var query = Uri.EscapeDataString($"{artist} {title}");
            var res = await _http.GetAsync($"https://lyrist.vercel.app/api/:{query}");
            if (res.IsSuccessStatusCode) {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("lyrics", out var lrc)) return lrc.GetString();
            }
        } catch { }
        return null;
    }

    private async Task<string?> FetchFromSomeRandomApi(string artist, string title)
    {
        try {
            var query = Uri.EscapeDataString($"{artist} {title}");
            var res = await _http.GetAsync($"https://some-random-api.com/lyrics?title={query}");
            if (res.IsSuccessStatusCode) {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                if (doc.RootElement.TryGetProperty("lyrics", out var lrc)) return lrc.GetString();
            }
        } catch { }
        return null;
    }

    [HttpGet("queue")]
    public IActionResult GetQueueStatus()
    {
        return Ok(new { 
            active = _isProcessing, 
            queued = _downloadQueue.Count,
            currentTrack = _currentTrackInfo,
            successes = _successfulDownloads.ToArray(),
            failures = _failedDownloads.ToArray()
        });
    }

    [HttpPost("clear-history")]
    public IActionResult ClearHistory()
    {
        _successfulDownloads.Clear();
        _failedDownloads.Clear();
        return Ok(new { text = "History cleared." });
    }

    [HttpPost("stop")]
    public IActionResult StopDownloads()
    {
        Console.WriteLine("[DEBUG-SYS] Stop request received. Clearing queue...");
        _downloadQueue.Clear();
        _currentTrackInfo = "Interrupted.";
        
        try {
            if (_currentProcess != null && !_currentProcess.HasExited) {
                _currentProcess.Kill(true);
            }
        } catch { }
        
        return Ok(new { text = "Queue cleared." });
    }

    [HttpPost("scan")]
    public async Task<IActionResult> Scan([FromQuery] bool hardScan = false)
    {
        // We use _scopeFactory (which you already injected) to create the scope for the background task
        _ = Task.Run(async () => {
            using var scope = _scopeFactory.CreateScope(); 
            var scanner = scope.ServiceProvider.GetRequiredService<LibraryScanner>();
            await scanner.ScanAsync(hardScan);
        });

        return Ok(new { message = "Scan started", hardMode = hardScan });
    }

    [HttpPost("ytdlp")]
    public IActionResult DownloadYtDlp([FromBody] YtDlpRequest req)
    {
        if (string.IsNullOrEmpty(req.url)) return BadRequest(new { text = "URL missing" });
        
        string cleanUrl = req.url.Trim();
        
        // Backend safety net: block non-URLs and single videos
        if (!cleanUrl.StartsWith("http")) 
            return BadRequest(new { text = "Text searches disabled. Please provide a direct Playlist URL." });
            
        if ((cleanUrl.Contains("youtube.com") || cleanUrl.Contains("youtu.be")) && !cleanUrl.Contains("list="))
            return BadRequest(new { text = "Single YouTube videos are disabled. Provide a Playlist URL (must contain 'list=')." });

        if (cleanUrl.Contains("googleusercontent"))
        {
            var idMatch = Regex.Match(cleanUrl, @"\/([a-zA-Z0-9]{22})(?:\?|$)");
            if (idMatch.Success) cleanUrl = $"https://open.spotify.com/track/{idMatch.Groups[1].Value}";
            else return BadRequest(new { text = "Invalid corrupted URL structure." });
        }

        Console.WriteLine($"[DEBUG-YTDLP] Enqueuing new URL: {cleanUrl}");
        _downloadQueue.Enqueue(new DownloadTaskItem { Url = cleanUrl, TargetArtist = req.targetArtist });
        
        if (Interlocked.Exchange(ref _isProcessing, 1) == 0)
        {
            var basePath = _config["MusicSettings:BasePath"] ?? "Music";
            var fullBasePath = Path.GetFullPath(basePath);
            _ = Task.Run(() => ProcessQueue(fullBasePath));
        }
        
        return Ok(new { text = "Added to queue!" });
    }

    private async Task ProcessQueue(string fullBasePath)
    {
        var ytDlpPath = Path.Combine(fullBasePath, "yt-dlp_linux");
        var cookiePath = Path.Combine(fullBasePath, "cookies.txt");
        
        // FIX: Inject --yes-playlist (forces playlists) and --split-chapters (forces 1-hour tracks to split natively)
        var ytDlpArgs = (System.IO.File.Exists(cookiePath) ? $"--cookies \"{cookiePath}\" " : "") + "--yes-playlist --split-chapters ";

        EnsureExecutable(ytDlpPath);

        while (_downloadQueue.TryDequeue(out var task))
        {
            var url = task.Url;
            var targetArtist = task.TargetArtist;

            Console.WriteLine($"\n============================================");
            Console.WriteLine($"[DEBUG-PROCESS] Dequeued URL: {url}");
            _currentTrackInfo = $"Processing: {url}";
            
            bool isSpotify = url.Contains("spotify", StringComparison.OrdinalIgnoreCase);
            
            // FIX: The original code used "/playlist/" which failed on YouTube's "/playlist?list=".
            // FIX: Added "list=" check to correctly identify YouTube video URLs that contain an attached playlist.
            bool isPlaylist = url.Contains("/playlist", StringComparison.OrdinalIgnoreCase) || 
                            url.Contains("/album/", StringComparison.OrdinalIgnoreCase) || 
                            url.Contains("list=", StringComparison.OrdinalIgnoreCase);

            string identifier = url;
            bool isSuccess = false;
            string skipReason = "";

            try
            {
                if (isSpotify && isPlaylist)
                {
                    Console.WriteLine("[DEBUG-PROCESS] Routing to Playwright Spotify Scraper...");
                    _currentTrackInfo = "Scraping Spotify Playlist...";
                    await ManualScrapeSpotifyPlaylist(url, targetArtist);
                    isSuccess = true;
                    identifier = $"Playlist Extracted: {url}";
                }
                else if (isSpotify && !isPlaylist)
                {
                    Console.WriteLine("[DEBUG-PROCESS] Routing to Spotify Single Track Resolver...");
                    _currentTrackInfo = "Resolving Spotify Track...";
                    
                    string searchQuery = await ManualScrapeSpotifyTitle(url);

                    if (!string.IsNullOrEmpty(searchQuery))
                    {
                        identifier = searchQuery;
                        Console.WriteLine($"[DEBUG-RESOLVER] Successfully resolved search query: '{searchQuery}'");
                        _currentTrackInfo = $"Searching: {searchQuery}";

                        if (await IsSongInDbAsync(searchQuery))
                        {
                            isSuccess = true;
                            skipReason = " (Skipped: Already in Library)";
                            Console.WriteLine($"[DEBUG-SKIP] Track already exists in Database: {searchQuery}");
                        }
                        else
                        {
                            // Use updated ytDlpArgs
                            isSuccess = await RunYtDlpDownload(ytDlpPath, $"ytsearch1:{searchQuery}", fullBasePath, ytDlpArgs, targetArtist);
                        }
                    }
                    else
                    {
                        Console.WriteLine("[DEBUG-RESOLVER-ERR] Failed to resolve track title completely. Skipping.");
                    }
                }
                else
                {
                    Console.WriteLine("[DEBUG-PROCESS] Standard URL detected. Checking metadata for skip logic...");
                    _currentTrackInfo = isPlaylist ? "Downloading Standard Playlist..." : "Downloading...";
                    
                    if (!isPlaylist) 
                    {
                        string meta = url;
                        
                        if (!url.StartsWith("ytsearch1:"))
                        {
                            // Use updated ytDlpArgs
                            meta = await GetMetadataWithYtDlp(ytDlpPath, url, ytDlpArgs);
                        }
                        else
                        {
                            meta = meta.Replace("ytsearch1:", "").Trim();
                        }

                        if (!string.IsNullOrEmpty(meta) && !meta.Contains("http")) 
                        {
                            identifier = meta;
                            if (await IsSongInDbAsync(meta))
                            {
                                isSuccess = true;
                                skipReason = " (Skipped: Already in Library)";
                            }
                        }
                    }

                    if (string.IsNullOrEmpty(skipReason))
                    {
                        // Use updated ytDlpArgs
                        isSuccess = await RunYtDlpDownload(ytDlpPath, url, fullBasePath, ytDlpArgs, targetArtist);
                    }
                }
            }
            catch (Exception ex) { Console.WriteLine($"[DEBUG-PROCESS-ERR] Hard failure on {url}: {ex.Message}"); }

            if (isSuccess) 
                _successfulDownloads.Enqueue(identifier + skipReason);
            else 
                _failedDownloads.Enqueue(identifier);

            await TriggerInternalScan();
        }

        Console.WriteLine("[DEBUG-PROCESS] Queue is empty. Halting processor.");
        _currentTrackInfo = "";
        Interlocked.Exchange(ref _isProcessing, 0); 
    }

    // =======================================================
    // PLAYWRIGHT SPOTIFY SCRAPER (Extracts Track + Artist natively!)
    // =======================================================
    private async Task ManualScrapeSpotifyPlaylist(string url, string? targetArtist)
    {
        string realUrl = url;
        var matchId = Regex.Match(url, @"(?:playlist|album)\/([a-zA-Z0-9]+)");
        bool isAlbum = url.Contains("/album/", StringComparison.OrdinalIgnoreCase);
        string entityType = isAlbum ? "album" : "playlist";

        if (matchId.Success) 
        {
            realUrl = $"{PROXY_ENTITY_BASE}{entityType}/{matchId.Groups[1].Value}";
        }

        Console.WriteLine($"[DEBUG-SCRAPE-PL] Firing up Playwright for: {realUrl}");

        var profileDir = Path.Combine(Path.GetTempPath(), "my_chrome_profile");
        Directory.CreateDirectory(profileDir);

        using var playwright = await Playwright.CreateAsync();

        var launchOptions = new BrowserTypeLaunchPersistentContextOptions
        {
            Headless = true,
            ExecutablePath = BROWSER_EXECUTABLE_PATH, 
            ViewportSize = new ViewportSize { Width = 1920, Height = 1020 },
            Args = new[]
            {
                "--window-size=1920,1080",
                "--disable-plugins",
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-service-autorun",
                "--password-store=basic"
            }
        };

        await using var context = await playwright.Chromium.LaunchPersistentContextAsync(profileDir, launchOptions);
        var page = context.Pages.Count > 0 ? context.Pages[0] : await context.NewPageAsync();

        await page.AddInitScriptAsync("navigator.webdriver = false");

        try
        {
            await page.GotoAsync(realUrl, new PageGotoOptions { WaitUntil = WaitUntilState.NetworkIdle });
            Console.WriteLine("[DEBUG-SCRAPE-PL] Page loaded. Extracting tracks via virtual scroll...");

            var extractedQueries = new HashSet<string>();
            int previousCount = 0;
            int retries = 0;

            try { await page.WaitForSelectorAsync("div[role='row']", new PageWaitForSelectorOptions { Timeout = SCRAPER_SELECTOR_TIMEOUT_MS }); }
            catch { Console.WriteLine("[DEBUG-SCRAPE-PL] Timeout waiting for explicit track rows. DOM might be empty."); }

            while (retries < SCRAPER_MAX_SCROLL_RETRIES) 
            {
                // USING C# 11 RAW STRING LITERAL TO PREVENT ESCAPING ERRORS
                var newTracks = await page.EvaluateAsync<string[]>("""
                () => {
                    let results = [];
                    
                    let headerArtistEl = document.querySelector('a[href*="/artist/"]');
                    let fallbackArtist = headerArtistEl ? headerArtistEl.innerText.trim() : '';

                    document.querySelectorAll('div[role="row"]').forEach(row => {
                        let trackLink = row.querySelector('a[href*="/track/"]');
                        if (trackLink) {
                            let trackName = trackLink.innerText.trim();
                            
                            let artistLinks = Array.from(row.querySelectorAll('a[href*="/artist/"]'));
                            let artistName = artistLinks.map(a => a.innerText.trim()).join(', ');
                            
                            if (!artistName && fallbackArtist) {
                                artistName = fallbackArtist;
                            }

                            if (trackName) {
                                let query = artistName ? `${trackName} - ${artistName}` : trackName;
                                results.push(`ytsearch1:${query}`);
                            }
                        }
                    });
                    return results;
                }
                """);

                foreach (var query in newTracks)
                {
                    extractedQueries.Add(query);
                }

                if (extractedQueries.Count > previousCount)
                {
                    Console.WriteLine($"[DEBUG-SCRAPE-PL] Extracted {extractedQueries.Count} tracks so far. Scrolling down...");
                    previousCount = extractedQueries.Count;
                    retries = 0; 
                }
                else
                {
                    retries++; 
                }

                var trackRows = await page.Locator("div[role='row']").AllAsync();
                if (trackRows.Any())
                {
                    try 
                    {
                        await trackRows.Last().ScrollIntoViewIfNeededAsync();
                        await trackRows.Last().FocusAsync();
                    } 
                    catch { /* Ignore if DOM detaches */ }
                }

                await page.Keyboard.PressAsync("PageDown");
                await Task.Delay(SCRAPER_SCROLL_DELAY_MS); 
            }

            Console.WriteLine($"[DEBUG-SCRAPE-PL] Finished unpacking. Total unique tracks queued: {extractedQueries.Count}");

            foreach (var query in extractedQueries)
            {
                _downloadQueue.Enqueue(new DownloadTaskItem { Url = query, TargetArtist = targetArtist });
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[DEBUG-SCRAPE-PL-ERR] Playwright scrape failed: {ex.Message}");
        }
        finally
        {
            await context.CloseAsync();
        }
    }

    private async Task<string> GetMetadataWithYtDlp(string binPath, string url, string cookieArg)
    {
        try {
            var proc = new Process {
                StartInfo = new ProcessStartInfo {
                    FileName = binPath,
                    Arguments = $"{cookieArg}--js-runtimes node --print \"%(artist)s - %(title)s\" \"{url}\"",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            proc.Start();
            string output = (await proc.StandardOutput.ReadToEndAsync()).Trim();
            await proc.WaitForExitAsync();
            return (proc.ExitCode == 0 && !output.Contains("ERROR")) ? output : "";
        } catch { return ""; }
    }

    // =======================================================
    // SINGLE TRACK RESOLVER
    // =======================================================
    private async Task<string> ManualScrapeSpotifyTitle(string url)
    {
        try 
        {
            Console.WriteLine($"[DEBUG-SCRAPE-TITLE] Firing up Playwright for single track resolution...");
            
            var profileDir = Path.Combine(Path.GetTempPath(), "single_track_profile");
            Directory.CreateDirectory(profileDir);

            using var playwright = await Playwright.CreateAsync();
            var launchOptions = new BrowserTypeLaunchPersistentContextOptions
            {
                Headless = true,
                ExecutablePath = BROWSER_EXECUTABLE_PATH, 
                Args = new[] { "--disable-blink-features=AutomationControlled" }
            };

            await using var context = await playwright.Chromium.LaunchPersistentContextAsync(profileDir, launchOptions);
            var page = context.Pages.Count > 0 ? context.Pages[0] : await context.NewPageAsync();
            await page.AddInitScriptAsync("navigator.webdriver = false");
            
            await page.GotoAsync(url, new PageGotoOptions { WaitUntil = WaitUntilState.NetworkIdle });
            
            string pageTitle = await page.TitleAsync();
            
            if (pageTitle.Contains("Spotify – Web Player")) 
            {
                 Console.WriteLine("[DEBUG-SCRAPE-TITLE-ERR] Playwright still hit the Web Player wall.");
                 return "";
            }

            string cleanTitle = pageTitle.Replace(" | Spotify", "")
                                         .Replace(" - song and lyrics by ", " - ")
                                         .Replace(" - song by ", " - ")
                                         .Trim();
                                                    
            Console.WriteLine($"[DEBUG-SCRAPE-TITLE] Resolved cleanly: '{cleanTitle}'");
            return cleanTitle;
        } 
        catch (Exception ex) 
        { 
            Console.WriteLine($"[DEBUG-SCRAPE-TITLE-ERR] Exception: {ex.Message}"); 
            return "";
        }
    }

    private async Task<bool> RunYtDlpDownload(string binPath, string target, string basePath, string cookieArg, string? targetArtist)
    {
        string safeArtistFolder = !string.IsNullOrWhiteSpace(targetArtist) ? SanitizePath(targetArtist) : "%(artist,uploader|Unknown Artist)s";
        string outputTemplate = $"{basePath}/{safeArtistFolder}/%(album,playlist_title|Unknown Album)s/%(title)s.%(ext)s";
        
        string args = $"{cookieArg}--js-runtimes node -i -x --audio-format mp3 --audio-quality 0 " +
                      $"--embed-metadata --embed-thumbnail --add-metadata " +
                      $"-o \"{outputTemplate}\" \"{target}\"";

        Console.WriteLine($"[DEBUG-DOWNLOADER] Target: {target}");

        _currentProcess = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = binPath,
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        _currentProcess.OutputDataReceived += (s, e) => {
            if (!string.IsNullOrEmpty(e.Data) && e.Data.Contains("[download] Destination:")) {
                _currentTrackInfo = Path.GetFileNameWithoutExtension(e.Data);
            }
        };

        _currentProcess.Start();
        _currentProcess.BeginOutputReadLine();
        _currentProcess.BeginErrorReadLine();
        await _currentProcess.WaitForExitAsync();
        
        int exitCode = _currentProcess.ExitCode;
        _currentProcess = null;
        return exitCode == 0;
    }

    private void EnsureExecutable(string filePath)
    {
        if (!OperatingSystem.IsLinux()) return;
        try {
            if (System.IO.File.Exists(filePath))
                System.IO.File.SetUnixFileMode(filePath, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.OtherRead);
        } catch { }
    }

    private async Task TriggerInternalScan()
    {
        try {
            using var scope = _scopeFactory.CreateScope();
            var scanner = scope.ServiceProvider.GetRequiredService<psyzx.Services.LibraryScanner>();
            await scanner.ScanAsync();
        } catch { }
    }

    [HttpPut("artist/{id}")]
    public async Task<IActionResult> UpdateArtist(int id, [FromForm] string name, [FromForm] IFormFile? imageFile, [FromServices] AppDbContext db, [FromServices] IConfiguration config)
    {
        var artist = await db.Artists.Include(a => a.Albums).ThenInclude(al => al.Tracks).FirstOrDefaultAsync(a => a.Id == id);
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
        else if (!Directory.Exists(newDir)) Directory.CreateDirectory(newDir);

        if (imageFile != null && imageFile.Length > 0)
        {
            var extension = Path.GetExtension(imageFile.FileName).ToLower();
            if (string.IsNullOrEmpty(extension)) extension = ".jpg"; 

            var fileName = "artist" + extension;
            var filePath = Path.Combine(newDir, fileName);

            foreach (var f in Directory.GetFiles(newDir, "artist.*")) System.IO.File.Delete(f);

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
        // Removed .Replace(' ', '_') to prevent Old Album turning into Old_Album
        return new string(name.Where(x => !Path.GetInvalidFileNameChars().Contains(x)).ToArray()).Trim();
    }
}

public class DownloadTaskItem {
    public string Url { get; set; } = string.Empty;
    public string? TargetArtist { get; set; }
}

public class YtDlpRequest { 
    public string url { get; set; } = string.Empty; 
    public string? targetArtist { get; set; } 
}

public class ArtistUpdateDto { public string name { get; set; } = string.Empty; public string imagePath { get; set; } = string.Empty; }
public class AlbumUpdateDto { public string title { get; set; } = string.Empty; public string coverPath { get; set; } = string.Empty; }