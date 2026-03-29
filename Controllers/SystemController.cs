namespace psyzx.Controllers;

using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Diagnostics;
using System.Text.Json;

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

    [HttpGet("stats")]
    public IActionResult GetStats()
    {
        var proc = Process.GetCurrentProcess();
        double appRamMb = proc.WorkingSet64 / 1024.0 / 1024.0;
        
        long sysTotalRam = 0;
        long sysFreeRam = 0;

        try
        {
            var meminfo = System.IO.File.ReadAllLines("/proc/meminfo");
            sysTotalRam = long.Parse(meminfo[0].Replace("MemTotal:", "").Replace("kB", "").Trim()) / 1024;
            sysFreeRam = long.Parse(meminfo[2].Replace("MemAvailable:", "").Replace("kB", "").Trim()) / 1024;
        }
        catch { }

        return Ok(new
        {
            appRamUsageMb = Math.Round(appRamMb, 2),
            appThreads = proc.Threads.Count,
            sysRamTotalMb = sysTotalRam,
            sysRamUsedMb = sysTotalRam - sysFreeRam
        });
    }

    [HttpGet("lyrics")]
    public async Task<IActionResult> GetLyrics([FromQuery] string artist, [FromQuery] string title)
    {
        try
        {
            var res = await _http.GetAsync($"https://lrclib.net/api/get?artist_name={Uri.EscapeDataString(artist)}&track_name={Uri.EscapeDataString(title)}");
            if (res.IsSuccessStatusCode)
            {
                var json = await res.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("syncedLyrics", out var syncLyrics))
                {
                    var lrc = syncLyrics.GetString();
                    if (!string.IsNullOrEmpty(lrc)) return Ok(new { lrc = lrc });
                }
            }
        }
        catch { }
        return NotFound();
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
        var cookiePath = Path.Combine(fullBasePath, "cookies.txt");
        var cookieArg = System.IO.File.Exists(cookiePath) ? $"--cookies \"{cookiePath}\" " : "";

        while (_downloadQueue.TryDequeue(out var url))
        {
            _currentTrackInfo = $"Fetch: {url}";
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

            string safeArtist = string.Join("_", firstArtist.Split(Path.GetInvalidFileNameChars()));

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
                
                using var scope = _scopeFactory.CreateScope();
                var scanner = scope.ServiceProvider.GetRequiredService<psyzx.Services.LibraryScanner>();
                await scanner.ScanAsync();
            }
            catch { }
            finally {
                _currentProcess = null;
            }
        }

        _currentTrackInfo = "";
        Interlocked.Exchange(ref _isProcessing, 0); 
    }
}

public class YtDlpRequest
{
    public string url { get; set; } = string.Empty;
}