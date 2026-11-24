namespace Hermes.Domain;

public sealed class FleetEvent : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid? VehicleId { get; init; }
    public required string Title { get; set; }
    public string? Notes { get; set; }
    public DateOnly StartsOn { get; set; }
    public string Repeat { get; set; } = "Once";
    public int Every { get; set; } = 1;
    public DateOnly? EndsOn { get; set; }
    public DateOnly? StoppedOn { get; set; }
    public long Version { get; set; } = 1;
}
