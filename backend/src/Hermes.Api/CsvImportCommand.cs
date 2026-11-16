using System.Text.Json;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hermes.Api;

internal static class CsvImportCommand
{
    public static async Task<int> RunAsync(HermesDbContext db, IConfiguration configuration, string[] args, CancellationToken ct)
    {
        try
        {
            var options = Options(configuration, args);
            if ((await db.Database.GetPendingMigrationsAsync(ct)).Any())
                throw new InvalidDataException("Az import előtt frissítsd a HERMES adatbázissémáját.");
            var result = await CsvImport.RunAsync(db, args[1], options, ct);
            Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
            return 0;
        }
        catch (InvalidDataException error) { Console.Error.WriteLine(error.Message); }
        catch (IOException) { Console.Error.WriteLine("Az importcsomag vagy valamelyik csatolmánya nem olvasható."); }
        catch (UnauthorizedAccessException) { Console.Error.WriteLine("Az importcsomag olvasásához nincs helyi jogosultság."); }
        catch (DbUpdateException error) when (error.InnerException is PostgresException postgres)
        {
            Console.Error.WriteLine($"Az adatbázis elutasította az importot ({postgres.SqlState}, {postgres.ConstraintName ?? postgres.TableName ?? "ismeretlen korlát"}).");
        }
        catch (NpgsqlException) { Console.Error.WriteLine("Az import adatbázis-művelete sikertelen."); }
        return 1;
    }

    private static CsvImportOptions Options(IConfiguration configuration, string[] args)
    {
        if (args.Length < 2 || args[0] != "--import-csv" || args[1].StartsWith("--", StringComparison.Ordinal))
            throw Usage();
        var apply = false;
        string? owner = null;
        for (var i = 2; i < args.Length; i++)
        {
            if (args[i] == "--apply" && !apply) apply = true;
            else if (args[i] == "--owner" && owner is null && i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal))
                owner = args[++i];
            else throw Usage();
        }
        Guid? tenant = configuration.GetValue<bool>("Entra:Enabled") && Guid.TryParse(configuration["Entra:TenantId"], out var value)
            && value != Guid.Empty ? value : null;
        return new(apply, owner, tenant, configuration.GetValue<bool>("Accounts:RequireEmailConfirmation"));
    }

    private static InvalidDataException Usage() => new("Használat: --import-csv <ZIP vagy mappa> [--owner <felhasználónév>] [--apply]");
}
