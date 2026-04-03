namespace psyzx.Controllers;

using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Models;
using psyzx.Services; // Aggiunto per poter usare LyricsDownloader
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

    // Iniettiamo il LyricsDownloader direttamente nel controller
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
            .Include(t => t.Album)
            .ThenInclude(a => a.Artist)
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
}