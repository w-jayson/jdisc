using Jdisc.Application.Abstractions;
using Jdisc.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Jdisc.Infrastructure.Persistence;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<VoiceRoom> VoiceRooms => Set<VoiceRoom>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.DisplayName).HasMaxLength(50).IsRequired();
            entity.Property(u => u.Email).HasMaxLength(255).IsRequired();
            entity.HasIndex(u => u.Email).IsUnique();
            entity.Property(u => u.PasswordHash).IsRequired();
            entity.Property(u => u.CreatedAtUtc).IsRequired();
        });

        modelBuilder.Entity<VoiceRoom>(entity =>
        {
            entity.ToTable("voice_rooms");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasMaxLength(50);
            entity.Property(r => r.Name).HasMaxLength(50).IsRequired();
            entity.Property(r => r.DisplayOrder).IsRequired();
            entity.Property(r => r.MaxParticipants).IsRequired();
            entity.HasData(VoiceRoom.CreateDefaultSeedRooms());
        });
    }
}

public sealed class EfUserRepository(AppDbContext dbContext) : IUserRepository
{
    public Task<User?> GetByEmailAsync(string email, CancellationToken ct = default) =>
        dbContext.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        dbContext.Users.FirstOrDefaultAsync(u => u.Id == id, ct);

    public async Task AddAsync(User user, CancellationToken ct = default)
    {
        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync(ct);
    }
}

public sealed class EfVoiceRoomRepository(AppDbContext dbContext) : IVoiceRoomRepository
{
    public async Task<IReadOnlyList<VoiceRoom>> GetAllOrderedAsync(CancellationToken ct = default) =>
        await dbContext.VoiceRooms.OrderBy(r => r.DisplayOrder).ToListAsync(ct);

    public Task<VoiceRoom?> GetByIdAsync(string roomId, CancellationToken ct = default)
    {
        var normalized = roomId.Trim().ToLowerInvariant();
        return dbContext.VoiceRooms.FirstOrDefaultAsync(r => r.Id == normalized, ct);
    }
}
