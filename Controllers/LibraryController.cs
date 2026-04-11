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

        return Ok("Scan completed");
    }
}