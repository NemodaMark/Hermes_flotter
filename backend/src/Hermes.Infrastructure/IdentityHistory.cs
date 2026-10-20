using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public static class IdentityHistory
{
    public static async Task<Dictionary<string, string>> Resolve(HermesDbContext db, IEnumerable<string?> subjects, CancellationToken ct)
    {
        var ids = subjects.OfType<string>().Distinct(StringComparer.Ordinal).ToArray();
        return await db.UserIdentityHistory.AsNoTracking().Where(x => ids.Contains(x.PreviousId) && x.UserId != null)
            .ToDictionaryAsync(x => x.PreviousId, x => x.UserId!, ct);
    }
    public static string Subject(IReadOnlyDictionary<string, string> names, string subject)
        => names.TryGetValue(subject, out var name) ? name : subject;
}
