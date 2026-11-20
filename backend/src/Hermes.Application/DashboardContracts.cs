namespace Hermes.Application;

public sealed record DashboardVehicle(VehicleSummary Vehicle, string BodyType, string? Color,
    DateOnly? InspectionDueDate, DateOnly? InsuranceDueDate, DateOnly? NextServiceDate, long? NextServiceKm, bool IsAssignedToMe)
{
    public DateTimeOffset? ServiceAppointmentAt { get; init; }
}
public sealed record DashboardSummary(string Mode, int Priority, string? SourceGroup, bool CanReadVehicles, DashboardVehicle[] Vehicles)
{
    public bool CanReadOverview { get; init; }
    public bool CanRecordMileage { get; init; }
    public DateOnly? MileageDueMonth { get; init; }
    public DateOnly Today { get; init; }
}

public sealed record DashboardMileageMonth(DateOnly Month, long? Kilometers);
public sealed record DashboardMileageVehicle(Guid VehicleId, string Registration, string Make, string Model, long Kilometers);
public sealed record DashboardOverview(DateOnly Today, DashboardVehicle[] Vehicles, DashboardMileageMonth[] MonthlyMileage,
    DashboardMileageVehicle[] TopVehicles);
