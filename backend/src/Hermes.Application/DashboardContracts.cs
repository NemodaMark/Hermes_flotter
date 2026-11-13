namespace Hermes.Application;

public sealed record DashboardVehicle(VehicleSummary Vehicle, string BodyType, string? Color,
    DateOnly? InspectionDueDate, DateOnly? InsuranceDueDate, DateOnly? NextServiceDate, long? NextServiceKm, bool IsAssignedToMe)
{
    public DateTimeOffset? ServiceAppointmentAt { get; init; }
}
public sealed record DashboardSummary(string Mode, int Priority, string? SourceGroup, bool CanReadVehicles, DashboardVehicle[] Vehicles);
