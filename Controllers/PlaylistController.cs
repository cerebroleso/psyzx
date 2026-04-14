using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Models;
using System.Security.Claims;
using System.Linq;

namespace psyzx.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class PlaylistsController : ControllerBase
{
    private readonly AppDbContext _db;

    public PlaylistsController(AppDbContext db)
    {
        _db = db;
    }

    private int GetCurrentUserId()
    {
        var idClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.Parse(idClaim ?? "0");
    }

    [HttpGet]
    public async Task<IActionResult> GetMyPlaylists()
    {
        var userId = GetCurrentUserId();

        var playlistData = await _db.Playlists
            .AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => new {
                id = p.Id,
                name = p.Name,
                trackCount = p.PlaylistTracks.Count,
                allCovers = p.PlaylistTracks.Select(pt => pt.Track.Album.CoverPath)
            })
            .ToListAsync();

        var result = playlistData.Select(p => new {
            id = p.id,
            name = p.name,
            trackCount = p.trackCount,
            covers = p.allCovers
                .Where(c => !string.IsNullOrEmpty(c))
                .Distinct()
                .Take(4)
                .ToList()
        });

        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreatePlaylist([FromBody] CreatePlaylistDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest();

        var userId = GetCurrentUserId();
        var playlist = new Playlist 
        { 
            Name = dto.Name.Trim(), 
            UserId = userId 
        };

        _db.Playlists.Add(playlist);
        await _db.SaveChangesAsync();

        return Ok(new { id = playlist.Id, name = playlist.Name, trackCount = 0, covers = new List<string>() });
    }

    [HttpPost("{id}/tracks")]
    public async Task<IActionResult> AddTrack(int id, [FromBody] AddTrackDto dto)
    {
        var userId = GetCurrentUserId();
        
        var playlist = await _db.Playlists.FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId);
        if (playlist == null) return NotFound();

        var trackExists = await _db.Tracks.AnyAsync(t => t.Id == dto.TrackId);
        if (!trackExists) return NotFound();

        // --- ADD THIS CHECK ---
        var alreadyExists = await _db.PlaylistTracks
            .AnyAsync(pt => pt.PlaylistId == id && pt.TrackId == dto.TrackId);

        if (alreadyExists) 
        {
            // It's already in the playlist, so we just return success.
            return Ok(); 
        }
        // ----------------------

        var playlistTrack = new PlaylistTrack
        {
            PlaylistId = id,
            TrackId = dto.TrackId
        };

        _db.PlaylistTracks.Add(playlistTrack);
        await _db.SaveChangesAsync();

        return Ok();
    }

    [HttpDelete("{id}/tracks")]
    public async Task<IActionResult> RemoveTrack(int id, [FromBody] AddTrackDto dto)
    {
        var userId = GetCurrentUserId();
        
        // Ensure the playlist belongs to the user
        var playlist = await _db.Playlists.FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId);
        if (playlist == null) return NotFound();

        // Find the link between the playlist and the track
        var playlistTrack = await _db.PlaylistTracks
            .FirstOrDefaultAsync(pt => pt.PlaylistId == id && pt.TrackId == dto.TrackId);

        // If it exists, delete it
        if (playlistTrack != null)
        {
            _db.PlaylistTracks.Remove(playlistTrack);
            await _db.SaveChangesAsync();
        }
        return Ok();
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetPlaylist(int id)
    {
        var userId = GetCurrentUserId();
        
        var playlist = await _db.Playlists
            .Include(p => p.PlaylistTracks)
                .ThenInclude(pt => pt.Track)
                    .ThenInclude(t => t.Album)
                        .ThenInclude(a => a.Artist)
            .FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId);

        if (playlist == null) return NotFound();

        var result = new
        {
            id = playlist.Id,
            name = playlist.Name,
            tracks = playlist.PlaylistTracks.OrderBy(pt => pt.AddedAt).Select(pt => new
            {
                id = pt.Track.Id,
                title = pt.Track.Title,
                durationSeconds = pt.Track.DurationSeconds,
                trackNumber = pt.Track.TrackNumber,
                filePath = pt.Track.FilePath,
                bitrate = pt.Track.Bitrate,
                playCount = pt.Track.PlayCount,
                album = new
                {
                    id = pt.Track.Album.Id,
                    title = pt.Track.Album.Title,
                    coverPath = pt.Track.Album.CoverPath,
                    artist = new
                    {
                        id = pt.Track.Album.Artist.Id,
                        name = pt.Track.Album.Artist.Name
                    }
                }
            })
        };

        return Ok(result);
    }

    [HttpPost("add-by-name")]
    public async Task<IActionResult> AddTrackByName([FromBody] AddTrackByNameDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.PlaylistName)) 
            return BadRequest("Playlist name cannot be empty.");

        var userId = GetCurrentUserId();

        // 1. Ensure the track actually exists
        var trackExists = await _db.Tracks.AnyAsync(t => t.Id == dto.TrackId);
        if (!trackExists) return NotFound("Track not found.");

        // 2. Find the playlist by name (Case-Insensitive) for this specific user
        var playlist = await _db.Playlists
            .FirstOrDefaultAsync(p => 
                p.Name.ToLower() == dto.PlaylistName.Trim().ToLower() && 
                p.UserId == userId);

        // 3. If playlist doesn't exist, create it (Find or Create logic)
        if (playlist == null)
        {
            playlist = new Playlist 
            { 
                Name = dto.PlaylistName.Trim(), 
                UserId = userId 
            };
            _db.Playlists.Add(playlist);
            // We save here to ensure the playlist has an ID before adding the track
            await _db.SaveChangesAsync();
        }

        // 4. Check if the track is already in this playlist
        var alreadyExists = await _db.PlaylistTracks
            .AnyAsync(pt => pt.PlaylistId == playlist.Id && pt.TrackId == dto.TrackId);

        if (!alreadyExists)
        {
            var playlistTrack = new PlaylistTrack
            {
                PlaylistId = playlist.Id,
                TrackId = dto.TrackId
            };

            _db.PlaylistTracks.Add(playlistTrack);
            await _db.SaveChangesAsync();
        }

        return Ok(new { 
            playlistId = playlist.Id, 
            playlistName = playlist.Name,
            message = "Track added successfully" 
        });
    }

    [HttpDelete("remove-by-name")]
    public async Task<IActionResult> RemoveTrackByName([FromBody] AddTrackByNameDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.PlaylistName)) 
            return BadRequest("Playlist name cannot be empty.");

        var userId = GetCurrentUserId();

        // 1. Find the playlist by name for this user
        var playlist = await _db.Playlists
            .FirstOrDefaultAsync(p => 
                p.Name.ToLower() == dto.PlaylistName.Trim().ToLower() && 
                p.UserId == userId);

        if (playlist == null) return NotFound("Playlist not found.");

        // 2. Find the link between the playlist and the track
        var playlistTrack = await _db.PlaylistTracks
            .FirstOrDefaultAsync(pt => pt.PlaylistId == playlist.Id && pt.TrackId == dto.TrackId);

        // 3. Delete if it exists
        if (playlistTrack != null)
        {
            _db.PlaylistTracks.Remove(playlistTrack);
            await _db.SaveChangesAsync();
        }

        return Ok(new { message = "Track removed from playlist" });
    }
}

public class CreatePlaylistDto 
{ 
    public string Name { get; set; } = string.Empty; 
}

public class AddTrackDto 
{ 
    public int TrackId { get; set; } 
}

public class AddTrackByNameDto 
{ 
    public int TrackId { get; set; } 
    public string PlaylistName { get; set; } = string.Empty;
}