namespace psyzx.Models;

public class Playlist
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    
    // Chiave esterna per sapere di chi è questa playlist
    public int UserId { get; set; }
    public User User { get; set; } = null!;

    // Relazione con le tracce
    public List<PlaylistTrack> PlaylistTracks { get; set; } = new();
}