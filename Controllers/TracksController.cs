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
        _basePath = Path.GetFullPath(config["MusicSettings:BasePath"] ?? "");
        _lyricsDownloader = lyricsDownloader;
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
    public async Task<IActionResult> StreamTrack(int id)
    {
        var track = await _context.Tracks.FindAsync(id);
        if (track == null || string.IsNullOrEmpty(track.FilePath)) return NotFound();

        var fullPath = Path.Combine(_basePath, track.FilePath);
        if (!System.IO.File.Exists(fullPath)) return NotFound();

        var mimeType = track.FilePath.EndsWith(".flac", StringComparison.OrdinalIgnoreCase) ? "audio/flac" : "audio/mpeg";
        
        Response.Headers.Append("Access-Control-Allow-Origin", "*"); 
        Response.Headers.Append("Access-Control-Allow-Methods", "GET, OPTIONS");
        Response.Headers.Append("Access-Control-Allow-Headers", "Range, Authorization, Content-Type");
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
    public async Task<IActionResult> GetRadioMix(int seedTrackId, [FromQuery] int limit = 20, [FromQuery] string excludeIds = "")
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

        // 1. SAFE NULL CHECK: Track might not be in an album.
        int? seedArtistId = seedTrack.Album?.ArtistId;
        var finalMix = new List<Track>();

        // 2. Similar Artist Tracks (40% of mix) - Only if an artist exists
        if (seedArtistId.HasValue) 
        {
            var artistTracks = await _context.Tracks
                .Include(t => t.Album).ThenInclude(a => a.Artist)
                .Where(t => t.Album != null && t.Album.ArtistId == seedArtistId.Value && !excludeList.Contains(t.Id))
                .OrderBy(t => EF.Functions.Random())
                .Take((int)(limit * 0.4))
                .ToListAsync();

            finalMix.AddRange(artistTracks);
            foreach(var t in artistTracks) excludeList.Add(t.Id);
        }

        // 3. Spotify-like "Discovery Favorites" (30% of mix)
        // Fixed: We expand the pool from 50 to 300 to stop it from endlessly repeating the same songs.
        var favoriteTracks = await _context.Tracks
            .Include(t => t.Album).ThenInclude(a => a.Artist)
            .Where(t => !excludeList.Contains(t.Id) && t.PlayCount > 0)
            .OrderByDescending(t => t.PlayCount)
            .Take(300) 
            .OrderBy(t => EF.Functions.Random())
            .Take((int)(limit * 0.3))
            .ToListAsync();

        finalMix.AddRange(favoriteTracks);
        foreach(var t in favoriteTracks) excludeList.Add(t.Id);

        // 4. True Random Filler / Deep Cuts (Remaining %)
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

        // 5. Shuffle the resulting mix to interleave the vibes, keeping null-safety intact
        var shuffledResult = finalMix
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
                // SAFE MAPPING
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

    [HttpPost("{id}/play")]
    public async Task<IActionResult> RecordPlay(int id)
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

        await _context.SaveChangesAsync();
        return Ok(new { trackPlays = track.PlayCount, albumPlays = track.Album?.PlayCount ?? 0 });
    }
}