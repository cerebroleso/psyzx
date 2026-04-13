namespace psyzx.Models;

public class PlaybackStateDto
{
    public int? TrackId { get; set; }
    public string? TrackUrl { get; set; }
    public double CurrentTime { get; set; }
    public bool IsPlaying { get; set; }
    public long Timestamp { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    /// <summary>Set by the hub from Context.ConnectionId.</summary>
    public string? DeviceId { get; set; }
    /// <summary>Human-readable name scraped from the browser's user agent on the client.</summary>
    public string? DeviceName { get; set; }
    public string? TargetDeviceId { get; set; }
}   