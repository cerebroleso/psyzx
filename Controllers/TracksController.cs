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
using Microsoft.AspNetCore.Authorization;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class TracksController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly string _basePath;
    private readonly LyricsDownloader _lyricsDownloader;

    public TracksController(AppDbContext context, IConfiguration config, LyricsDownloader lyricsDownloader)
    {
        _context = context;
        _basePath = config["MusicSettings:BasePath"] ?? "";
        _lyricsDownloader = lyricsDownloader;
    }

    [HttpGet]
    public async Task<IActionResult> GetAllTracks()
    {
        var tracks = await _context.Tracks
            .AsNoTracking() 
            .Include(t => t.Album)
            .ThenInclude(a => a.Artist)
            .Select(t => new {
                id = t.Id,
                title = t.Title,
                filePath = t.FilePath, 
                // --- RESTORED MISSING TRACK DATA ---
                durationSeconds = t.DurationSeconds,
                bitrate = t.Bitrate,
                trackNumber = t.TrackNumber,
                discNumber = t.DiscNumber,
                playCount = t.PlayCount,
                albumId = t.AlbumId, // Critical for Player Cover mapping
                // -----------------------------------
                album = new {
                    id = t.Album.Id,
                    title = t.Album.Title,
                    coverPath = t.Album.CoverPath,
                    // --- RESTORED MISSING ALBUM DATA ---
                    releaseYear = t.Album.ReleaseYear,
                    playCount = t.Album.PlayCount,
                    // -----------------------------------
                    artist = new {
                        id = t.Album.Artist.Id,
                        name = t.Album.Artist.Name,
                        imagePath = t.Album.Artist.ImagePath
                    }
                }
            })
            .ToListAsync();
            
        return Ok(tracks);
    }

    [HttpGet("stream/{id}")]
    public async Task<IActionResult> StreamTrack(int id)
    {
        var track = await _context.Tracks.FindAsync(id);
        if (track == null || string.IsNullOrEmpty(track.FilePath)) return NotFound();

        var fullPath = Path.Combine(_basePath, track.FilePath);
        if (!System.IO.File.Exists(fullPath)) return NotFound();

        var mimeType = track.FilePath.EndsWith(".flac", StringComparison.OrdinalIgnoreCase) ? "audio/flac" : "audio/mpeg";
        
        // 🔥 THE iOS PWA FIX: Explicitly allow the browser to pipe this into Web Audio
        Response.Headers.Append("Access-Control-Allow-Origin", "*"); 
        Response.Headers.Append("Access-Control-Allow-Methods", "GET, OPTIONS");
        Response.Headers.Append("Access-Control-Allow-Headers", "Range, Authorization, Content-Type");
        
        // 🔥 CRITICAL: Let iOS see the Range headers, otherwise it stays at 0:00
        Response.Headers.Append("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

        return PhysicalFile(fullPath, mimeType, enableRangeProcessing: true);
    }

    [HttpGet("image")]
    public IActionResult GetImage([FromQuery] string path)
    {
        if (string.IsNullOrEmpty(path)) return NotFound();
        
        var fullPath = Path.Combine(_basePath, path);
        if (!System.IO.File.Exists(fullPath)) return NotFound();
        
        return PhysicalFile(fullPath, "image/jpeg");
    }

    public class LyricLine
    {
        public double t { get; set; }
        public string text { get; set; } = string.Empty;
    }

    [HttpGet("lyrics/{id}")]
    public async Task<IActionResult> GetLyrics(int id)
    {
        var track = await _context.Tracks
            .Include(t => t.Album)
                .ThenInclude(a => a.Artist)
            .FirstOrDefaultAsync(t => t.Id == id); 

        if (track == null || string.IsNullOrEmpty(track.FilePath)) return NotFound();

        var relativeAudioDir = Path.GetDirectoryName(track.FilePath) ?? "";
        var fileNameWithoutExt = Path.GetFileNameWithoutExtension(track.FilePath);
        
        var lrcDir = Path.Combine(_basePath, "lrc", relativeAudioDir);
        var lyricPath = Path.Combine(lrcDir, $"{fileNameWithoutExt}.lrc");

        if (!System.IO.File.Exists(lyricPath))
        {
            await _lyricsDownloader.DownloadLyricsForTrackAsync(track);
        }

        if (!System.IO.File.Exists(lyricPath))
        {
            return Ok(new List<LyricLine>()); 
        }

        var lines = await System.IO.File.ReadAllLinesAsync(lyricPath);
        var parsedLyrics = new List<LyricLine>();
        bool isSynced = false;

        var timeRegex = new System.Text.RegularExpressions.Regex(@"\[(\d+):(\d+(?:\.\d+)?)\]");

        foreach (var line in lines)
        {
            var matches = timeRegex.Matches(line);
            if (matches.Count > 0)
            {
                var cleanText = timeRegex.Replace(line, "").Trim();

                foreach (System.Text.RegularExpressions.Match match in matches)
                {
                    try
                    {
                        double minutes = double.Parse(match.Groups[1].Value);
                        double seconds = double.Parse(match.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture); 
                        
                        parsedLyrics.Add(new LyricLine { 
                            t = (minutes * 60) + seconds, 
                            text = cleanText 
                        });
                        isSynced = true;
                    }
                    catch { continue; }
                }
            }
        }

        if (isSynced)
        {
            parsedLyrics = parsedLyrics.OrderBy(l => l.t).ToList();
        }
        else if (lines.Length > 0)
        {
            parsedLyrics.Add(new LyricLine { t = 0, text = "◆ LYRICS SYNC NOT AVAILABLE ◆" });
            foreach (var line in lines)
            {
                if (!string.IsNullOrWhiteSpace(line))
                {
                    parsedLyrics.Add(new LyricLine { t = 9999, text = line.Trim() });
                }
            }
        }

        return Ok(parsedLyrics);
    }

    [HttpGet("radio/{seedTrackId}")]
    public async Task<IActionResult> GetRadioMix(int seedTrackId, [FromQuery] int limit = 10, [FromQuery] string excludeIds = "")
    {
        var excludeList = new HashSet<int> { seedTrackId };
        
        if (!string.IsNullOrEmpty(excludeIds))
        {
            var parsedIds = excludeIds.Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(id => int.TryParse(id, out var parsed) ? parsed : -1)
                .Where(id => id != -1);
            
            foreach (var id in parsedIds)
            {
                excludeList.Add(id);
            }
        }

        var seedTrack = await _context.Tracks
            .Include(t => t.Album)
            .FirstOrDefaultAsync(t => t.Id == seedTrackId);

        if (seedTrack == null) return NotFound();

        int seedArtistId = seedTrack.Album.ArtistId;

        var artistTracks = await _context.Tracks
            .Include(t => t.Album).ThenInclude(a => a.Artist)
            .Where(t => t.Album.ArtistId == seedArtistId && !excludeList.Contains(t.Id))
            .OrderBy(t => EF.Functions.Random())
            .Take(limit / 2)
            .ToListAsync();

        foreach(var t in artistTracks)
        {
            excludeList.Add(t.Id);
        }

        var favoriteTracks = await _context.Tracks
            .Include(t => t.Album).ThenInclude(a => a.Artist)
            .Where(t => t.Album.ArtistId != seedArtistId && !excludeList.Contains(t.Id))
            .OrderByDescending(t => t.PlayCount)
            .Take(50)
            .OrderBy(t => EF.Functions.Random())
            .Take(limit / 3)
            .ToListAsync();

        foreach(var t in favoriteTracks)
        {
            excludeList.Add(t.Id);
        }

        var randomTracks = await _context.Tracks
            .Include(t => t.Album).ThenInclude(a => a.Artist)
            .Where(t => t.Album.ArtistId != seedArtistId && !excludeList.Contains(t.Id))
            .OrderBy(t => EF.Functions.Random())
            .Take(limit - artistTracks.Count - favoriteTracks.Count)
            .ToListAsync();

        var finalMix = artistTracks.Concat(favoriteTracks).Concat(randomTracks)
            .OrderBy(t => Guid.NewGuid())
            .Select(t => new {
                id = t.Id,
                title = t.Title,
                filePath = t.FilePath,
                durationSeconds = t.DurationSeconds,
                trackNumber = t.TrackNumber,
                bitrate = t.Bitrate,
                playCount = t.PlayCount,
                albumId = t.AlbumId,
                album = new {
                    id = t.Album.Id,
                    title = t.Album.Title,
                    coverPath = t.Album.CoverPath,
                    artist = new {
                        id = t.Album.Artist.Id,
                        name = t.Album.Artist.Name
                    }
                }
            }).ToList();

        return Ok(finalMix);
    }

    [HttpPost("{id}/play")]
    public async Task<IActionResult> RecordPlay(int id)
    {
        var track = await _context.Tracks
            .Include(t => t.Album)
            .FirstOrDefaultAsync(t => t.Id == id);

        if (track == null) return NotFound();

        // Increment track plays
        track.PlayCount++;

        // Increment album plays
        if (track.Album != null)
        {
            track.Album.PlayCount++;
        }

        await _context.SaveChangesAsync();
        return Ok(new { trackPlays = track.PlayCount, albumPlays = track.Album.PlayCount });
    }
}