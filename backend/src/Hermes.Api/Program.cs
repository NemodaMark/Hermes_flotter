using Hermes.Api;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Microsoft.Extensions.Options;
using System.Threading.RateLimiting;

if (args is ["--health-check"])
{
    using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
    try { Environment.ExitCode = (await probe.GetAsync("http://127.0.0.1:8080/health/ready")).IsSuccessStatusCode ? 0 : 1; }
    catch (HttpRequestException) { Environment.ExitCode = 1; }
    catch (TaskCanceledException) { Environment.ExitCode = 1; }
    return;
}

var importMode = args.Contains("--import-csv", StringComparer.Ordinal);
var builder = WebApplication.CreateBuilder(importMode ? [] : args);
if (importMode) builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.ConfigureHermesProxy(builder.Configuration);
var migrationMode = args.Contains("--migrate", StringComparer.Ordinal);
var bootstrapIndex = Array.IndexOf(args, "--bootstrap-system-admin");
var developmentSetupIndex = Array.IndexOf(args, "--configure-development-admin");
var initializeIndex = Array.IndexOf(args, "--initialize-system-admin");
var maintenanceMode = importMode || migrationMode || bootstrapIndex >= 0 || developmentSetupIndex >= 0 || initializeIndex >= 0;
if (developmentSetupIndex >= 0) DevelopmentSetup.Validate(builder.Environment.IsDevelopment(), builder.Configuration.GetConnectionString("Migrations") ?? "");

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ManagementExceptionHandler>();
builder.Services.AddOpenApi();
builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<ITenantContext>(services => services.GetRequiredService<TenantContext>());
builder.Services.AddDbContext<HermesDbContext>((services, options) =>
{
    var configuration = services.GetRequiredService<IConfiguration>();
    var connectionString = configuration.GetConnectionString(maintenanceMode ? "Migrations" : "Database");
    if (string.IsNullOrWhiteSpace(connectionString))
        throw new InvalidOperationException("Configure the Database and Migrations connection strings. See README.md.");
    options.UseNpgsql(connectionString);
});
builder.Services.AddScoped<ITenantDirectory, TenantDirectory>();
builder.Services.AddScoped<IVehicleStore, VehicleStore>();

var identity = builder.Services.AddIdentityCore<ApplicationUser>(options =>
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
}).AddEntityFrameworkStores<HermesDbContext>();
builder.Services.AddScoped<AccountRegistration>();
if (!maintenanceMode)
{
    identity.AddSignInManager().AddDefaultTokenProviders()
        .AddTokenProvider<EmailConfirmationTokenProvider>("Hermes.EmailConfirmation");
    builder.Services.AddOptions<EmailOptions>().BindConfiguration("Email").ValidateOnStart();
    builder.Services.AddSingleton<IValidateOptions<EmailOptions>, EmailOptionsValidator>();
    builder.Services.AddOptions<AccountOptions>().BindConfiguration("Accounts")
        .Validate<IOptions<EmailOptions>>((options, mail) => !options.RequireEmailConfirmation || mail.Value.Mode != "Disabled",
            "Email delivery is required before enabling account confirmation.").ValidateOnStart();
    builder.Services.AddScoped<IEmailTransport, EmailTransport>();
    builder.Services.AddScoped<EmailDelivery>();
    builder.Services.AddScoped<AccountRecovery>();
    builder.Services.AddScoped<UserAccounts>();
    builder.Services.AddScoped<PeopleManagement>();
    builder.Services.AddScoped<SystemUserDirectory>();
    builder.Services.AddScoped<OrganizationManagement>();
    builder.Services.AddScoped<FleetManagement>();
    builder.Services.AddScoped<FleetReminders>();
    builder.Services.AddHostedService<FleetReminderWorker>();
    builder.Services.AddScoped<DashboardManagement>();
    builder.Services.AddScoped<IMemberManagement, MemberManagement>();
    builder.Services.AddScoped<IGroupManagement, GroupManagement>();
    builder.Services.Configure<IdentityOptions>(options => options.Tokens.EmailConfirmationTokenProvider = "Hermes.EmailConfirmation");
    builder.Services.Configure<DataProtectionTokenProviderOptions>(options => options.TokenLifespan = TimeSpan.FromHours(1));
    builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
    builder.Services.AddEntraSignIn(builder.Configuration);
    builder.Services.Configure<SecurityStampValidatorOptions>(options => options.ValidationInterval = TimeSpan.Zero);
    builder.Services.ConfigureApplicationCookie(options =>
    {
        options.Cookie.Name = "Hermes.Session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Events.OnValidatePrincipal = async context =>
        {
            await SecurityStampValidator.ValidatePrincipalAsync(context);
            if (!builder.Environment.IsDevelopment() && context.Principal?.FindFirst("sub")?.Value is { } subject)
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<HermesDbContext>();
                if (await db.AccountLifecycles.AnyAsync(x => x.UserId == subject && x.DevelopmentOnly)) context.RejectPrincipal();
            }
        };
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
    builder.Services.AddScoped<IAuthorizationHandler, TenantPermissionHandler>();
    builder.Services.AddScoped<IAuthorizationHandler, SystemManageHandler>();
    builder.Services.AddAuthorization(options =>
    {
        options.AddPolicy(SystemPermissions.Manage, policy => policy.RequireAuthenticatedUser().AddRequirements(new SystemManageRequirement()));
        foreach (var permission in Permissions.Catalog)
            options.AddPolicy(permission.Code, policy => policy.RequireAuthenticatedUser().AddRequirements(new TenantPermissionRequirement(permission.Code)));
    });
}

var app = builder.Build();

if (maintenanceMode)
{
    await using (var scope = app.Services.CreateAsyncScope())
    {
        if (importMode)
        {
            Environment.ExitCode = await CsvImportCommand.RunAsync(scope.ServiceProvider.GetRequiredService<HermesDbContext>(),
                app.Configuration, args, CancellationToken.None);
            return;
        }
        await scope.ServiceProvider.GetRequiredService<HermesDbContext>().Database.MigrateAsync();
        if (developmentSetupIndex >= 0)
        {
            if (developmentSetupIndex + 1 >= args.Length) throw new InvalidOperationException("Specify a cleanup manifest path.");
            var cleanup = System.Text.Json.JsonSerializer.Deserialize<DevelopmentCleanup>(await File.ReadAllTextAsync(args[developmentSetupIndex + 1]), new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
            var password = Environment.GetEnvironmentVariable("HERMES_DEVELOPMENT_ADMIN_PASSWORD") ?? "";
            var report = await DevelopmentSetup.Run(scope.ServiceProvider.GetRequiredService<HermesDbContext>(), builder.Environment.IsDevelopment(), password, cleanup, CancellationToken.None);
            Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(report));
        }
        if (initializeIndex >= 0)
        {
            if (initializeIndex + 2 >= args.Length) throw new InvalidOperationException("Specify a username and email address.");
            var password = Environment.GetEnvironmentVariable("HERMES_INITIAL_ADMIN_PASSWORD");
            await scope.ServiceProvider.GetRequiredService<AccountRegistration>().InitializeAdmin(
                new("Rendszergazda", args[initializeIndex + 2], password, args[initializeIndex + 1]), CancellationToken.None);
        }
        if (bootstrapIndex >= 0)
        {
            if (bootstrapIndex + 1 >= args.Length) throw new InvalidOperationException("Specify a user ID after --bootstrap-system-admin.");
            await UserAccounts.Bootstrap(scope.ServiceProvider.GetRequiredService<HermesDbContext>(), args[bootstrapIndex + 1], CancellationToken.None);
        }
    }
    return;
}

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseRouting();
app.UseAuthentication();
app.UseMiddleware<PasswordChangeMiddleware>();
app.UseMiddleware<TenantResolutionMiddleware>();
app.UseAuthorization();
app.UseRateLimiter();
app.UseMiddleware<CsrfProtectionMiddleware>();
app.MapAccountEndpoints();
app.MapEntraSignIn();
app.MapAccountRecovery();
app.MapMemberEndpoints();
app.MapGroupEndpoints();
app.MapSystemEndpoints();
app.MapOrganizationEndpoints();
app.MapFleetManagementEndpoints();
app.MapFleetOperations();
app.MapDocumentEndpoints();
app.MapPeopleAndMediaEndpoints();

app.MapGet("/health/live", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
// Build metadata contains no account, tenant or database credentials.
app.MapGet("/health/version", () => Results.Ok(RuntimeBuild.Describe(app.Environment.EnvironmentName))).AllowAnonymous();
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
api.MapGet("/dashboard", async (DashboardManagement service, CancellationToken ct) => Results.Ok(await service.Read(ct)))
    .WithMetadata(new TenantRequired());
api.MapGet("/dashboard/overview", async (string? site, DashboardManagement service, CancellationToken ct)
    => Results.Ok(await service.ReadOverview(site, ct)))
    .WithMetadata(new TenantRequired()).RequireAuthorization(Permissions.FleetOverviewRead, Permissions.VehiclesRead);
vehicles.MapGet("/site-options", async (IVehicleStore store, CancellationToken ct)
    => Results.Ok(await store.ReadSiteOptionsAsync(ct))).RequireAuthorization(Permissions.VehiclesRead);
vehicles.MapGet("/create-options", async (IVehicleStore store, CancellationToken ct)
    => Results.Ok(await store.CreationOptionsAsync(ct))).RequireAuthorization(Permissions.VehiclesCreate);
vehicles.MapGet("/", async (IVehicleStore store, CancellationToken cancellationToken)
    => Results.Ok(await store.ListAsync(cancellationToken))).RequireAuthorization(Permissions.VehiclesRead);
vehicles.MapGet("/search", async ([AsParameters] VehicleListQuery query, IVehicleStore store, CancellationToken ct)
    => Results.Ok(await store.SearchAsync(query, ct))).RequireAuthorization(Permissions.VehiclesRead);
vehicles.MapGet("/{id:guid}", async (Guid id, IVehicleStore store, CancellationToken cancellationToken)
    => await store.GetAsync(id, cancellationToken) is { } vehicle ? Results.Ok(vehicle) : Results.NotFound()).RequireAuthorization(Permissions.VehiclesRead);
vehicles.MapPost("/", async (CreateVehicleRequest request, IVehicleStore store, CancellationToken cancellationToken) =>
{
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
}).RequireAuthorization(Permissions.VehiclesCreate);

vehicles.MapPut("/{id:guid}", async (Guid id, UpdateVehicleRequest request, IVehicleStore store, CancellationToken ct) =>
{
    var errors = VehicleValidation.Validate(new(request.Registration, request.Make, request.Model));
    if (errors.Count > 0) return Results.ValidationProblem(errors);
    try { return Results.Ok(await store.UpdateAsync(id, request, ct)); }
    catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
    { return Results.Problem(statusCode: 409, title: "Ez a rendszám már szerepel a cég flottájában."); }
}).RequireAuthorization(Permissions.VehiclesUpdate);
vehicles.MapPost("/{id:guid}/odometer", async (Guid id, RecordOdometerRequest request, IVehicleStore store, CancellationToken ct)
    => Results.Ok(await store.RecordOdometerAsync(id, request, ct))).RequireAuthorization(Permissions.OdometerCreate);

await app.RunAsync();

public partial class Program;
