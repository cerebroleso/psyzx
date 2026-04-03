namespace psyzx.Models;

public class PlaylistTrack
{
    public int Id { get; set; } // ID univoco per permettere duplicati (es. stessa canzone 2 volte)
    
    public int PlaylistId { get; set; }
    public Playlist Playlist { get; set; } = null!;
    
    public int TrackId { get; set; }
    public Track Track { get; set; } = null!;
    
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}