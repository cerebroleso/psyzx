namespace psyzx.Models;

public class Album
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public int ReleaseYear { get; set; }
    public string CoverPath { get; set; } = string.Empty;
    public int PlayCount { get; set; }
    
    public int ArtistId { get; set; }
    public Artist Artist { get; set; } = null!;
    
    public ICollection<Track> Tracks { get; set; } = new List<Track>();
}