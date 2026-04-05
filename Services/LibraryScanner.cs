namespace psyzx.Services;

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using psyzx.Models;

public class LibraryScanner
{
    private readonly AppDbContext _context;
    private readonly string _basePath;
    private readonly HttpClient _httpClient;

    public LibraryScanner(AppDbContext context, IConfiguration config, HttpClient httpClient)
    {
        _context = context;
        _basePath = config["MusicSettings:BasePath"] ?? "";
        _httpClient = httpClient;
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "psyzx/1.0");
    }

    public async Task ScanAsync()
    {
        if (string.IsNullOrWhiteSpace(_basePath) || !Directory.Exists(_basePath)) return;

        var dbArtists = await _context.Artists
            .Include(a => a.Albums)
            .ThenInclude(a => a.Tracks)
            .ToListAsync();

        foreach (var dbArtist in dbArtists)
        {
            var artistPath = Path.Combine(_basePath, dbArtist.Name.Trim());

            if (!Directory.Exists(artistPath))
            {
                foreach (var album in dbArtist.Albums.ToList())
                {
                    _context.Tracks.RemoveRange(album.Tracks);
                }
                _context.Albums.RemoveRange(dbArtist.Albums);
                _context.Artists.Remove(dbArtist);
                continue;
            }

            foreach (var album in dbArtist.Albums.ToList())
            {
                var albumPath = Path.Combine(artistPath, album.Title.Trim());

                if (!Directory.Exists(albumPath))
                {
                    _context.Tracks.RemoveRange(album.Tracks);
                    _context.Albums.Remove(album);
                }
                else
                {
                    foreach (var track in album.Tracks.ToList())
                    {
                        var trackPath = Path.Combine(_basePath, track.FilePath);
                        if (!File.Exists(trackPath))
                        {
                            _context.Tracks.Remove(track);
                        }
                    }
                }
            }
        }

        await _context.SaveChangesAsync();

        var artistDirs = Directory.GetDirectories(_basePath);

        foreach (var artistDir in artistDirs)
        {
            var artistName = Path.GetFileName(artistDir).Trim();
            var artist = await _context.Artists.FirstOrDefaultAsync(a => a.Name == artistName);

            if (artist == null)
            {
                artist = new Artist { Name = artistName };
                var artistImagePath = Path.Combine(artistDir, "artist.jpg");

                if (!File.Exists(artistImagePath))
                {
                    try
                    {
                        var response = await _httpClient.GetAsync($"https://api.deezer.com/search/artist?q={Uri.EscapeDataString(artistName)}");
                        if (response.IsSuccessStatusCode)
                        {
                            var json = await response.Content.ReadAsStringAsync();
                            using var doc = JsonDocument.Parse(json);
                            if (doc.RootElement.TryGetProperty("data", out var dataElement) && dataElement.GetArrayLength() > 0)
                            {
                                string pictureUrl = string.Empty;
                                foreach (var item in dataElement.EnumerateArray())
                                {
                                    if (item.TryGetProperty("name", out var nameElement))
                                    {
                                        if (string.Equals(nameElement.GetString(), artistName, StringComparison.OrdinalIgnoreCase))
                                        {
                                            pictureUrl = item.GetProperty("picture_xl").GetString() ?? "";
                                            break;
                                        }
                                    }
                                }

                                if (string.IsNullOrEmpty(pictureUrl))
                                    pictureUrl = dataElement[0].GetProperty("picture_xl").GetString() ?? "";

                                if (!string.IsNullOrWhiteSpace(pictureUrl))
                                {
                                    var imageBytes = await _httpClient.GetByteArrayAsync(pictureUrl);
                                    await File.WriteAllBytesAsync(artistImagePath, imageBytes);
                                }
                            }
                        }
                    }
                    catch { }
                }

                if (File.Exists(artistImagePath))
                {
                    artist.ImagePath = Path.GetRelativePath(_basePath, artistImagePath);
                }

                _context.Artists.Add(artist);
                await _context.SaveChangesAsync();
            }

            var albumDirs = Directory.GetDirectories(artistDir);

            foreach (var albumDir in albumDirs)
            {
                var albumName = Path.GetFileName(albumDir).Trim();
                var album = await _context.Albums.FirstOrDefaultAsync(a => a.Title == albumName && a.ArtistId == artist.Id);

                if (album == null)
                {
                    int releaseYear = DateTime.Now.Year;
                    var firstAudio = Directory.EnumerateFiles(albumDir, "*.*", SearchOption.AllDirectories)
                        .FirstOrDefault(f => f.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".flac", StringComparison.OrdinalIgnoreCase));

                    if (firstAudio != null)
                    {
                        try
                        {
                            var tfile = TagLib.File.Create(firstAudio);
                            if (tfile.Tag.Year > 0) releaseYear = (int)tfile.Tag.Year;
                        }
                        catch { }
                    }

                    album = new Album { Title = albumName, ArtistId = artist.Id, ReleaseYear = releaseYear, PlayCount = 0 };
                    var coverPath = Path.Combine(albumDir, "cover.jpg");

                    if (!File.Exists(coverPath))
                    {
                        var imageFiles = Directory.GetFiles(albumDir).Where(f => f.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".png", StringComparison.OrdinalIgnoreCase)).ToArray();
                        var folderImage = imageFiles.FirstOrDefault(f => f.Contains("cover", StringComparison.OrdinalIgnoreCase) || f.Contains("folder", StringComparison.OrdinalIgnoreCase)) ?? imageFiles.FirstOrDefault();

                        if (folderImage != null)
                        {
                            File.Copy(folderImage, coverPath, true);
                        }
                        else if (firstAudio != null)
                        {
                            try
                            {
                                var tfile = TagLib.File.Create(firstAudio);
                                if (tfile.Tag.Pictures.Length > 0)
                                {
                                    var pic = tfile.Tag.Pictures[0];
                                    await File.WriteAllBytesAsync(coverPath, pic.Data.Data);
                                }
                            }
                            catch { }
                        }
                    }

                    if (File.Exists(coverPath)) album.CoverPath = Path.GetRelativePath(_basePath, coverPath);

                    _context.Albums.Add(album);
                    await _context.SaveChangesAsync();
                }

                var cdDirectories = Directory.GetDirectories(albumDir)
                    .Where(d => 
                    {
                        var name = Path.GetFileName(d).ToLower();
                        return name.StartsWith("cd") || name.StartsWith("disc");
                    }).ToList();

                if (cdDirectories.Any())
                {
                    foreach (var cdDir in cdDirectories)
                    {
                        var dirName = Path.GetFileName(cdDir);
                        var numberString = new string(dirName.Where(char.IsDigit).ToArray());
                        int discNumber = 1;
                        if (!string.IsNullOrEmpty(numberString)) int.TryParse(numberString, out discNumber);

                        await ProcessAudioFilesAsync(cdDir, album.Id, discNumber);
                    }
                }
                else
                {
                    await ProcessAudioFilesAsync(albumDir, album.Id, 1);
                }

                await _context.SaveChangesAsync();
            }
        }
    }

    private async Task ProcessAudioFilesAsync(string directoryPath, int albumId, int discNumber)
    {
        var files = Directory.GetFiles(directoryPath)
            .Where(f => f.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".flac", StringComparison.OrdinalIgnoreCase));

        foreach (var file in files)
        {
            var relativePath = Path.GetRelativePath(_basePath, file);
            var trackExists = await _context.Tracks.AnyAsync(t => t.FilePath == relativePath);

            if (!trackExists)
            {
                int duration = 0;
                int trackNum = 0;
                int bitrate = 0;

                try
                {
                    var tfile = TagLib.File.Create(file);
                    duration = (int)tfile.Properties.Duration.TotalSeconds;
                    trackNum = (int)tfile.Tag.Track;
                    bitrate = tfile.Properties.AudioBitrate;
                    if (tfile.Tag.Disc > 0) discNumber = (int)tfile.Tag.Disc;
                }
                catch { }

                var track = new Track
                {
                    Title = Path.GetFileNameWithoutExtension(file),
                    FilePath = relativePath,
                    AlbumId = albumId,
                    DurationSeconds = duration,
                    TrackNumber = trackNum,
                    Bitrate = bitrate,
                    DiscNumber = discNumber
                };
                _context.Tracks.Add(track);
            }
        }
    }
}