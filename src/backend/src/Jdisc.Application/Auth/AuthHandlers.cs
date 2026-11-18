using Jdisc.Application.Abstractions;
using Jdisc.Domain.Entities;

namespace Jdisc.Application.Auth;

public sealed record RegisterUserCommand(
    string DisplayName,
    string Email,
    string Password,
    string InviteCode
);

public sealed record LoginUserCommand(string Email, string Password);

public sealed record UserDto(Guid Id, string DisplayName, string Email);

public sealed record AuthResponse(string AccessToken, DateTimeOffset ExpiresAt, UserDto User);

public sealed class AuthResult
{
    public bool IsSuccess { get; init; }
    public int StatusCode { get; init; }
    public string? ErrorCode { get; init; }
    public string? ErrorMessage { get; init; }
    public AuthResponse? Data { get; init; }

    public static AuthResult Success(AuthResponse data) =>
        new() { IsSuccess = true, StatusCode = 200, Data = data };

    public static AuthResult Failure(int statusCode, string errorCode, string errorMessage) =>
        new() { IsSuccess = false, StatusCode = statusCode, ErrorCode = errorCode, ErrorMessage = errorMessage };
}

public sealed class RegisterUserHandler(
    IUserRepository userRepository,
    IPasswordHasher passwordHasher,
    IAppJwtService jwtService,
    string configuredInviteCode)
{
    public async Task<AuthResult> HandleAsync(RegisterUserCommand cmd, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(configuredInviteCode) ||
            string.IsNullOrWhiteSpace(cmd.InviteCode) ||
            !string.Equals(cmd.InviteCode.Trim(), configuredInviteCode.Trim(), StringComparison.Ordinal))
        {
            return AuthResult.Failure(403, "INVALID_INVITE_CODE", "Código de convite inválido ou ausente.");
        }

        if (string.IsNullOrWhiteSpace(cmd.Password) || cmd.Password.Length < 6)
        {
            return AuthResult.Failure(400, "WEAK_PASSWORD", "A senha deve ter pelo menos 6 caracteres.");
        }

        var normalizedEmail = cmd.Email?.Trim().ToLowerInvariant() ?? string.Empty;
        var existing = await userRepository.GetByEmailAsync(normalizedEmail, ct);
        if (existing is not null)
        {
            return AuthResult.Failure(409, "EMAIL_ALREADY_EXISTS", "Já existe uma conta cadastrada com este e-mail.");
        }

        User user;
        try
        {
            var passwordHash = passwordHasher.HashPassword(cmd.Password);
            user = User.Create(cmd.DisplayName, normalizedEmail, passwordHash);
        }
        catch (ArgumentException ex)
        {
            return AuthResult.Failure(400, "VALIDATION_ERROR", ex.Message);
        }

        await userRepository.AddAsync(user, ct);
        var jwt = jwtService.GenerateUserToken(user);

        return AuthResult.Success(new AuthResponse(
            jwt.AccessToken,
            jwt.ExpiresAt,
            new UserDto(user.Id, user.DisplayName, user.Email)
        ));
    }
}

public sealed class LoginUserHandler(
    IUserRepository userRepository,
    IPasswordHasher passwordHasher,
    IAppJwtService jwtService)
{
    public async Task<AuthResult> HandleAsync(LoginUserCommand cmd, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(cmd.Email) || string.IsNullOrWhiteSpace(cmd.Password))
        {
            return AuthResult.Failure(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
        }

        var user = await userRepository.GetByEmailAsync(cmd.Email.Trim().ToLowerInvariant(), ct);
        if (user is null || !passwordHasher.VerifyPassword(cmd.Password, user.PasswordHash))
        {
            return AuthResult.Failure(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
        }

        var jwt = jwtService.GenerateUserToken(user);
        return AuthResult.Success(new AuthResponse(
            jwt.AccessToken,
            jwt.ExpiresAt,
            new UserDto(user.Id, user.DisplayName, user.Email)
        ));
    }
}
