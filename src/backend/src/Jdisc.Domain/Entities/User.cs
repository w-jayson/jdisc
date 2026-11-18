namespace Jdisc.Domain.Entities;

public sealed class User
{
    public Guid Id { get; private set; }
    public string DisplayName { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public string PasswordHash { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAtUtc { get; private set; }

    private User() { }

    public static User Create(string displayName, string email, string passwordHash, DateTimeOffset? nowUtc = null)
    {
        if (string.IsNullOrWhiteSpace(displayName))
            throw new ArgumentException("Nome de exibição é obrigatório.", nameof(displayName));

        var trimmedName = displayName.Trim();
        if (trimmedName.Length > 50)
            throw new ArgumentException("Nome de exibição deve ter no máximo 50 caracteres.", nameof(displayName));

        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
            throw new ArgumentException("E-mail inválido.", nameof(email));

        if (string.IsNullOrWhiteSpace(passwordHash))
            throw new ArgumentException("Hash de senha é obrigatório.", nameof(passwordHash));

        return new User
        {
            Id = Guid.NewGuid(),
            DisplayName = trimmedName,
            Email = email.Trim().ToLowerInvariant(),
            PasswordHash = passwordHash,
            CreatedAtUtc = nowUtc ?? DateTimeOffset.UtcNow
        };
    }
}
