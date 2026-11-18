using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Jdisc.Application.Abstractions;
using Jdisc.Domain.Models;
using Microsoft.IdentityModel.Tokens;

namespace Jdisc.Infrastructure.LiveKit;

public sealed record LiveKitOptions(
    string ApiKey,
    string ApiSecret,
    string PublicUrl,
    TimeSpan? TokenTtl = null
);

public sealed class NativeLiveKitJwtService(LiveKitOptions options) : ILiveKitTokenService
{
    public LiveKitTokenResult GenerateVoiceToken(string userId, string displayName, string roomId)
    {
        if (string.IsNullOrWhiteSpace(userId))
            throw new ArgumentException("userId é obrigatório.", nameof(userId));
        if (string.IsNullOrWhiteSpace(roomId))
            throw new ArgumentException("roomId é obrigatório.", nameof(roomId));

        var identity = userId.Trim();
        var normalizedRoom = roomId.Trim().ToLowerInvariant();
        var videoGrant = new Dictionary<string, object>
        {
            ["roomJoin"] = true,
            ["room"] = normalizedRoom,
            ["canPublish"] = true,
            ["canSubscribe"] = true,
            ["canPublishData"] = true,
            ["canPublishSources"] = new[] { "microphone" }
        };

        var jwt = CreateHs256Jwt(
            identity: identity,
            name: string.IsNullOrWhiteSpace(displayName) ? identity : displayName.Trim(),
            metadata: null,
            videoGrant: videoGrant);

        return new LiveKitTokenResult(jwt, options.PublicUrl, identity);
    }

    public LiveKitTokenResult GenerateScreenshareToken(string userId, string displayName, string roomId)
    {
        if (string.IsNullOrWhiteSpace(userId))
            throw new ArgumentException("userId é obrigatório.", nameof(userId));
        if (string.IsNullOrWhiteSpace(roomId))
            throw new ArgumentException("roomId é obrigatório.", nameof(roomId));

        var trimmedUserId = userId.Trim();
        var companionIdentity = CompanionIdentity.BuildScreenshareIdentity(trimmedUserId);
        var metadata = CompanionIdentity.BuildScreenshareMetadataJson(trimmedUserId);
        var normalizedRoom = roomId.Trim().ToLowerInvariant();

        var videoGrant = new Dictionary<string, object>
        {
            ["roomJoin"] = true,
            ["room"] = normalizedRoom,
            ["canPublish"] = true,
            ["canSubscribe"] = false,
            ["canPublishData"] = false,
            ["canPublishSources"] = new[] { "screen_share", "screen_share_audio" }
        };

        var screenName = string.IsNullOrWhiteSpace(displayName)
            ? $"{trimmedUserId} (Tela)"
            : $"{displayName.Trim()} (Tela)";

        var jwt = CreateHs256Jwt(
            identity: companionIdentity,
            name: screenName,
            metadata: metadata,
            videoGrant: videoGrant);

        return new LiveKitTokenResult(jwt, options.PublicUrl, companionIdentity);
    }

    private string CreateHs256Jwt(
        string identity,
        string name,
        string? metadata,
        Dictionary<string, object> videoGrant)
    {
        var keyBytes = Encoding.UTF8.GetBytes(options.ApiSecret);
        var securityKey = new SymmetricSecurityKey(keyBytes);
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var now = DateTime.UtcNow;
        var ttl = options.TokenTtl ?? TimeSpan.FromHours(6);

        var payload = new JwtPayload(
            issuer: options.ApiKey,
            audience: null,
            claims: null,
            notBefore: now.AddSeconds(-5),
            expires: now.Add(ttl),
            issuedAt: now)
        {
            ["sub"] = identity,
            ["name"] = name,
            ["video"] = videoGrant
        };

        if (!string.IsNullOrWhiteSpace(metadata))
        {
            payload["metadata"] = metadata;
        }

        var header = new JwtHeader(credentials);
        var token = new JwtSecurityToken(header, payload);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
