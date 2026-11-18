using FluentAssertions;
using Jdisc.Domain.Entities;
using Jdisc.Domain.Models;

namespace Jdisc.Domain.UnitTests;

public sealed class VoiceRoomAndCompanionTests
{
    [Fact]
    public void CanAcceptParticipant_AllowsUpToTen_AndRejectsEleventhUnlessAlreadyInRoom()
    {
        var room = new VoiceRoom("geral", "Geral", 1, VoiceRoom.DefaultMaxParticipants);
        var nineUsers = Enumerable.Range(1, 9).Select(i => $"user-{i}").ToArray();
        var tenUsers = Enumerable.Range(1, 10).Select(i => $"user-{i}").ToArray();

        room.CanAcceptParticipant(nineUsers, "user-10").Should().BeTrue();
        room.CanAcceptParticipant(tenUsers, "user-11").Should().BeFalse();
        room.CanAcceptParticipant(tenUsers, "user-5").Should().BeTrue();
    }

    [Fact]
    public void CompanionIdentity_ExtractsParentUserId_FromMetadataAndFromSuffix()
    {
        var identity = CompanionIdentity.BuildScreenshareIdentity("user-123");
        identity.Should().Be("user-123:screenshare");

        var metadata = CompanionIdentity.BuildScreenshareMetadataJson("user-123");
        CompanionIdentity.TryExtractParentUserId(identity, metadata, out var parentFromMeta).Should().BeTrue();
        parentFromMeta.Should().Be("user-123");

        CompanionIdentity.TryExtractParentUserId(identity, null, out var parentFromSuffix).Should().BeTrue();
        parentFromSuffix.Should().Be("user-123");

        CompanionIdentity.TryExtractParentUserId("user-123", null, out _).Should().BeFalse();
    }

    [Fact]
    public void UserCreate_NormalizesEmailAndValidatesDisplayName()
    {
        var user = User.Create("  Weslley  ", "  WESLLEY@Example.COM ", "hashed-pw");
        user.DisplayName.Should().Be("Weslley");
        user.Email.Should().Be("weslley@example.com");

        var act = () => User.Create(new string('a', 51), "a@b.com", "hashed-pw");
        act.Should().Throw<ArgumentException>();
    }
}
