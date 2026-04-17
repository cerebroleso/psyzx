namespace psyzx.Models;

using System;
using System.Text.Json.Serialization;

public class ListenEvent
{
    public int Id { get; set; }
    
    public int TrackId { get; set; }
    [JsonIgnore]
    public Track Track { get; set; } = null!;
    
    public int UserId { get; set; }
    [JsonIgnore]
    public User User { get; set; } = null!;
    
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    
    // Core Time-Series Analytics Data
    public int ListenDuration { get; set; } // in seconds
    public bool IsCompleted { get; set; } // Played to the very end
    public bool IsSkipped { get; set; } // Ended prematurely
    public string PlaybackContext { get; set; } = string.Empty; // e.g., "playlist", "album", "radio"
    public string ClientOS { get; set; } = string.Empty;
    public string ClientBrowser { get; set; } = string.Empty;
}
