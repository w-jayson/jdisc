using System.Text.Json;
using Jdisc.Application.Abstractions;
using Jdisc.Domain.Models;
using StackExchange.Redis;

namespace Jdisc.Infrastructure.Redis;

public sealed class RedisPresenceStore(IConnectionMultiplexer redis) : IRoomPresenceStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static string GetRoomKey(string roomId) =>
        $"jdisc:room:{roomId.Trim().ToLowerInvariant()}:participants";

    public async Task<IReadOnlyList<ParticipantPresence>> GetRoomParticipantsAsync(
        string roomId,
        CancellationToken ct = default)
    {
        var db = redis.GetDatabase();
        var entries = await db.HashGetAllAsync(GetRoomKey(roomId));
        var result = new List<ParticipantPresence>(entries.Length);

        foreach (var entry in entries)
        {
            if (!entry.Value.HasValue)
                continue;

            var parsed = JsonSerializer.Deserialize<ParticipantPresence>((string)entry.Value!, JsonOptions);
            if (parsed is not null)
            {
                result.Add(parsed);
            }
        }

        return result.OrderBy(p => p.JoinedAtUtc).ToList();
    }

    public async Task<ParticipantPresence?> GetParticipantAsync(
        string roomId,
        string userId,
        CancellationToken ct = default)
    {
        var db = redis.GetDatabase();
        var value = await db.HashGetAsync(GetRoomKey(roomId), userId.Trim());
        if (!value.HasValue)
            return null;

        return JsonSerializer.Deserialize<ParticipantPresence>((string)value!, JsonOptions);
    }

    public async Task UpsertParticipantAsync(
        string roomId,
        ParticipantPresence presence,
        CancellationToken ct = default)
    {
        var db = redis.GetDatabase();
        var json = JsonSerializer.Serialize(presence, JsonOptions);
        await db.HashSetAsync(GetRoomKey(roomId), presence.UserId.Trim(), json);
    }

    public async Task RemoveParticipantAsync(
        string roomId,
        string userId,
        CancellationToken ct = default)
    {
        var db = redis.GetDatabase();
        await db.HashDeleteAsync(GetRoomKey(roomId), userId.Trim());
    }

    public async Task RemoveParticipantFromAllRoomsAsync(
        IEnumerable<string> roomIds,
        string userId,
        CancellationToken ct = default)
    {
        var db = redis.GetDatabase();
        var trimmedUser = userId.Trim();
        foreach (var roomId in roomIds)
        {
            await db.HashDeleteAsync(GetRoomKey(roomId), trimmedUser);
        }
    }
}
