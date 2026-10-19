using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Hermes.Infrastructure;

public sealed class HermesDbContextFactory : IDesignTimeDbContextFactory<HermesDbContext>
{
    public HermesDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Migrations")
            ?? "Host=localhost;Database=hermes;Username=hermes_migrator";
        return new HermesDbContext(new DbContextOptionsBuilder<HermesDbContext>().UseNpgsql(connectionString).Options, new TenantContext());
    }
}
