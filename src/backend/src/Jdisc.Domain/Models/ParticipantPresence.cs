using System.Text.Json;

namespace Jdisc.Domain.Models;

public sealed record ParticipantPresence(
    string UserId,
    string DisplayName,
    bool IsMuted,
    bool IsDeafened,
    bool IsScreenSharing,
    string? ScreenShareIdentity,
    bool ScreenShareHasAudio,
    DateTimeOffset JoinedAtUtc
);

public static class CompanionIdentity
{
    public const string ScreenshareSuffix = ":screenshare";
    public const string ScreenshareKind = "screenshare";

    public static string BuildScreenshareIdentity(string userId)
    {
        if (string.IsNullOrWhiteSpace(userId))
            throw new ArgumentException("userId é obrigatório.", nameof(userId));

        return $"{userId.Trim()}{ScreenshareSuffix}";
    }

    public static string BuildScreenshareMetadataJson(string parentUserId)
    {
        return JsonSerializer.Serialize(new
        {
            parentUserId = parentUserId.Trim(),
            kind = ScreenshareKind
        });
    }

    public static bool TryExtractParentUserId(string identity, string? metadataJson, out string parentUserId)
    {
        parentUserId = string.Empty;

        if (!string.IsNullOrWhiteSpace(metadataJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(metadataJson);
                var root = doc.RootElement;
                if (root.TryGetProperty("kind", out var kindProp) &&
                    string.Equals(kindProp.GetString(), ScreenshareKind, StringComparison.OrdinalIgnoreCase) &&
                    root.TryGetProperty("parentUserId", out var parentProp))
                {
                    var extracted = parentProp.GetString();
                    if (!string.IsNullOrWhiteSpace(extracted))
                    {
                        parentUserId = extracted.Trim();
                        return true;
                    }
                }
            }
            catch (JsonException)
            {
                // Fallback to suffix check below
            }
        }

        if (!string.IsNullOrWhiteSpace(identity) &&
            identity.EndsWith(ScreenshareSuffix, StringComparison.Ordinal))
        {
            var prefix = identity[..^ScreenshareSuffix.Length].Trim();
            if (!string.IsNullOrWhiteSpace(prefix))
            {
                parentUserId = prefix;
                return true;
            }
        }

        return false;
    }
}
