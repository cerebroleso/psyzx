using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using psyzx.Data;
using Microsoft.AspNetCore.Authorization;

namespace psyzx.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class SearchController : ControllerBase
{
    private readonly AppDbContext _context;

    public SearchController(AppDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<IActionResult> FastSearch([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q))
        {
            return Ok(new { artists = new object[0], albums = new object[0], tracks = new object[0] });
        }

        // Clean the input and append wildcard '*' to each word.
        // E.g. "upb synth" becomes "upb* synth*" matching "upbeat synthwave"
        var terms = q.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var formattedQuery = string.Join(" ", terms.Select(t => t + "*"));

        // 1. Search Artists
        var artists = await _context.Artists
            .FromSqlRaw("SELECT * FROM Artists WHERE MATCH(Name) AGAINST({0} IN BOOLEAN MODE)", formattedQuery)
            .Take(10)
            .ToListAsync();

        // 2. Search Albums
        var albums = await _context.Albums
            .FromSqlRaw("SELECT * FROM Albums WHERE MATCH(Title) AGAINST({0} IN BOOLEAN MODE)", formattedQuery)
            .Include(a => a.Artist)
            .Take(10)
            .ToListAsync();

        // 3. Search Tracks (checks both Title and the new SearchTags column)
        var tracks = await _context.Tracks
            .FromSqlRaw("SELECT * FROM Tracks WHERE MATCH(Title, SearchTags) AGAINST({0} IN BOOLEAN MODE)", formattedQuery)
            .Include(t => t.Album)
                .ThenInclude(a => a.Artist)
            .Take(20)
            .ToListAsync();

        // Format the output to match exactly what your Svelte UI expects
        return Ok(new {
            artists = artists.Select(a => new { a.Id, a.Name, a.ImagePath }),
            albums = albums.Select(a => new { 
                a.Id, 
                a.Title, 
                a.CoverPath, 
                artistName = a.Artist.Name 
            }),
            tracks = tracks.Select(t => new {
                id = t.Id,
                title = t.Title,
                album = new {
                    id = t.Album.Id,
                    title = t.Album.Title,
                    coverPath = t.Album.CoverPath,
                    artist = new { id = t.Album.Artist.Id, name = t.Album.Artist.Name }
                }
            })
        });
    }
}