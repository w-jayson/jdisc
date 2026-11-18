using System.Security.Claims;
using Jdisc.Application.Abstractions;
using Jdisc.Application.Rooms;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Jdisc.Presentation.Hubs;

public sealed record LocalAudioStateReport(string RoomId, bool IsMuted, bool IsDeafened);

[Authorize]
public sealed class PresenceHub(GetRoomsHandler getRoomsHandler) : Hub
{
    public override async Task OnConnectedAsync()
    {
        // SignalR ONLY reads from Redis on initial connect; NEVER writes/removes media presence in Redis
        var snapshot = await getRoomsHandler.HandleAsync(Context.ConnectionAborted);
        await Clients.Caller.SendAsync("RoomsSnapshotUpdated", snapshot, Context.ConnectionAborted);
        await base.OnConnectedAsync();
    }

    public async Task ReportLocalAudioState(LocalAudioStateReport report)
    {
        var userId = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) ??
                     Context.User?.FindFirstValue("sub");

        if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(report.RoomId))
            return;

        // UI-only signaling broadcast (Constitution Principle I & III)
        await Clients.All.SendAsync(
            "ParticipantAudioStateChanged",
            new
            {
                roomId = report.RoomId.Trim().ToLowerInvariant(),
                userId,
                isMuted = report.IsMuted || report.IsDeafened,
                isDeafened = report.IsDeafened
            },
            Context.ConnectionAborted);
    }
}

public sealed class SignalRPresenceNotifier(IHubContext<PresenceHub> hubContext) : IPresenceNotifier
{
    public Task BroadcastRoomsSnapshotAsync(
        IReadOnlyList<RoomPresenceSnapshotDto> rooms,
        CancellationToken ct = default)
    {
        return hubContext.Clients.All.SendAsync("RoomsSnapshotUpdated", rooms, ct);
    }
}
