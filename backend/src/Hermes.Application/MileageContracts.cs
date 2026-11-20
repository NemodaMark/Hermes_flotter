namespace Hermes.Application;

public sealed record MileageUsageInput(DateOnly Month, long TotalKm, long PrivateKm);
public sealed record MileageAccountInput(long? MonthlyLimitKm, long Version);
public sealed record MileageModeInput(string Mode, long Version);
public sealed record MileageMonthInput(long? TotalKm, long? PrivateKm, long Version, bool Submit, bool ConfirmNoUsage = false, string? Reason = null);
public sealed record MileageEntryInput(DateOnly OccurredOn, long TotalKm, long PrivateKm, long Version = 0, long MonthVersion = 0, string? Reason = null);
public sealed record MileageUser(string UserId, string Name, long? MonthlyLimitKm, long Version);
public sealed record MileageEntryRow(Guid Id, DateOnly OccurredOn, long TotalKm, long PrivateKm, string Source, long Version, bool IsVoided,
    string RecordedBy, DateTimeOffset RecordedAt, string? UpdatedBy, DateTimeOffset? UpdatedAt);
public sealed record MileageReport(string UserId, DateOnly Month, string Mode, long TotalKm, long PrivateKm, long? MonthlyLimitKm,
    long Version, DateTimeOffset? SubmittedAt, string? UpdatedBy, DateTimeOffset? UpdatedAt, DateOnly? DueMonth, MileageEntryRow[] Entries);
