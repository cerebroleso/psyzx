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