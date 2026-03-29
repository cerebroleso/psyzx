namespace psyzx.Controllers;

using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using psyzx.Data;
using psyzx.Models;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class TracksController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly string _basePath;
    private readonly ILogger<TracksController> _logger;

    public TracksController(AppDbContext context, IConfiguration config, ILogger<TracksController> logger)
    {
        _context = context;
        _basePath = config["MusicSettings:BasePath"] ?? "";
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<Track>>> GetTracks()
    {
        return await _context.Tracks
            .Include(t => t.Album)
            .ThenInclude(a => a.Artist)
            .ToListAsync();
    }

    [HttpGet("stream/{id}")]
    public async Task<IActionResult> StreamTrack(int id)
    {
        var track = await _context.Tracks.Include(t => t.Album).FirstOrDefaultAsync(t => t.Id == id);
        if (track == null) return NotFound();

        var rangeHeader = Request.Headers.Range.ToString();
        var clientIp = Request.Headers["CF-Connecting-IP"].FirstOrDefault() ?? Request.HttpContext.Connection.RemoteIpAddress?.ToString();
        
        _logger.LogInformation($"\u001b[35m[SYSTEM]\u001b[0m {DateTime.Now:G} | 📱 IP: {clientIp} | 🎵 TRACK: {track.Title} | 💽 RANGE: {(!string.IsNullOrEmpty(rangeHeader) ? rangeHeader : "FULL")}");

        if (string.IsNullOrEmpty(rangeHeader) || rangeHeader.StartsWith("bytes=0-"))
        {
            track.PlayCount++;
            if (track.Album != null) track.Album.PlayCount++;
            await _context.SaveChangesAsync();
        }

        var fullPath = Path.Combine(_basePath, track.FilePath);
        if (!System.IO.File.Exists(fullPath)) return NotFound();

        var contentType = fullPath.EndsWith(".flac", StringComparison.OrdinalIgnoreCase) ? "audio/flac" : "audio/mpeg";
        return PhysicalFile(fullPath, contentType, enableRangeProcessing: true);
    }

    [AllowAnonymous]
    [HttpGet("image")]
    public IActionResult GetImage([FromQuery] string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return NotFound();
        var fullPath = Path.Combine(_basePath, path);
        if (!System.IO.File.Exists(fullPath)) return NotFound();
        return PhysicalFile(fullPath, "image/jpeg");
    }
}