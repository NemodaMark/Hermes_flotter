using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public static class TenantTransaction
{
    public static async Task<T> RunAsync<T>(HermesDbContext db, Guid tenantId, Func<Task<T>> action, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('app.tenant_id', {tenantId.ToString()}, true)", ct);
        var result = await action();
        await transaction.CommitAsync(ct);
        return result;
    }
}
