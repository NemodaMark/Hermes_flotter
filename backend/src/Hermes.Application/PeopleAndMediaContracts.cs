namespace Hermes.Application;

public sealed record PersonSummary(string Id, string DisplayName, string Email, string? PhoneNumber, string? AvatarRevision)
{
    public string? CardBackgroundRevision { get; init; }
}
public sealed record PersonProfile(PersonSummary Person, long Version, bool CanEdit, bool CanManageAccount, PersonVehicle[] Vehicles);
public sealed record PersonVehicle(Guid Id, string Registration, string Make, string Model, string? SiteName);
public sealed record EditOwnProfile(string DisplayName, string? PhoneNumber, long Version);
public sealed record PhotoSummary(Guid Id, int Slot, string Sha256, DateTimeOffset UploadedAt);
public sealed record PhotoCollection(PhotoSummary[] Items, long VehicleVersion);
public sealed record VehicleAssignee(string UserId, string DisplayName, DateTimeOffset AssignedAt);
public sealed record VehicleAssignmentHistory(Guid Id, string UserId, string DisplayName, DateTimeOffset AssignedAt,
    DateTimeOffset? ReleasedAt, string AssignedBy, string AssignedByDisplayName, string? ReleasedBy, string? ReleasedByDisplayName);
public sealed record AssignUserInput(string? UserId, long Version);
public sealed record ModelOption(string Make, string Model);
public sealed record ImageUpload(byte[] Bytes, string FileName, long Version);
