using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using psyzx.Models;

namespace psyzx.Hubs;

[Authorize]
public class PlaybackHub : Hub
{
    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    public override async Task OnConnectedAsync()
    {
        var userId = Context.UserIdentifier;
        if (userId is null) return;

        await Groups.AddToGroupAsync(Context.ConnectionId, userId);

        // Ask every already-connected device to send the new joiner their state
        // and to announce themselves so the new device can build its device list.
        await Clients.OthersInGroup(userId)
                     .SendAsync("StateRequested", Context.ConnectionId);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = Context.UserIdentifier;
        if (userId != null)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, userId);
            await Clients.OthersInGroup(userId)
                         .SendAsync("DeviceDisconnected", Context.ConnectionId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    // ---------------------------------------------------------------------------
    // Device registry
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Called once after connecting so other devices can display a friendly name.
    /// Also used as a reply to StateRequested so the new joiner knows who is there.
    /// </summary>
    public async Task RegisterDevice(string deviceName)
    {
        var userId = Context.UserIdentifier;
        if (userId is null) return;

        await Clients.OthersInGroup(userId)
                     .SendAsync("DeviceConnected", Context.ConnectionId, deviceName);
    }

    // ---------------------------------------------------------------------------
    // Playback state
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Broadcast the caller's current playback state to every other device
    /// in the same user group. Call this on play, pause, seek, and track change.
    /// </summary>
    public async Task BroadcastState(PlaybackStateDto state)
    {
        var userId = Context.UserIdentifier;
        if (userId is null) return;

        state.DeviceId  = Context.ConnectionId;
        state.Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        await Clients.OthersInGroup(userId)
                     .SendAsync("PlaybackStateChanged", state);
    }

    /// <summary>
    /// Unicast a state snapshot to a specific connection that requested it.
    /// Used when a new device joins and asks existing devices for their state.
    /// </summary>
    public async Task SendStateTo(string targetConnectionId, PlaybackStateDto state)
    {
        state.DeviceId  = Context.ConnectionId;
        state.Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        await Clients.Client(targetConnectionId)
                     .SendAsync("PlaybackStateChanged", state);
    }
}