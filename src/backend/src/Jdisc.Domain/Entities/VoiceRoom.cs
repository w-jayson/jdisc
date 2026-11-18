namespace Jdisc.Domain.Entities;

public sealed class VoiceRoom
{
    public const int DefaultMaxParticipants = 10;
    public const string RoomFullMessage = "Sala cheia — máximo 10 participantes";

    public string Id { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public int DisplayOrder { get; private set; }
    public int MaxParticipants { get; private set; } = DefaultMaxParticipants;

    private VoiceRoom() { }

    public VoiceRoom(string id, string name, int displayOrder, int maxParticipants = DefaultMaxParticipants)
    {
        if (string.IsNullOrWhiteSpace(id))
            throw new ArgumentException("Room ID é obrigatório.", nameof(id));
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Nome da sala é obrigatório.", nameof(name));
        if (maxParticipants <= 0)
            throw new ArgumentOutOfRangeException(nameof(maxParticipants));

        Id = id.Trim().ToLowerInvariant();
        Name = name.Trim();
        DisplayOrder = displayOrder;
        MaxParticipants = maxParticipants;
    }

    public bool CanAcceptParticipant(IReadOnlyCollection<string> currentPrimaryParticipantIds, string candidateUserId)
    {
        if (currentPrimaryParticipantIds.Contains(candidateUserId, StringComparer.Ordinal))
        {
            return true;
        }

        return currentPrimaryParticipantIds.Count < MaxParticipants;
    }

    public static IReadOnlyList<VoiceRoom> CreateDefaultSeedRooms() =>
    [
        new VoiceRoom("geral", "Geral", 1, DefaultMaxParticipants),
        new VoiceRoom("jogatina", "Jogatina", 2, DefaultMaxParticipants),
        new VoiceRoom("afk", "AFK", 3, DefaultMaxParticipants)
    ];
}
