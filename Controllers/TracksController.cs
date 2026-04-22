namespace psyzx.Controllers;

using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Models;
using psyzx.Services; 
using System.IO;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Linq;
using Microsoft.Extensions.Configuration;
using System;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using System.Diagnostics;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;
using SixLabors.ImageSharp.Formats.Jpeg;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class TracksController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly string _basePath;

    public TracksController(AppDbContext context, IConfiguration config)
    {
        _context = context;
        _basePath = Path.GetFullPath(config["MusicSettings:BasePath"] ?? "");
    }

    [HttpGet]
    public async Task<IActionResult> GetAllTracks()
    {
        var tracks = await _context.Tracks
            .AsNoTracking() 
            .Include(t => t.Album)
            .ThenInclude(a => a.Artist)
            .ToListAsync();
            
        // Done client-side memory rather than SQL mapping to safely handle nulls
        var safeTracks = tracks.Select(t => new {
            id = t.Id,
            title = t.Title,
            filePath = t.FilePath, 
            durationSeconds = t.DurationSeconds,
            bitrate = t.Bitrate,
            trackNumber = t.TrackNumber,
            discNumber = t.DiscNumber,
            playCount = t.PlayCount,
            albumId = t.AlbumId,
            album = t.Album == null ? null : new {
                id = t.Album.Id,
                title = t.Album.Title,
                coverPath = t.Album.CoverPath,
                releaseYear = t.Album.ReleaseYear,
                playCount = t.Album.PlayCount,
                artist = t.Album.Artist == null ? null : new {
                    id = t.Album.Artist.Id,
                    name = t.Album.Artist.Name,
                    imagePath = t.Album.Artist.ImagePath
                }
            }
        });
            
        return Ok(safeTracks);
    }

    [HttpGet("stream/{id}")]
    public async Task<IActionResult> StreamTrack(int id, [FromQuery] int kbps = 192, [FromQuery] string format = "mp3")
    {
        var track = await _context.Tracks.FindAsync(id);
        if (track == null) return NotFound();

        var fullPath = Path.Combine(_basePath, track.FilePath);
        
        // FIX 1: Fallback to 320 if track.Bitrate is missing/0 to prevent FFmpeg crash
        int validTrackBitrate = track.Bitrate > 0 ? track.Bitrate : 320;
        int targetKbps = Math.Min(kbps, validTrackBitrate);
        
        bool needsTranscode = track.Bitrate > kbps || format == "mp4";

        if (needsTranscode)
        {
            string contentType = format == "mp4" ? "audio/mp4" : "audio/mpeg";

            // 1. Added '-re' to process in real-time (1x speed limit)
            // 2. Kept '-threads 1' to isolate it to a single core
            string ffmpegArgs = format == "mp4"
                ? $"-re -threads 1 -i \"{fullPath}\" -map 0:a:0 -c:a aac -b:a {targetKbps}k -f mp4 -movflags frag_keyframe+empty_moov -"
                : $"-re -threads 1 -i \"{fullPath}\" -map 0:a:0 -b:a {targetKbps}k -f mp3 -";
            
            var process = new Process {
                StartInfo = new ProcessStartInfo {
                    // Use the Linux 'nice' command to run FFmpeg with lowest CPU priority (19)
                    // This ensures FFmpeg only uses CPU cycles the OS doesn't currently need.
                    FileName = "nice",
                    Arguments = $"-n 19 ffmpeg {ffmpegArgs}",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            process.Start();
            
            return File(process.StandardOutput.BaseStream, contentType, enableRangeProcessing: false);
        }
        
        // Native files ARE seekable, so range processing stays true here
        return PhysicalFile(fullPath, "audio/mpeg", enableRangeProcessing: true);
    }

    [HttpGet("image")]
    public IActionResult GetImage([FromQuery] string path, [FromQuery] string quality = "high")
    {
        var fullPath = Path.Combine(_basePath, path);
        if (!System.IO.File.Exists(fullPath)) return NotFound();

        if (quality == "low")
        {
            // Use ImageSharp to resize on the fly and compress (or serve a pre-generated thumbnail)
            using var image = SixLabors.ImageSharp.Image.Load(fullPath);
            image.Mutate(x => x.Resize(new ResizeOptions {
                Size = new Size(300, 300),
                Mode = ResizeMode.Crop
            }));
            
            var ms = new MemoryStream();
            image.SaveAsJpeg(ms, new JpegEncoder { Quality = 50 }); // High compression
            ms.Position = 0;
            return File(ms, "image/jpeg");
        }

        return PhysicalFile(fullPath, "image/jpeg");
    }

    [HttpGet("radio/{seedTrackId}")]
    public async Task<IActionResult> GetRadioMix(int seedTrackId, [FromQuery] int limit = 20, [FromQuery] string excludeIds = "")
    {
        var excludeList = new HashSet<int> { seedTrackId };

        if (!string.IsNullOrEmpty(excludeIds))
        {
            var parsedIds = excludeIds.Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(id => int.TryParse(id, out var parsed) ? parsed : -1)
                .Where(id => id != -1);

            foreach (var id in parsedIds)
                excludeList.Add(id);
        }

        var seedTrack = await _context.Tracks
            .Include(t => t.Album)
            .FirstOrDefaultAsync(t => t.Id == seedTrackId);

        if (seedTrack == null) return NotFound();

        int? seedArtistId = seedTrack.Album?.ArtistId;
        var finalMix = new List<Track>();

        // --- Bucket 1: Same-artist tracks (40%) ---
        int artistQuota = (int)Math.Floor(limit * 0.4);
        if (seedArtistId.HasValue && artistQuota > 0)
        {
            var artistTracks = await _context.Tracks
                .Include(t => t.Album).ThenInclude(a => a.Artist)
                .Where(t => t.Album != null
                        && t.Album.ArtistId == seedArtistId.Value
                        && !excludeList.Contains(t.Id))
                .OrderBy(t => EF.Functions.Random())
                .Take(artistQuota)
                .ToListAsync();

            finalMix.AddRange(artistTracks);
            foreach (var t in artistTracks) excludeList.Add(t.Id);
        }

        // --- Bucket 2: Discovery favorites (30%) ---
        // FIX: Removed hard `PlayCount > 0` gate; sort by PlayCount DESC so
        // played songs still float to the top, but unplayed ones fill the gap
        // rather than letting the bucket starve and causing repeats.
        int favoritesQuota = (int)Math.Floor(limit * 0.3);
        if (favoritesQuota > 0)
        {
            var favoriteTracks = await _context.Tracks
                .Include(t => t.Album).ThenInclude(a => a.Artist)
                .Where(t => !excludeList.Contains(t.Id))
                .OrderByDescending(t => t.PlayCount)
                .Take(300)
                .OrderBy(t => EF.Functions.Random())
                .Take(favoritesQuota)
                .ToListAsync();

            finalMix.AddRange(favoriteTracks);
            foreach (var t in favoriteTracks) excludeList.Add(t.Id);
        }

        // --- Bucket 3: Random filler / deep cuts (remaining %) ---
        int remaining = limit - finalMix.Count;
        if (remaining > 0)
        {
            var randomTracks = await _context.Tracks
                .Include(t => t.Album).ThenInclude(a => a.Artist)
                .Where(t => !excludeList.Contains(t.Id))
                .OrderBy(t => EF.Functions.Random())
                .Take(remaining)
                .ToListAsync();

            finalMix.AddRange(randomTracks);
        }

        // --- Final shuffle to interleave buckets ---
        var shuffledResult = finalMix
            .OrderBy(_ => Guid.NewGuid())
            .Select(t => new {
                id = t.Id,
                title = t.Title,
                filePath = t.FilePath,
                durationSeconds = t.DurationSeconds,
                trackNumber = t.TrackNumber,
                bitrate = t.Bitrate,
                playCount = t.PlayCount,
                albumId = t.AlbumId,
                album = t.Album == null ? null : new {
                    id = t.Album.Id,
                    title = t.Album.Title,
                    coverPath = t.Album.CoverPath,
                    artist = t.Album.Artist == null ? null : new {
                        id = t.Album.Artist.Id,
                        name = t.Album.Artist.Name
                    }
                }
            }).ToList();

        return Ok(shuffledResult);
    }

    [HttpGet("wrapped")]
    public async Task<IActionResult> GetWrapped([FromQuery] string duration = "month")
    {
        var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdStr, out int userId)) return Unauthorized();

        DateTime startDate = DateTime.UtcNow;
        if (duration == "week") startDate = startDate.AddDays(-7);
        else if (duration == "month") startDate = startDate.AddMonths(-1);
        else if (duration == "year") startDate = startDate.AddYears(-1);
        else startDate = DateTime.MinValue; // all time

        var topTrackId = await _context.ListenEvents
            .Where(le => le.UserId == userId && le.Timestamp >= startDate && le.ListenDuration > 0)
            .GroupBy(le => le.TrackId)
            .OrderByDescending(g => g.Sum(le => le.ListenDuration))
            .Select(g => (int?)g.Key)
            .FirstOrDefaultAsync();

        var topAlbumId = await _context.ListenEvents
            .Include(le => le.Track)
            .Where(le => le.UserId == userId && le.Timestamp >= startDate && le.ListenDuration > 0)
            .GroupBy(le => le.Track.AlbumId)
            .OrderByDescending(g => g.Sum(le => le.ListenDuration))
            .Select(g => (int?)g.Key)
            .FirstOrDefaultAsync();

        var topArtistId = await _context.ListenEvents
            .Include(le => le.Track).ThenInclude(t => t.Album)
            .Where(le => le.UserId == userId && le.Timestamp >= startDate && le.ListenDuration > 0)
            .GroupBy(le => le.Track.Album.ArtistId)
            .OrderByDescending(g => g.Sum(le => le.ListenDuration))
            .Select(g => (int?)g.Key)
            .FirstOrDefaultAsync();

        int totalSeconds = await _context.ListenEvents
            .Where(le => le.UserId == userId && le.Timestamp >= startDate)
            .Select(le => (int?)le.ListenDuration)
            .SumAsync() ?? 0;

        var response = new Dictionary<string, object>
        {
            ["totalListenTimeSeconds"] = totalSeconds
        };

        if (topTrackId.HasValue)
        {
            var track = await _context.Tracks.FindAsync(topTrackId.Value);
            if (track != null)
                response["topTrack"] = new { id = track.Id, title = track.Title };
        }

        if (topAlbumId.HasValue)
        {
            var album = await _context.Albums.FindAsync(topAlbumId.Value);
            if (album != null)
                response["topAlbum"] = new { id = album.Id, title = album.Title, coverPath = album.CoverPath };
        }

        if (topArtistId.HasValue)
        {
            var artist = await _context.Artists.FindAsync(topArtistId.Value);
            if (artist != null)
                response["topArtist"] = new { id = artist.Id, name = artist.Name, imagePath = artist.ImagePath };
        }

        return Ok(response);
    }

    [HttpPost("{id}/play")]
    public async Task<IActionResult> RecordPlay(int id, [FromBody] RecordPlayRequest? request)
    {
        var track = await _context.Tracks
            .Include(t => t.Album)
            .FirstOrDefaultAsync(t => t.Id == id);

        if (track == null) return NotFound();

        track.PlayCount++;

        if (track.Album != null)
        {
            track.Album.PlayCount++;
        }

        if (User.Identity?.IsAuthenticated == true)
        {
            var userIdStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (int.TryParse(userIdStr, out int userId))
            {
                var listenEvent = new ListenEvent
                {
                    TrackId = track.Id,
                    UserId = userId,
                    Timestamp = DateTime.UtcNow,
                    ListenDuration = request?.ListenDuration ?? 0,
                    IsCompleted = request?.IsCompleted ?? false,
                    IsSkipped = request?.IsSkipped ?? false,
                    PlaybackContext = request?.PlaybackContext ?? string.Empty,
                    ClientOS = GetClientOS(Request.Headers["User-Agent"].ToString()),
                    ClientBrowser = GetClientBrowser(Request.Headers["User-Agent"].ToString())
                };
                
                _context.ListenEvents.Add(listenEvent);
            }
        }

        await _context.SaveChangesAsync();
        return Ok(new { trackPlays = track.PlayCount, albumPlays = track.Album?.PlayCount ?? 0 });
    }

    private string GetClientOS(string userAgent)
    {
        if (string.IsNullOrEmpty(userAgent)) return "Unknown";
        if (userAgent.Contains("Windows")) return "Windows";
        if (userAgent.Contains("Mac OS")) return "macOS";
        if (userAgent.Contains("Linux")) return "Linux";
        if (userAgent.Contains("Android")) return "Android";
        if (userAgent.Contains("iPhone") || userAgent.Contains("iPad")) return "iOS";
        return "Unknown";
    }

    private string GetClientBrowser(string userAgent)
    {
        if (string.IsNullOrEmpty(userAgent)) return "Unknown";
        if (userAgent.Contains("Firefox")) return "Firefox";
        if (userAgent.Contains("OPR") || userAgent.Contains("Opera")) return "Opera";
        if (userAgent.Contains("Edg")) return "Edge";
        if (userAgent.Contains("Chrome")) return "Chrome";
        if (userAgent.Contains("Safari")) return "Safari";
        return "Unknown";
    }
}

public class RecordPlayRequest
{
    public int ListenDuration { get; set; }
    public bool IsCompleted { get; set; }
    public bool IsSkipped { get; set; }
    public string PlaybackContext { get; set; } = string.Empty;
}