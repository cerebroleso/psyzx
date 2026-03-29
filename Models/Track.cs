namespace psyzx.Models;

public class Track
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public int DurationSeconds { get; set; }
    public int TrackNumber { get; set; }
    public string FilePath { get; set; } = string.Empty;
    public int Bitrate { get; set; }
    public int PlayCount { get; set; }
    
    public int AlbumId { get; set; }
    public Album Album { get; set; } = null!;

    public int DiscNumber { get; set; } = 1;
}