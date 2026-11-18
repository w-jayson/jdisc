using Jdisc.Application.Abstractions;
using Jdisc.Application.Rooms;
using Jdisc.Domain.Models;

namespace Jdisc.Application.Webhooks;

public sealed record LiveKitWebhookPayload(
    string Event,
    LiveKitWebhookRoom? Room,
    LiveKitWebhookParticipant? Participant,
    LiveKitWebhookTrack? Track
);

public sealed record LiveKitWebhookRoom(string Name);

public sealed record LiveKitWebhookParticipant(
    string Identity,
    string? Name,
    string? Metadata
);

public sealed record LiveKitWebhookTrack(
    string? Sid,
    string? Type,
    string? Source,
    bool? Muted
);

public sealed class NormalizeLiveKitWebhookHandler(
    IVoiceRoomRepository roomRepository,
    IRoomPresenceStore presenceStore,
    IPresenceNotifier presenceNotifier,
    GetRoomsHandler getRoomsHandler)
{
    public async Task<bool> HandleAsync(LiveKitWebhookPayload payload, CancellationToken ct = default)
    {
        var roomId = payload.Room?.Name?.Trim().ToLowerInvariant();
        var identity = payload.Participant?.Identity?.Trim();

        if (string.IsNullOrWhiteSpace(roomId) || string.IsNullOrWhiteSpace(identity))
        {
            return false;
        }

        var isCompanion = CompanionIdentity.TryExtractParentUserId(
            identity,
            payload.Participant?.Metadata,
            out var parentUserId);

        var eventName = payload.Event?.Trim().ToLowerInvariant() ?? string.Empty;

        if (isCompanion)
        {
            await HandleCompanionEventAsync(eventName, roomId, identity, parentUserId, payload.Track, ct);
        }
        else
        {
            await HandlePrimaryParticipantEventAsync(eventName, roomId, identity, payload.Participant?.Name, payload.Track, ct);
        }

        var snapshot = await getRoomsHandler.HandleAsync(ct);
        await presenceNotifier.BroadcastRoomsSnapshotAsync(snapshot, ct);
        return true;
    }

    private async Task HandleCompanionEventAsync(
        string eventName,
        string roomId,
        string companionIdentity,
        string parentUserId,
        LiveKitWebhookTrack? track,
        CancellationToken ct)
    {
        // Companion identity ({userId}:screenshare) NEVER creates a new participant entry in Redis
        var existing = await presenceStore.GetParticipantAsync(roomId, parentUserId, ct);
        if (existing is null)
        {
            return;
        }

        var trackSource = track?.Source?.Trim().ToUpperInvariant() ?? string.Empty;
        var isAudioTrack = trackSource.Contains("AUDIO", StringComparison.Ordinal) ||
                           string.Equals(track?.Type, "AUDIO", StringComparison.OrdinalIgnoreCase);

        switch (eventName)
        {
            case "participant_joined":
                // Do not increment room count or overwrite parent until track is published
                break;

            case "track_published":
                var updatedPublish = existing with
                {
                    IsScreenSharing = true,
                    ScreenShareIdentity = companionIdentity,
                    ScreenShareHasAudio = existing.ScreenShareHasAudio || isAudioTrack
                };
                await presenceStore.UpsertParticipantAsync(roomId, updatedPublish, ct);
                break;

            case "track_unpublished":
                if (isAudioTrack)
                {
                    await presenceStore.UpsertParticipantAsync(
                        roomId,
                        existing with { ScreenShareHasAudio = false },
                        ct);
                }
                else
                {
                    await presenceStore.UpsertParticipantAsync(
                        roomId,
                        existing with
                        {
                            IsScreenSharing = false,
                            ScreenShareIdentity = null,
                            ScreenShareHasAudio = false
                        },
                        ct);
                }
                break;

            case "participant_left":
                await presenceStore.UpsertParticipantAsync(
                    roomId,
                    existing with
                    {
                        IsScreenSharing = false,
                        ScreenShareIdentity = null,
                        ScreenShareHasAudio = false
                    },
                    ct);
                break;
        }
    }

    private async Task HandlePrimaryParticipantEventAsync(
        string eventName,
        string roomId,
        string userId,
        string? displayName,
        LiveKitWebhookTrack? track,
        CancellationToken ct)
    {
        switch (eventName)
        {
            case "participant_joined":
                var allRooms = await roomRepository.GetAllOrderedAsync(ct);
                var otherRoomIds = allRooms
                    .Select(r => r.Id)
                    .Where(id => !string.Equals(id, roomId, StringComparison.OrdinalIgnoreCase));
                await presenceStore.RemoveParticipantFromAllRoomsAsync(otherRoomIds, userId, ct);

                var current = await presenceStore.GetParticipantAsync(roomId, userId, ct);
                var resolvedName = string.IsNullOrWhiteSpace(displayName)
                    ? (current?.DisplayName ?? userId)
                    : displayName.Trim();

                var joined = new ParticipantPresence(
                    UserId: userId,
                    DisplayName: resolvedName,
                    IsMuted: current?.IsMuted ?? false,
                    IsDeafened: current?.IsDeafened ?? false,
                    IsScreenSharing: current?.IsScreenSharing ?? false,
                    ScreenShareIdentity: current?.ScreenShareIdentity,
                    ScreenShareHasAudio: current?.ScreenShareHasAudio ?? false,
                    JoinedAtUtc: current?.JoinedAtUtc ?? DateTimeOffset.UtcNow
                );
                await presenceStore.UpsertParticipantAsync(roomId, joined, ct);
                break;

            case "participant_left":
                await presenceStore.RemoveParticipantAsync(roomId, userId, ct);
                break;

            case "track_muted":
            case "track_unmuted":
                var participant = await presenceStore.GetParticipantAsync(roomId, userId, ct);
                if (participant is not null)
                {
                    var isMuted = eventName == "track_muted" || (track?.Muted ?? false);
                    await presenceStore.UpsertParticipantAsync(
                        roomId,
                        participant with { IsMuted = isMuted },
                        ct);
                }
                break;
        }
    }
}
