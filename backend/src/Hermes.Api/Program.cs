using Hermes.Api;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);
var migrationMode = args.Contains("--migrate", StringComparer.Ordinal);

builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<ITenantContext>(services => services.GetRequiredService<TenantContext>());
builder.Services.AddDbContext<HermesDbContext>((services, options) =>
{
    var configuration = services.GetRequiredService<IConfiguration>();
    var connectionString = configuration.GetConnectionString(migrationMode ? "Migrations" : "Database");
    if (string.IsNullOrWhiteSpace(connectionString))
        throw new InvalidOperationException("Configure the Database and Migrations connection strings. See README.md.");
    options.UseNpgsql(connectionString);
});
builder.Services.AddScoped<ITenantDirectory, TenantDirectory>();
builder.Services.AddScoped<IVehicleStore, VehicleStore>();

if (!migrationMode)
{
    builder.Services.AddIdentityCore<ApplicationUser>(options =>
    {
        options.ClaimsIdentity.UserIdClaimType = "sub";
        options.User.RequireUniqueEmail = true;
        options.Password.RequiredLength = 12;
        options.Password.RequireDigit = false;
        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequireUppercase = false;
        options.Password.RequireLowercase = false;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    }).AddEntityFrameworkStores<HermesDbContext>().AddSignInManager();
    builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
    builder.Services.ConfigureApplicationCookie(options =>
    {
        options.Cookie.Name = "Hermes.Session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
    });
    var dataProtection = builder.Services.AddDataProtection().SetApplicationName("Hermes");
    if (builder.Configuration["DataProtection:KeyPath"] is { Length: > 0 } keyPath)
        dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keyPath));
    builder.Services.AddAntiforgery(options =>
    {
        options.HeaderName = "X-CSRF-TOKEN";
        options.Cookie.Name = "Hermes.Antiforgery";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    });
    builder.Services.AddRateLimiter(options =>
    {
        options.RejectionStatusCode = 429;
        options.AddPolicy("accounts", context => RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "local", _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = builder.Configuration.GetValue("Security:AccountPermitLimit", 30),
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
    });
    builder.Services.AddAuthorization();
}

var app = builder.Build();

if (migrationMode)
{
    await using (var scope = app.Services.CreateAsyncScope())
        await scope.ServiceProvider.GetRequiredService<HermesDbContext>().Database.MigrateAsync();
    return;
}

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseRouting();
app.UseAuthentication();
app.UseMiddleware<TenantResolutionMiddleware>();
app.UseAuthorization();
app.UseRateLimiter();
app.UseMiddleware<CsrfProtectionMiddleware>();
app.MapAccountEndpoints();

app.MapGet("/health/live", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapGet("/health/ready", async (HermesDbContext db, CancellationToken cancellationToken) =>
{
    try
    {
        var pending = await db.Database.GetPendingMigrationsAsync(cancellationToken);
        return pending.Any() ? Results.StatusCode(503) : Results.Ok(new { status = "ready" });
    }
    catch (NpgsqlException) { return Results.StatusCode(503); }
}).AllowAnonymous();

if (app.Environment.IsDevelopment()) app.MapOpenApi();

var api = app.MapGroup("/api/v1").RequireAuthorization();
api.MapGet("/tenants", async (HttpContext context, ITenantDirectory directory, CancellationToken cancellationToken) =>
{
    var subject = context.User.FindFirst("sub")?.Value;
    return subject is null ? Results.Unauthorized() : Results.Ok(await directory.ListForUserAsync(subject, cancellationToken));
});
api.MapPost("/tenants", async (CreateTenantRequest request, HttpContext context, UserManager<ApplicationUser> users, ITenantDirectory directory, CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 160)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Adj meg egy legfeljebb 160 karakteres cégnevet."] });
    var user = await users.GetUserAsync(context.User);
    if (user is null) return Results.Unauthorized();
    var tenant = await directory.CreateForUserAsync(user.Id, request, cancellationToken);
    return Results.Created("/api/v1/tenants", tenant);
});

var vehicles = api.MapGroup("/vehicles").WithMetadata(new TenantRequired());
vehicles.MapGet("/", async (IVehicleStore store, CancellationToken cancellationToken)
    => Results.Ok(await store.ListAsync(cancellationToken)));
vehicles.MapGet("/{id:guid}", async (Guid id, IVehicleStore store, CancellationToken cancellationToken)
    => await store.GetAsync(id, cancellationToken) is { } vehicle ? Results.Ok(vehicle) : Results.NotFound());
vehicles.MapPost("/", async (CreateVehicleRequest request, ITenantContext tenantContext, IVehicleStore store, CancellationToken cancellationToken) =>
{
    if (tenantContext.Role is not (FleetRole.Owner or FleetRole.FleetManager)) return Results.Forbid();
    var errors = VehicleValidation.Validate(request);
    if (errors.Count > 0) return Results.ValidationProblem(errors);
    try
    {
        var vehicle = await store.CreateAsync(request, cancellationToken);
        return Results.Created($"/api/v1/vehicles/{vehicle.Id}", vehicle);
    }
    catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
    {
        return Results.Problem(statusCode: 409, title: "Ez a rendszám már szerepel a cég flottájában.");
    }
});

await app.RunAsync();

public partial class Program;
