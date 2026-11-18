using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using FluentAssertions;
using Jdisc.Application.Abstractions;
using Jdisc.Application.Auth;
using Jdisc.Application.Rooms;
using Jdisc.Application.Webhooks;
using Jdisc.Domain.Entities;
using Jdisc.Domain.Models;
using Jdisc.Infrastructure.LiveKit;
using Jdisc.Infrastructure.Security;

namespace Jdisc.Application.UnitTests;

public sealed class LiveKitScreenshareTokenAndWebhookTests
{
    private static readonly LiveKitOptions TestLiveKitOptions = new(
        ApiKey: "APIjdiscTestKey",
        ApiSecret: "SecretjdiscTestKeyMustBeAtLeast32CharsLong!",
        PublicUrl: "ws://localhost:7880"
    );

    [Fact]
    public async Task IssueLiveKitScreenshareToken_RejectsWhenUserNotInVoiceRoom_AndIssuesScopedTokenWhenInRoom()
    {
        var roomRepo = new InMemoryVoiceRoomRepository();
        var presenceStore = new InMemoryRoomPresenceStore();
        var tokenService = new NativeLiveKitJwtService(TestLiveKitOptions);
        var handler = new IssueLiveKitScreenshareTokenHandler(roomRepo, presenceStore, tokenService);

        // 1. User not in room -> 403 Forbidden
        var forbidden = await handler.HandleAsync("geral", "user-42", "Weslley");
        forbidden.IsSuccess.Should().BeFalse();
        forbidden.StatusCode.Should().Be(403);
        forbidden.ErrorCode.Should().Be("NOT_IN_VOICE_ROOM");

        // 2. User joins voice room -> 200 OK with scoped {userId}:screenshare token
        await presenceStore.UpsertParticipantAsync("geral", new ParticipantPresence(
            UserId: "user-42",
            DisplayName: "Weslley",
            IsMuted: false,
            IsDeafened: false,
            IsScreenSharing: false,
            ScreenShareIdentity: null,
            ScreenShareHasAudio: false,
            JoinedAtUtc: DateTimeOffset.UtcNow
        ));

        var ok = await handler.HandleAsync("geral", "user-42", "Weslley");
        ok.IsSuccess.Should().BeTrue();
        ok.TokenResult.Should().NotBeNull();
        ok.TokenResult!.Identity.Should().Be("user-42:screenshare");

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(ok.TokenResult.Token);
        jwt.Issuer.Should().Be(TestLiveKitOptions.ApiKey);
        jwt.Subject.Should().Be("user-42:screenshare");
        jwt.Header.Alg.Should().Be("HS256");

        var metadataJson = jwt.Payload["metadata"]?.ToString();
        metadataJson.Should().NotBeNullOrWhiteSpace();
        CompanionIdentity.TryExtractParentUserId(jwt.Subject, metadataJson, out var extractedParent).Should().BeTrue();
        extractedParent.Should().Be("user-42");

        var videoJson = JsonSerializer.Serialize(jwt.Payload["video"]);
        using var videoDoc = JsonDocument.Parse(videoJson);
        var videoRoot = videoDoc.RootElement;
        videoRoot.GetProperty("roomJoin").GetBoolean().Should().BeTrue();
        videoRoot.GetProperty("room").GetString().Should().Be("geral");
        videoRoot.GetProperty("canPublish").GetBoolean().Should().BeTrue();
        videoRoot.GetProperty("canSubscribe").GetBoolean().Should().BeFalse();
        videoRoot.GetProperty("canPublishData").GetBoolean().Should().BeFalse();

        var sources = videoRoot.GetProperty("canPublishSources")
            .EnumerateArray()
            .Select(x => x.GetString())
            .ToArray();
        sources.Should().BeEquivalentTo(["screen_share", "screen_share_audio"]);
    }

    [Fact]
    public async Task NormalizeLiveKitWebhook_MapsCompanionIdentityToParentUser_WithoutCountingAsExtraParticipant()
    {
        var roomRepo = new InMemoryVoiceRoomRepository();
        var presenceStore = new InMemoryRoomPresenceStore();
        var notifier = new RecordingPresenceNotifier();
        var getRooms = new GetRoomsHandler(roomRepo, presenceStore);
        var webhookHandler = new NormalizeLiveKitWebhookHandler(roomRepo, presenceStore, notifier, getRooms);

        // 1. Primary user joins "geral"
        await webhookHandler.HandleAsync(new LiveKitWebhookPayload(
            Event: "participant_joined",
            Room: new LiveKitWebhookRoom("geral"),
            Participant: new LiveKitWebhookParticipant("user-1", "Weslley", null),
            Track: null
        ));

        var participantsAfterVoiceJoin = await presenceStore.GetRoomParticipantsAsync("geral");
        participantsAfterVoiceJoin.Should().HaveCount(1);
        participantsAfterVoiceJoin[0].UserId.Should().Be("user-1");
        participantsAfterVoiceJoin[0].IsScreenSharing.Should().BeFalse();

        // 2. Companion {userId}:screenshare joins -> MUST NOT add a 2nd participant
        var companionMeta = CompanionIdentity.BuildScreenshareMetadataJson("user-1");
        await webhookHandler.HandleAsync(new LiveKitWebhookPayload(
            Event: "participant_joined",
            Room: new LiveKitWebhookRoom("geral"),
            Participant: new LiveKitWebhookParticipant("user-1:screenshare", "Weslley (Tela)", companionMeta),
            Track: null
        ));

        (await presenceStore.GetRoomParticipantsAsync("geral")).Should().HaveCount(1);

        // 3. Companion publishes video + audio tracks -> updates parent user-1 IsScreenSharing & ScreenShareHasAudio
        await webhookHandler.HandleAsync(new LiveKitWebhookPayload(
            Event: "track_published",
            Room: new LiveKitWebhookRoom("geral"),
            Participant: new LiveKitWebhookParticipant("user-1:screenshare", "Weslley (Tela)", companionMeta),
            Track: new LiveKitWebhookTrack("TR_VID1", "VIDEO", "SCREEN_SHARE", false)
        ));

        await webhookHandler.HandleAsync(new LiveKitWebhookPayload(
            Event: "track_published",
            Room: new LiveKitWebhookRoom("geral"),
            Participant: new LiveKitWebhookParticipant("user-1:screenshare", "Weslley (Tela)", companionMeta),
            Track: new LiveKitWebhookTrack("TR_AUD1", "AUDIO", "SCREEN_SHARE_AUDIO", false)
        ));

        var duringStream = await presenceStore.GetParticipantAsync("geral", "user-1");
        duringStream.Should().NotBeNull();
        duringStream!.IsScreenSharing.Should().BeTrue();
        duringStream.ScreenShareIdentity.Should().Be("user-1:screenshare");
        duringStream.ScreenShareHasAudio.Should().BeTrue();
        (await presenceStore.GetRoomParticipantsAsync("geral")).Should().HaveCount(1);

        // 4. Companion leaves -> clears IsScreenSharing on parent while keeping parent in voice call
        await webhookHandler.HandleAsync(new LiveKitWebhookPayload(
            Event: "participant_left",
            Room: new LiveKitWebhookRoom("geral"),
            Participant: new LiveKitWebhookParticipant("user-1:screenshare", "Weslley (Tela)", companionMeta),
            Track: null
        ));

        var afterStreamStop = await presenceStore.GetParticipantAsync("geral", "user-1");
        afterStreamStop.Should().NotBeNull();
        afterStreamStop!.IsScreenSharing.Should().BeFalse();
        afterStreamStop.ScreenShareIdentity.Should().BeNull();
        afterStreamStop.ScreenShareHasAudio.Should().BeFalse();
        notifier.BroadcastCount.Should().Be(5);
    }

    [Fact]
    public async Task IssueLiveKitVoiceToken_BlocksEleventhParticipantWithRoomFullMessage()
    {
        var roomRepo = new InMemoryVoiceRoomRepository();
        var presenceStore = new InMemoryRoomPresenceStore();
        var tokenService = new NativeLiveKitJwtService(TestLiveKitOptions);
        var handler = new IssueLiveKitVoiceTokenHandler(roomRepo, presenceStore, tokenService);

        for (var i = 1; i <= 10; i++)
        {
            await presenceStore.UpsertParticipantAsync("geral", new ParticipantPresence(
                $"user-{i}", $"Amigo {i}", false, false, false, null, false, DateTimeOffset.UtcNow));
        }

        var eleventh = await handler.HandleAsync("geral", "user-11", "Amigo 11");
        eleventh.IsSuccess.Should().BeFalse();
        eleventh.StatusCode.Should().Be(409);
        eleventh.ErrorCode.Should().Be("ROOM_FULL");
        eleventh.ErrorMessage.Should().Be("Sala cheia — máximo 10 participantes");
    }

    [Fact]
    public async Task RegisterAndLoginUser_EnforcesInviteCode_AndAuthenticatesValidUser()
    {
        var userRepo = new InMemoryUserRepository();
        var hasher = new Pbkdf2PasswordHasher();
        var jwtService = new AppJwtService(new AppJwtOptions("jdisc-api", "jdisc-client", "super-secret-jwt-key-at-least-32-bytes-long!"));
        var registerHandler = new RegisterUserHandler(userRepo, hasher, jwtService, "JDISC-INVITE-OK");
        var loginHandler = new LoginUserHandler(userRepo, hasher, jwtService);

        var badInvite = await registerHandler.HandleAsync(
            new RegisterUserCommand("Weslley", "wes@jdisc.local", "senha123", "WRONG-CODE"));
        badInvite.IsSuccess.Should().BeFalse();
        badInvite.StatusCode.Should().Be(403);

        var registered = await registerHandler.HandleAsync(
            new RegisterUserCommand("Weslley", "wes@jdisc.local", "senha123", "JDISC-INVITE-OK"));
        registered.IsSuccess.Should().BeTrue();
        registered.Data!.AccessToken.Should().NotBeNullOrWhiteSpace();

        var loggedIn = await loginHandler.HandleAsync(new LoginUserCommand("WES@jdisc.local", "senha123"));
        loggedIn.IsSuccess.Should().BeTrue();
        loggedIn.Data!.User.DisplayName.Should().Be("Weslley");
    }

    private sealed class InMemoryVoiceRoomRepository : IVoiceRoomRepository
    {
        private readonly IReadOnlyList<VoiceRoom> _rooms = VoiceRoom.CreateDefaultSeedRooms();

        public Task<IReadOnlyList<VoiceRoom>> GetAllOrderedAsync(CancellationToken ct = default) =>
            Task.FromResult(_rooms);

        public Task<VoiceRoom?> GetByIdAsync(string roomId, CancellationToken ct = default) =>
            Task.FromResult(_rooms.FirstOrDefault(r =>
                string.Equals(r.Id, roomId.Trim(), StringComparison.OrdinalIgnoreCase)));
    }

    private sealed class InMemoryRoomPresenceStore : IRoomPresenceStore
    {
        private readonly Dictionary<string, Dictionary<string, ParticipantPresence>> _store = new(StringComparer.OrdinalIgnoreCase);

        public Task<IReadOnlyList<ParticipantPresence>> GetRoomParticipantsAsync(string roomId, CancellationToken ct = default)
        {
            if (!_store.TryGetValue(roomId, out var map))
                return Task.FromResult<IReadOnlyList<ParticipantPresence>>([]);

            return Task.FromResult<IReadOnlyList<ParticipantPresence>>(map.Values.OrderBy(p => p.JoinedAtUtc).ToList());
        }

        public Task<ParticipantPresence?> GetParticipantAsync(string roomId, string userId, CancellationToken ct = default)
        {
            if (_store.TryGetValue(roomId, out var map) && map.TryGetValue(userId, out var p))
                return Task.FromResult<ParticipantPresence?>(p);

            return Task.FromResult<ParticipantPresence?>(null);
        }

        public Task UpsertParticipantAsync(string roomId, ParticipantPresence presence, CancellationToken ct = default)
        {
            if (!_store.TryGetValue(roomId, out var map))
            {
                map = new Dictionary<string, ParticipantPresence>(StringComparer.Ordinal);
                _store[roomId] = map;
            }
            map[presence.UserId] = presence;
            return Task.CompletedTask;
        }

        public Task RemoveParticipantAsync(string roomId, string userId, CancellationToken ct = default)
        {
            if (_store.TryGetValue(roomId, out var map))
                map.Remove(userId);
            return Task.CompletedTask;
        }

        public Task RemoveParticipantFromAllRoomsAsync(IEnumerable<string> roomIds, string userId, CancellationToken ct = default)
        {
            foreach (var r in roomIds)
            {
                if (_store.TryGetValue(r, out var map))
                    map.Remove(userId);
            }
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingPresenceNotifier : IPresenceNotifier
    {
        public int BroadcastCount { get; private set; }
        public Task BroadcastRoomsSnapshotAsync(IReadOnlyList<RoomPresenceSnapshotDto> rooms, CancellationToken ct = default)
        {
            BroadcastCount++;
            return Task.CompletedTask;
        }
    }

    private sealed class InMemoryUserRepository : IUserRepository
    {
        private readonly List<User> _users = [];

        public Task<User?> GetByEmailAsync(string email, CancellationToken ct = default) =>
            Task.FromResult(_users.FirstOrDefault(u => u.Email == email));

        public Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
            Task.FromResult(_users.FirstOrDefault(u => u.Id == id));

        public Task AddAsync(User user, CancellationToken ct = default)
        {
            _users.Add(user);
            return Task.CompletedTask;
        }
    }
}
