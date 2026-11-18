using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Jdisc.Infrastructure.LiveKit;

public sealed class LiveKitWebhookValidator(LiveKitOptions options)
{
    public bool ValidateWebhookSignature(string? authorizationHeader, string rawBody)
    {
        if (string.IsNullOrWhiteSpace(authorizationHeader))
            return false;

        var token = authorizationHeader.Trim();
        if (token.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            token = token["Bearer ".Length..].Trim();
        }

        if (string.IsNullOrWhiteSpace(token))
            return false;

        var handler = new JwtSecurityTokenHandler();
        var keyBytes = Encoding.UTF8.GetBytes(options.ApiSecret);

        try
        {
            var parameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = options.ApiKey,
                ValidateAudience = false,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(keyBytes),
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(2)
            };

            var principal = handler.ValidateToken(token, parameters, out var validatedToken);
            if (validatedToken is not JwtSecurityToken jwt ||
                !string.Equals(jwt.Header.Alg, SecurityAlgorithms.HmacSha256, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var sha256Claim = principal.FindFirst("sha256")?.Value;
            if (!string.IsNullOrWhiteSpace(sha256Claim))
            {
                var bodyBytes = Encoding.UTF8.GetBytes(rawBody ?? string.Empty);
                var computedBytes = SHA256.HashData(bodyBytes);
                var computedBase64 = Convert.ToBase64String(computedBytes);
                var computedHex = Convert.ToHexStringLower(computedBytes);

                if (!string.Equals(sha256Claim, computedBase64, StringComparison.Ordinal) &&
                    !string.Equals(sha256Claim, computedHex, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }

            return true;
        }
        catch
        {
            return false;
        }
    }
}
