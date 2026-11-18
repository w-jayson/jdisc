using System.Text;
using Jdisc.Application.Abstractions;
using Jdisc.Application.Auth;
using Jdisc.Application.Rooms;
using Jdisc.Application.Webhooks;
using Jdisc.Infrastructure.LiveKit;
using Jdisc.Infrastructure.Persistence;
using Jdisc.Infrastructure.Redis;
using Jdisc.Infrastructure.Security;
using Jdisc.Presentation.Endpoints;
using Jdisc.Presentation.Hubs;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, cfg) =>
{
    cfg.ReadFrom.Configuration(context.Configuration)
       .Enrich.FromLogContext()
       .WriteTo.Console();
});

var postgresConn = builder.Configuration.GetConnectionString("Postgres")
    ?? "Host=localhost;Port=5432;Database=jdisc;Username=jdisc;Password=jdisc_dev_password";
var redisConn = builder.Configuration.GetConnectionString("Redis")
    ?? "localhost:6379";

var jwtOptions = new AppJwtOptions(
    Issuer: builder.Configuration["Jwt:Issuer"] ?? "jdisc-api",
    Audience: builder.Configuration["Jwt:Audience"] ?? "jdisc-client",
    Secret: builder.Configuration["Jwt:Secret"] ?? "replace-with-at-least-32-bytes-long-secret-key-for-jdisc-jwt"
);

var liveKitOptions = new LiveKitOptions(
    ApiKey: builder.Configuration["LiveKit:ApiKey"] ?? "APIjdiscLocalKey01",
    ApiSecret: builder.Configuration["LiveKit:ApiSecret"] ?? "SecretjdiscLocalKeyMustBeAtLeast32CharsLong01",
    PublicUrl: builder.Configuration["LiveKit:PublicUrl"] ?? "ws://localhost:7880"
);

var inviteCode = builder.Configuration["Auth:InviteCode"] ?? "JDISC-FRIENDS-2026";

builder.Services.AddDbContext<AppDbContext>(opt => opt.UseNpgsql(postgresConn));
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect($"{redisConn},abortConnect=false"));

builder.Services.AddSingleton(jwtOptions);
builder.Services.AddSingleton(liveKitOptions);
builder.Services.AddSingleton<IAppJwtService, AppJwtService>();
builder.Services.AddSingleton<IPasswordHasher, Pbkdf2PasswordHasher>();
builder.Services.AddSingleton<ILiveKitTokenService, NativeLiveKitJwtService>();
builder.Services.AddSingleton<LiveKitWebhookValidator>();

builder.Services.AddScoped<IUserRepository, EfUserRepository>();
builder.Services.AddScoped<IVoiceRoomRepository, EfVoiceRoomRepository>();
builder.Services.AddScoped<IRoomPresenceStore, RedisPresenceStore>();
builder.Services.AddScoped<IPresenceNotifier, SignalRPresenceNotifier>();

builder.Services.AddScoped(sp => new RegisterUserHandler(
    sp.GetRequiredService<IUserRepository>(),
    sp.GetRequiredService<IPasswordHasher>(),
    sp.GetRequiredService<IAppJwtService>(),
    inviteCode));
builder.Services.AddScoped<LoginUserHandler>();
builder.Services.AddScoped<GetRoomsHandler>();
builder.Services.AddScoped<IssueLiveKitVoiceTokenHandler>();
builder.Services.AddScoped<IssueLiveKitScreenshareTokenHandler>();
builder.Services.AddScoped<NormalizeLiveKitWebhookHandler>();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.SetIsOriginAllowed(_ => true)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtOptions.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.Secret)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs/presence"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddSignalR();

builder.Services.AddHealthChecks()
    .AddNpgSql(postgresConn, name: "postgres")
    .AddRedis(redisConn, name: "redis");

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.EnsureCreatedAsync();
}

app.UseSerilogRequestLogging();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapHealthChecks("/health");
app.MapAuthEndpoints();
app.MapRoomEndpoints();
app.MapHub<PresenceHub>("/hubs/presence");

app.Run();
