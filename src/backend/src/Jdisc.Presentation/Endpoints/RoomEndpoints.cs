using System.Security.Claims;
using System.Text.Json;
using Jdisc.Application.Rooms;
using Jdisc.Application.Webhooks;
using Jdisc.Infrastructure.LiveKit;

namespace Jdisc.Presentation.Endpoints;

public static class RoomEndpoints
{
    private static readonly JsonSerializerOptions WebhookJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    public static IEndpointRouteBuilder MapRoomEndpoints(this IEndpointRouteBuilder app)
    {
        var rooms = app.MapGroup("/api/rooms").RequireAuthorization();

        rooms.MapGet("/", async (GetRoomsHandler handler, CancellationToken ct) =>
        {
            var snapshot = await handler.HandleAsync(ct);
            return Results.Ok(snapshot);
        });

        rooms.MapPost("/{roomId}/voice-token", async (
            string roomId,
            ClaimsPrincipal principal,
            IssueLiveKitVoiceTokenHandler handler,
            CancellationToken ct) =>
        {
            var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier) ??
                         principal.FindFirstValue("sub");
            var displayName = principal.FindFirstValue("display_name") ?? userId ?? "Amigo";

            if (string.IsNullOrWhiteSpace(userId))
                return Results.Unauthorized();

            var outcome = await handler.HandleAsync(roomId, userId, displayName, ct);
            if (!outcome.IsSuccess || outcome.TokenResult is null)
            {
                return Results.Json(
                    new { code = outcome.ErrorCode, message = outcome.ErrorMessage },
                    statusCode: outcome.StatusCode);
            }

            return Results.Ok(new
            {
                token = outcome.TokenResult.Token,
                livekitUrl = outcome.TokenResult.LiveKitUrl,
                roomId = roomId.Trim().ToLowerInvariant(),
                identity = outcome.TokenResult.Identity
            });
        });

        rooms.MapPost("/{roomId}/screenshare-token", async (
            string roomId,
            ClaimsPrincipal principal,
            IssueLiveKitScreenshareTokenHandler handler,
            CancellationToken ct) =>
        {
            var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier) ??
                         principal.FindFirstValue("sub");
            var displayName = principal.FindFirstValue("display_name") ?? userId ?? "Amigo";

            if (string.IsNullOrWhiteSpace(userId))
                return Results.Unauthorized();

            var outcome = await handler.HandleAsync(roomId, userId, displayName, ct);
            if (!outcome.IsSuccess || outcome.TokenResult is null)
            {
                return Results.Json(
                    new { code = outcome.ErrorCode, message = outcome.ErrorMessage },
                    statusCode: outcome.StatusCode);
            }

            return Results.Ok(new
            {
                token = outcome.TokenResult.Token,
                livekitUrl = outcome.TokenResult.LiveKitUrl,
                identity = outcome.TokenResult.Identity
            });
        });

        app.MapPost("/api/webhooks/livekit", async (
            HttpRequest request,
            LiveKitWebhookValidator validator,
            NormalizeLiveKitWebhookHandler handler,
            CancellationToken ct) =>
        {
            using var reader = new StreamReader(request.Body);
            var rawBody = await reader.ReadToEndAsync(ct);

            var authHeader = request.Headers.Authorization.FirstOrDefault() ??
                             request.Headers["Authorize"].FirstOrDefault();

            if (!validator.ValidateWebhookSignature(authHeader, rawBody))
            {
                return Results.Unauthorized();
            }

            LiveKitWebhookPayload? payload;
            try
            {
                payload = JsonSerializer.Deserialize<LiveKitWebhookPayload>(rawBody, WebhookJsonOptions);
            }
            catch (JsonException)
            {
                return Results.BadRequest(new { code = "INVALID_WEBHOOK_JSON" });
            }

            if (payload is null)
            {
                return Results.BadRequest(new { code = "EMPTY_WEBHOOK" });
            }

            await handler.HandleAsync(payload, ct);
            return Results.Ok(new { ok = true });
        }).AllowAnonymous();

        return app;
    }
}
