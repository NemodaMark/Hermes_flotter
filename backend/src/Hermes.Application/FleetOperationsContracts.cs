namespace Hermes.Application;

public sealed record BookingSettingsInput(bool Enabled);
public sealed record BookingInput(DateOnly StartsOn, DateOnly EndsOn);
public sealed record BookingRow(Guid Id, string UserId, string Name, DateOnly StartsOn, DateOnly EndsOn);
public sealed record BookingCalendar(bool Enabled, DateOnly Today, BookingRow[] Items);
public sealed record ServiceAppointmentInput(DateTimeOffset StartsAt, string? Notes);
public sealed record FuelMileage(long TotalKm, long PrivateKm);
public sealed record FuelMileagePreview(long? TotalKm);
public sealed record FuelEntryInput(DateOnly FueledOn, long Kilometers, decimal Liters, decimal? Amount = null, string? Currency = null,
    string? ReceiptNumber = null, bool IsFullTank = false, MileageUsageInput? Usage = null, FuelMileage? AutomaticMileage = null);
public sealed record UpdateFuelEntryInput(FuelEntryInput Data, long Version, string Reason);
public sealed record FuelEntryRow(Guid Id, DateOnly FueledOn, long Kilometers, decimal Liters, decimal? Amount, string? Currency, bool HasReceipt, bool IsVoided)
{
    public string? ReceiptNumber { get; init; }
    public bool IsFullTank { get; init; }
    public long Version { get; init; } = 1;
    public string? RecordedBy { get; init; }
    public DateTimeOffset? RecordedAt { get; init; }
    public string? UpdatedBy { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }
    public decimal? LitersPer100Km { get; init; }
}
public sealed record FuelTotal(string? Currency, decimal Liters, decimal? Amount);
public sealed record FuelMonth(FuelEntryRow[] Items, FuelTotal[] Totals)
{
    public decimal? LitersPer100Km { get; init; }
    public long MeasuredKilometers { get; init; }
}
public sealed record HandoverInput(string? UserId, long Kilometers, string Condition, string? Notes, long Version);
public sealed record HandoverRow(Guid Id, string? PreviousUserId, string? NextUserId, string RecordedBy, DateTimeOffset RecordedAt, long Kilometers, string Condition, string? Notes, bool HasPhoto);
public sealed record ReminderCandidate(Guid VehicleId, string UserId, string EventKey, string Email, string Registration, string Company, string Description, bool Service);
