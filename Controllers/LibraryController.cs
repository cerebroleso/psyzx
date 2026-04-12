using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Models;

namespace psyzx.Controllers;

[ApiController]
[Route("api/[controller]")]
public class LibraryController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly string _basePath;
    private readonly string _coversPath;

    public LibraryController(AppDbContext context, IConfiguration config)
    {
        _context = context;
        _basePath = Path.GetFullPath(config["MusicSettings:BasePath"] ?? "");
        _coversPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "covers");
    }

    [HttpGet("artists/stats")]
    public async Task<IActionResult> GetArtistStats()
    {
        var stats = await _context.Artists
            .Select(a => new
            {
                id = a.Id,
                albumCount = a.Albums.Count(),
                trackCount = a.Albums.SelectMany(al => al.Tracks).Count(),
                // 🔥 NEW: Sums up the total plays across all tracks for this artist
                playCount = a.Albums.SelectMany(al => al.Tracks).Sum(t => t.PlayCount)
            })
            .ToListAsync();
            
        return Ok(stats);
    }

    [HttpPost("scan")]
    public async Task<IActionResult> ScanLibrary()
    {
        if (string.IsNullOrWhiteSpace(_basePath) || !Directory.Exists(_basePath))
        {
            return BadRequest("Invalid base path.");
        }

        if (!Directory.Exists(_coversPath))
        {
            Directory.CreateDirectory(_coversPath);
        }

        var artistDirs = Directory.GetDirectories(_basePath);

        foreach (var artistDir in artistDirs)
        {
            var artistName = Path.GetFileName(artistDir);
            var artist = await _context.Artists.FirstOrDefaultAsync(a => a.Name == artistName);

            if (artist == null)
            {
                artist = new Artist { Name = artistName };
                _context.Artists.Add(artist);
                await _context.SaveChangesAsync();
            }

            var albumDirs = Directory.GetDirectories(artistDir);

            foreach (var albumDir in albumDirs)
            {
                var albumName = Path.GetFileName(albumDir);
                var album = await _context.Albums.FirstOrDefaultAsync(a => a.Title == albumName && a.ArtistId == artist.Id);

                if (album == null)
                {
                    album = new Album { Title = albumName, ArtistId = artist.Id, ReleaseYear = DateTime.Now.Year };
                    
                    var imageFiles = Directory.GetFiles(albumDir).Where(f => f.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".png", StringComparison.OrdinalIgnoreCase)).ToArray();
                    var folderImage = imageFiles.FirstOrDefault(f => f.Contains("cover", StringComparison.OrdinalIgnoreCase) || f.Contains("folder", StringComparison.OrdinalIgnoreCase)) ?? imageFiles.FirstOrDefault();

                    if (folderImage != null)
                    {
                        var ext = Path.GetExtension(folderImage);
                        var fileName = $"{Guid.NewGuid()}{ext}";
                        System.IO.File.Copy(folderImage, Path.Combine(_coversPath, fileName), true);
                        album.CoverPath = $"/covers/{fileName}";
                    }
                    else
                    {
                        var firstAudio = Directory.GetFiles(albumDir).FirstOrDefault(f => f.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".flac", StringComparison.OrdinalIgnoreCase));
                        if (firstAudio != null)
                        {
                            try
                            {
                                var tfile = TagLib.File.Create(firstAudio);
                                if (tfile.Tag.Pictures.Length > 0)
                                {
                                    var pic = tfile.Tag.Pictures[0];
                                    var ext = pic.MimeType == "image/png" ? ".png" : ".jpg";
                                    var fileName = $"{Guid.NewGuid()}{ext}";
                                    System.IO.File.WriteAllBytes(Path.Combine(_coversPath, fileName), pic.Data.Data);
                                    album.CoverPath = $"/covers/{fileName}";
                                }
                            }
                            catch { }
                        }
                    }

                    _context.Albums.Add(album);
                    await _context.SaveChangesAsync();
                }

                var files = Directory.GetFiles(albumDir).Where(f => f.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".flac", StringComparison.OrdinalIgnoreCase));

                foreach (var file in files)
                {
                    var relativePath = Path.GetRelativePath(_basePath, file);
                    var trackExists = await _context.Tracks.AnyAsync(t => t.FilePath == relativePath);

                    if (!trackExists)
                    {
                        var track = new Track
                        {
                            Title = Path.GetFileNameWithoutExtension(file),
                            FilePath = relativePath,
                            AlbumId = album.Id,
                            DurationSeconds = 0,
                            TrackNumber = 0
                        };
                        _context.Tracks.Add(track);
                    }
                }
                
                await _context.SaveChangesAsync();
            }
        }

        var ghostArtists = await _context.Artists
            .Where(a => !a.Albums.Any())
            .ToListAsync();

        foreach (var ghost in ghostArtists)
        {
            var ghostDir = Path.Combine(_basePath, ghost.Name);
            if (!Directory.Exists(ghostDir))
            {
                _context.Artists.Remove(ghost);
                Console.WriteLine($"[SCAN-CLEANUP] Removed ghost artist (no albums, no dir): '{ghost.Name}'");
            }
        }

        await _context.SaveChangesAsync();
        return Ok("Scan completed");
    }

    [HttpGet("duplicates")]
    public async Task<IActionResult> GetDuplicateArtists()
    {
        var artists = await _context.Artists
            .Include(a => a.Albums)
            .ToListAsync();

        var pairs = new List<object>();
        var seenPairs = new HashSet<string>();

        foreach (var source in artists)
        {
            if (!source.Albums.Any()) continue;

            foreach (var target in artists)
            {
                if (source.Id == target.Id) continue;

                if (source.Name.Contains(target.Name, StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(source.Name, target.Name, StringComparison.OrdinalIgnoreCase))
                {
                    var key = $"{Math.Min(source.Id, target.Id)}-{Math.Max(source.Id, target.Id)}";
                    if (!seenPairs.Add(key)) continue;

                    pairs.Add(new
                    {
                        sourceId   = source.Id,
                        sourceName = source.Name,
                        targetId   = target.Id,
                        targetName = target.Name,
                        albums     = source.Albums.Select(a => new { a.Id, a.Title, a.CoverPath })
                    });
                }
            }
        }

        return Ok(pairs);
    }

    [HttpGet("duplicate-albums")]
    public async Task<IActionResult> GetDuplicateAlbums()
    {
        var albums = await _context.Albums
            .Include(a => a.Artist)
            .Include(a => a.Tracks)
            .ToListAsync();

        var pairs = new List<object>();
        var seenPairs = new HashSet<string>();

        var groupedAlbums = albums.GroupBy(a => a.ArtistId);

        foreach (var group in groupedAlbums)
        {
            var artistAlbums = group.ToList();
            for (int i = 0; i < artistAlbums.Count; i++)
            {
                for (int j = i + 1; j < artistAlbums.Count; j++)
                {
                    var a1 = artistAlbums[i];
                    var a2 = artistAlbums[j];

                    if (a1.Title.Contains(a2.Title, StringComparison.OrdinalIgnoreCase) ||
                        a2.Title.Contains(a1.Title, StringComparison.OrdinalIgnoreCase))
                    {
                        var key = $"{Math.Min(a1.Id, a2.Id)}-{Math.Max(a1.Id, a2.Id)}";
                        if (!seenPairs.Add(key)) continue;

                        Album source, target;
                        if (a1.Tracks.Count < a2.Tracks.Count) { source = a1; target = a2; }
                        else if (a2.Tracks.Count < a1.Tracks.Count) { source = a2; target = a1; }
                        else 
                        {
                            if (a1.Title.Length <= a2.Title.Length) { target = a1; source = a2; }
                            else { target = a2; source = a1; }
                        }

                        pairs.Add(new
                        {
                            sourceId = source.Id,
                            sourceName = source.Title,
                            targetId = target.Id,
                            targetName = target.Title,
                            artistName = source.Artist.Name,
                            sourceTracks = source.Tracks.Count,
                            targetTracks = target.Tracks.Count,
                            coverPath = source.CoverPath ?? target.CoverPath
                        });
                    }
                }
            }
        }

        return Ok(pairs);
    }

    [HttpPost("merge-artist")]
    public async Task<IActionResult> MergeArtist([FromBody] MergeArtistRequest req)
    {
        var source = await _context.Artists
            .Include(a => a.Albums)
                .ThenInclude(al => al.Tracks)
            .FirstOrDefaultAsync(a => a.Id == req.SourceArtistId);

        var target = await _context.Artists
            .FirstOrDefaultAsync(a => a.Id == req.TargetArtistId);

        if (source == null || target == null)
            return NotFound(new { message = "One or both artists not found." });

        var sourceFolder = source.Name;
        var targetFolder = target.Name;

        var targetArtistDir = Path.Combine(_basePath, targetFolder);
        if (!Directory.Exists(targetArtistDir))
            Directory.CreateDirectory(targetArtistDir);

        var targetAlbums = await _context.Albums
            .Include(a => a.Tracks)
            .Where(a => a.ArtistId == target.Id)
            .ToListAsync();

        foreach (var album in source.Albums.ToList())
        {
            var oldAlbumDir = Path.Combine(_basePath, sourceFolder, album.Title);

            var matchingAlbum = targetAlbums.FirstOrDefault(ta =>
                ta.Title.Contains(album.Title, StringComparison.OrdinalIgnoreCase) ||
                album.Title.Contains(ta.Title, StringComparison.OrdinalIgnoreCase));

            if (matchingAlbum != null)
            {
                Console.WriteLine($"[MERGE] Album duplicate found: '{album.Title}' → '{matchingAlbum.Title}'. Absorbing tracks.");

                var canonicalAlbumDir = Path.Combine(_basePath, targetFolder, matchingAlbum.Title);

                if (Directory.Exists(oldAlbumDir))
                {
                    try
                    {
                        if (!Directory.Exists(canonicalAlbumDir))
                            Directory.CreateDirectory(canonicalAlbumDir);

                        foreach (var file in Directory.GetFiles(oldAlbumDir))
                        {
                            var dest = Path.Combine(canonicalAlbumDir, Path.GetFileName(file));
                            if (!System.IO.File.Exists(dest))
                                System.IO.File.Move(file, dest);
                        }
                        Directory.Delete(oldAlbumDir, recursive: true);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[MERGE] Failed to move files from duplicate album dir '{oldAlbumDir}': {ex.Message}");
                    }
                }

                foreach (var track in album.Tracks)
                {
                    if (!string.IsNullOrEmpty(track.FilePath))
                    {
                        track.FilePath = Path.Combine(
                            targetFolder,
                            matchingAlbum.Title,
                            Path.GetFileName(track.FilePath)
                        );
                    }
                    track.AlbumId = matchingAlbum.Id;
                }

                _context.Albums.Remove(album);
            }
            else
            {
                var newAlbumDir = Path.Combine(_basePath, targetFolder, album.Title);

                if (Directory.Exists(oldAlbumDir))
                {
                    try
                    {
                        if (!Directory.Exists(newAlbumDir))
                            Directory.Move(oldAlbumDir, newAlbumDir);
                        else
                        {
                            foreach (var file in Directory.GetFiles(oldAlbumDir))
                            {
                                var dest = Path.Combine(newAlbumDir, Path.GetFileName(file));
                                if (!System.IO.File.Exists(dest))
                                    System.IO.File.Move(file, dest);
                            }
                            Directory.Delete(oldAlbumDir, recursive: true);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[MERGE] Failed to move album dir '{oldAlbumDir}': {ex.Message}");
                    }
                }

                foreach (var track in album.Tracks)
                {
                    if (!string.IsNullOrEmpty(track.FilePath))
                    {
                        track.FilePath = track.FilePath.Replace(
                            sourceFolder + Path.DirectorySeparatorChar,
                            targetFolder + Path.DirectorySeparatorChar,
                            StringComparison.OrdinalIgnoreCase
                        );
                    }
                }

                album.ArtistId = target.Id;
            }
        }

        var sourceArtistDir = Path.Combine(_basePath, sourceFolder);
        if (Directory.Exists(sourceArtistDir))
        {
            try
            {
                if (!Directory.GetFileSystemEntries(sourceArtistDir).Any())
                    Directory.Delete(sourceArtistDir);
            }
            catch { }
        }

        _context.Artists.Remove(source);
        await _context.SaveChangesAsync();

        return Ok(new { message = $"Merged '{source.Name}' into '{target.Name}' successfully." });
    }

    [HttpPost("merge-album")]
    public async Task<IActionResult> MergeAlbum([FromBody] MergeAlbumRequest req)
    {
        var source = await _context.Albums.Include(a => a.Tracks).Include(a => a.Artist).FirstOrDefaultAsync(a => a.Id == req.SourceAlbumId);
        var target = await _context.Albums.Include(a => a.Tracks).Include(a => a.Artist).FirstOrDefaultAsync(a => a.Id == req.TargetAlbumId);

        if (source == null || target == null)
            return NotFound(new { message = "One or both albums not found." });

        if (source.ArtistId != target.ArtistId)
            return BadRequest(new { message = "Albums must belong to the same artist to merge." });

        var artistFolder = source.Artist.Name;
        var oldAlbumDir = Path.Combine(_basePath, artistFolder, source.Title);
        var canonicalAlbumDir = Path.Combine(_basePath, artistFolder, target.Title);

        if (Directory.Exists(oldAlbumDir))
        {
            try
            {
                if (!Directory.Exists(canonicalAlbumDir))
                    Directory.CreateDirectory(canonicalAlbumDir);

                foreach (var file in Directory.GetFiles(oldAlbumDir))
                {
                    var dest = Path.Combine(canonicalAlbumDir, Path.GetFileName(file));
                    if (!System.IO.File.Exists(dest))
                        System.IO.File.Move(file, dest);
                }
                Directory.Delete(oldAlbumDir, recursive: true);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[MERGE] Failed to move files from duplicate album dir '{oldAlbumDir}': {ex.Message}");
            }
        }

        foreach (var track in source.Tracks)
        {
            if (!string.IsNullOrEmpty(track.FilePath))
            {
                track.FilePath = Path.Combine(
                    artistFolder,
                    target.Title,
                    Path.GetFileName(track.FilePath)
                );
            }
            track.AlbumId = target.Id;
        }

        _context.Albums.Remove(source);
        await _context.SaveChangesAsync();

        return Ok(new { message = $"Merged '{source.Title}' into '{target.Title}' successfully." });
    }

    [HttpDelete("artist/{id}")]
    public async Task<IActionResult> DeleteArtist(int id)
    {
        var artist = await _context.Artists
            .Include(a => a.Albums)
            .ThenInclude(al => al.Tracks)
            .FirstOrDefaultAsync(a => a.Id == id);

        if (artist == null)
            return NotFound(new { message = "Artist not found." });

        var artistDir = Path.Combine(_basePath, artist.Name);
        if (Directory.Exists(artistDir))
        {
            try
            {
                Directory.Delete(artistDir, true); 
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Failed to delete physical files: {ex.Message}" });
            }
        }

        _context.Artists.Remove(artist);
        await _context.SaveChangesAsync();

        return Ok(new { message = $"Artist '{artist.Name}' and all associated files were permanently deleted." });
    }
    
    [HttpDelete("album/{id}")]
    public async Task<IActionResult> DeleteAlbum(int id)
    {
        var album = await _context.Albums
            .Include(a => a.Artist)
            .Include(a => a.Tracks)
            .FirstOrDefaultAsync(a => a.Id == id);

        if (album == null)
            return NotFound(new { message = "Album not found." });

        var albumDir = Path.Combine(_basePath, album.Artist.Name, album.Title);
        if (Directory.Exists(albumDir))
        {
            try
            {
                Directory.Delete(albumDir, true); 
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = $"Failed to delete physical files: {ex.Message}" });
            }
        }

        _context.Albums.Remove(album);
        await _context.SaveChangesAsync();

        return Ok(new { message = $"Album '{album.Title}' and all associated files were permanently deleted." });
    }
}

public class MergeArtistRequest
{
    public int SourceArtistId { get; set; }
    public int TargetArtistId { get; set; }
}

public class MergeAlbumRequest
{
    public int SourceAlbumId { get; set; }
    public int TargetAlbumId { get; set; }
}