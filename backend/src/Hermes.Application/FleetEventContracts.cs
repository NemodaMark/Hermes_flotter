namespace Hermes.Application;

public sealed record FleetEventInput(Guid? VehicleId, string Title, DateOnly StartsOn, string Repeat = "Once", int Every = 1,
    DateOnly? EndsOn = null, string? Notes = null, long Version = 0);
public sealed record FleetEventStop(long Version);
public sealed record FleetEventVehicle(Guid Id, string Registration, string Make, string Model);
public sealed record FleetEventOptions(bool CanScheduleForFleet, FleetEventVehicle[] Vehicles, bool HasMore);
public sealed record FleetEventRow(Guid Id, Guid? VehicleId, string? Registration, string Title, DateOnly StartsOn, string Repeat, int Every,
    DateOnly? EndsOn, string? Notes, DateOnly? StoppedOn, long Version, bool CanManage, DateOnly[] Occurrences);
