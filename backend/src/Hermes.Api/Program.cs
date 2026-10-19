using Hermes.Api;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
var migrationMode = args.Contains("--migrate", StringComparer.Ordinal);
var seedMode = args.Contains("--seed", StringComparer.Ordinal);

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
    var developmentAuthentication = builder.Configuration.GetValue<bool>("Authentication:EnableDevelopmentAuthentication");
    if (developmentAuthentication && !builder.Environment.IsDevelopment())
        throw new InvalidOperationException("Development authentication is only permitted in Development.");

    if (developmentAuthentication)
        builder.Services.AddAuthentication(DevelopmentAuthenticationHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, DevelopmentAuthenticationHandler>(DevelopmentAuthenticationHandler.SchemeName, _ => { });
    else
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
        {
            options.Authority = builder.Configuration["Authentication:Authority"];
            options.Audience = builder.Configuration["Authentication:Audience"];
            options.MapInboundClaims = false;
            options.RequireHttpsMetadata = true;
            if (string.IsNullOrWhiteSpace(options.Authority) || string.IsNullOrWhiteSpace(options.Audience))
                throw new InvalidOperationException("Configure a trusted HTTPS JWT Authority and Audience.");
        });
    builder.Services.AddAuthorization();
}

var app = builder.Build();

if (migrationMode)
{
    if (seedMode && !app.Environment.IsDevelopment())
        throw new InvalidOperationException("Demo seeding is only permitted in Development.");

    await using (var scope = app.Services.CreateAsyncScope())
        await scope.ServiceProvider.GetRequiredService<HermesDbContext>().Database.MigrateAsync();

    if (seedMode)
        foreach (var tenantId in new[] { DevelopmentSeed.DunaId, DevelopmentSeed.PannonId })
        {
            await using var scope = app.Services.CreateAsyncScope();
            var tenantContext = scope.ServiceProvider.GetRequiredService<TenantContext>();
            tenantContext.Set(tenantId, FleetRole.Owner);
            await DevelopmentSeed.ApplyAsync(scope.ServiceProvider.GetRequiredService<HermesDbContext>(), tenantContext);
        }
    return;
}

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseRouting();
app.UseAuthentication();
app.UseMiddleware<TenantResolutionMiddleware>();
app.UseAuthorization();

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
