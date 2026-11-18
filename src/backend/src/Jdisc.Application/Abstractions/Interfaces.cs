using Jdisc.Domain.Entities;
using Jdisc.Domain.Models;

namespace Jdisc.Application.Abstractions;

public interface IUserRepository
{
    Task<User?> GetByEmailAsync(string email, CancellationToken ct = default);
    Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task AddAsync(User user, CancellationToken ct = default);
}

public interface IVoiceRoomRepository
{
    Task<IReadOnlyList<VoiceRoom>> GetAllOrderedAsync(CancellationToken ct = default);
    Task<VoiceRoom?> GetByIdAsync(string roomId, CancellationToken ct = default);
}

public interface IRoomPresenceStore
{
    Task<IReadOnlyList<ParticipantPresence>> GetRoomParticipantsAsync(string roomId, CancellationToken ct = default);
    Task<ParticipantPresence?> GetParticipantAsync(string roomId, string userId, CancellationToken ct = default);
    Task UpsertParticipantAsync(string roomId, ParticipantPresence presence, CancellationToken ct = default);
    Task RemoveParticipantAsync(string roomId, string userId, CancellationToken ct = default);
    Task RemoveParticipantFromAllRoomsAsync(IEnumerable<string> roomIds, string userId, CancellationToken ct = default);
}

public sealed record LiveKitTokenResult(string Token, string LiveKitUrl, string Identity);

public interface ILiveKitTokenService
{
    LiveKitTokenResult GenerateVoiceToken(string userId, string displayName, string roomId);
    LiveKitTokenResult GenerateScreenshareToken(string userId, string displayName, string roomId);
}

public sealed record AppJwtResult(string AccessToken, DateTimeOffset ExpiresAt);

public interface IAppJwtService
{
    AppJwtResult GenerateUserToken(User user);
}

public interface IPasswordHasher
{
    string HashPassword(string password);
    bool VerifyPassword(string password, string passwordHash);
}

public sealed record RoomPresenceSnapshotDto(
    string Id,
    string Name,
    int DisplayOrder,
    int MaxParticipants,
    IReadOnlyList<ParticipantPresence> Participants
);

public interface IPresenceNotifier
{
    Task BroadcastRoomsSnapshotAsync(IReadOnlyList<RoomPresenceSnapshotDto> rooms, CancellationToken ct = default);
}
