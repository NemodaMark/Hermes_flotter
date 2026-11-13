using Hermes.Infrastructure;

namespace Hermes.Api;

public sealed class FleetReminderWorker(IServiceScopeFactory scopes, IConfiguration configuration, ILogger<FleetReminderWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!configuration.GetValue<bool>("FleetReminders:Enabled")) return;
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        do
        {
            try { await Dispatch(stoppingToken); }
            catch (Exception error) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning("Fleet reminder scan failed ({FailureType}).", error.GetType().Name);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task Dispatch(CancellationToken ct)
    {
        await using var directory = scopes.CreateAsyncScope();
        if (!directory.ServiceProvider.GetRequiredService<EmailDelivery>().Enabled) return;
        var companies = await directory.ServiceProvider.GetRequiredService<FleetReminders>().Companies(ct);
        foreach (var company in companies)
        {
            await using var scope = scopes.CreateAsyncScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().Set(company, "system:fleet-reminders", []);
            var reminders = scope.ServiceProvider.GetRequiredService<FleetReminders>();
            var email = scope.ServiceProvider.GetRequiredService<EmailDelivery>();
            foreach (var item in await reminders.Claim(company, DateTimeOffset.UtcNow, ct))
            {
                ct.ThrowIfCancellationRequested();
                if (!await reminders.CanDeliver(company, item, ct)) continue;
                var delivery = await email.TrySend(new(item.Email, $"HERMES – {item.Registration}",
                    $"{item.Company} – {item.Registration}\n\n{item.Description}\n\n{email.Link($"/vehicles/{company}/{item.VehicleId}")}"), ct);
                if (delivery is "sent" or "saved") await reminders.MarkDelivered(company, item, ct);
            }
        }
    }
}
