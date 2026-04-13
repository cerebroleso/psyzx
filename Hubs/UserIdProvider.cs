using Microsoft.AspNetCore.SignalR;
using System.Security.Claims;

namespace psyzx.Hubs;

/// <summary>
/// Maps the authenticated cookie user to a stable SignalR group key.
/// Falls back to Identity.Name if NameIdentifier is absent.
/// </summary>
public class UserIdProvider : IUserIdProvider
{
    public string? GetUserId(HubConnectionContext connection)
        => connection.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? connection.User?.Identity?.Name;
}