using Jdisc.Application.Abstractions;
using Jdisc.Domain.Entities;

namespace Jdisc.Application.Rooms;

public sealed class GetRoomsHandler(
    IVoiceRoomRepository roomRepository,
    IRoomPresenceStore presenceStore)
{
    public async Task<IReadOnlyList<RoomPresenceSnapshotDto>> HandleAsync(CancellationToken ct = default)
    {
        var rooms = await roomRepository.GetAllOrderedAsync(ct);
        var result = new List<RoomPresenceSnapshotDto>(rooms.Count);

        foreach (var room in rooms)
        {
            var participants = await presenceStore.GetRoomParticipantsAsync(room.Id, ct);
            result.Add(new RoomPresenceSnapshotDto(
                room.Id,
                room.Name,
                room.DisplayOrder,
                room.MaxParticipants,
                participants
            ));
        }

        return result;
    }
}

public sealed record IssueTokenOutcome(
    bool IsSuccess,
    int StatusCode,
    string? ErrorCode,
    string? ErrorMessage,
    LiveKitTokenResult? TokenResult
)
{
    public static IssueTokenOutcome Success(LiveKitTokenResult result) =>
        new(true, 200, null, null, result);

    public static IssueTokenOutcome Failure(int statusCode, string errorCode, string errorMessage) =>
        new(false, statusCode, errorCode, errorMessage, null);
}

public sealed class IssueLiveKitVoiceTokenHandler(
    IVoiceRoomRepository roomRepository,
    IRoomPresenceStore presenceStore,
    ILiveKitTokenService liveKitTokenService)
{
    public async Task<IssueTokenOutcome> HandleAsync(
        string roomId,
        string userId,
        string displayName,
        CancellationToken ct = default)
    {
        var room = await roomRepository.GetByIdAsync(roomId, ct);
        if (room is null)
        {
            return IssueTokenOutcome.Failure(404, "ROOM_NOT_FOUND", "Sala de voz não encontrada.");
        }

        var participants = await presenceStore.GetRoomParticipantsAsync(room.Id, ct);
        var currentIds = participants.Select(p => p.UserId).ToArray();

        if (!room.CanAcceptParticipant(currentIds, userId))
        {
            return IssueTokenOutcome.Failure(409, "ROOM_FULL", VoiceRoom.RoomFullMessage);
        }

        var token = liveKitTokenService.GenerateVoiceToken(userId, displayName, room.Id);
        return IssueTokenOutcome.Success(token);
    }
}

public sealed class IssueLiveKitScreenshareTokenHandler(
    IVoiceRoomRepository roomRepository,
    IRoomPresenceStore presenceStore,
    ILiveKitTokenService liveKitTokenService)
{
    public async Task<IssueTokenOutcome> HandleAsync(
        string roomId,
        string userId,
        string displayName,
        CancellationToken ct = default)
    {
        var room = await roomRepository.GetByIdAsync(roomId, ct);
        if (room is null)
        {
            return IssueTokenOutcome.Failure(404, "ROOM_NOT_FOUND", "Sala de voz não encontrada.");
        }

        var activeParticipant = await presenceStore.GetParticipantAsync(room.Id, userId, ct);
        if (activeParticipant is null)
        {
            return IssueTokenOutcome.Failure(
                403,
                "NOT_IN_VOICE_ROOM",
                "Você precisa estar conectado na chamada de voz desta sala para transmitir a tela.");
        }

        var token = liveKitTokenService.GenerateScreenshareToken(userId, displayName, room.Id);
        return IssueTokenOutcome.Success(token);
    }
}
