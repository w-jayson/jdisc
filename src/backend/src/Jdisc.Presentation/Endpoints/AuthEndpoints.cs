using System.Security.Claims;
using Jdisc.Application.Abstractions;
using Jdisc.Application.Auth;

namespace Jdisc.Presentation.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth");

        group.MapPost("/register", async (
            RegisterUserCommand cmd,
            RegisterUserHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(cmd, ct);
            if (!result.IsSuccess)
            {
                return Results.Json(
                    new { code = result.ErrorCode, message = result.ErrorMessage },
                    statusCode: result.StatusCode);
            }

            return Results.Ok(result.Data);
        }).AllowAnonymous();

        group.MapPost("/login", async (
            LoginUserCommand cmd,
            LoginUserHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(cmd, ct);
            if (!result.IsSuccess)
            {
                return Results.Json(
                    new { code = result.ErrorCode, message = result.ErrorMessage },
                    statusCode: result.StatusCode);
            }

            return Results.Ok(result.Data);
        }).AllowAnonymous();

        group.MapGet("/me", async (
            ClaimsPrincipal principal,
            IUserRepository userRepository,
            CancellationToken ct) =>
        {
            var rawId = principal.FindFirstValue(ClaimTypes.NameIdentifier) ??
                        principal.FindFirstValue("sub");

            if (!Guid.TryParse(rawId, out var userId))
            {
                return Results.Unauthorized();
            }

            var user = await userRepository.GetByIdAsync(userId, ct);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            return Results.Ok(new UserDto(user.Id, user.DisplayName, user.Email));
        }).RequireAuthorization();

        return app;
    }
}
