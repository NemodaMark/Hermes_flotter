using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using static Hermes.Infrastructure.CsvImport;

namespace Hermes.Infrastructure;

internal sealed partial class CsvImportCompany
{
    private void ImportHistory()
    {
        ImportRegistrationsAndOdometer();
        ImportAssignments();
        ImportContracts();
        ImportOperations();
    }

    private void ImportRegistrationsAndOdometer()
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var last = new Dictionary<Guid, VehicleRegistration>();
        Each("registrations", row =>
        {
            Unique(row, seen, row.Require("registration_ref"));
            var vehicle = Find(vehicles, row, "vehicle_ref").Vehicle;
            var plate = FleetManagement.NormalizeRegistration(row.Require("registration"));
            if (VehicleValidation.Validate(new(plate, vehicle.Make, vehicle.Model)).Count != 0) throw row.Error("Érvénytelen korábbi rendszám.");
            var country = OrganizationValidation.Address(new(row.Require("country_code"), null, null, null, null)).CountryCode;
            var entry = new VehicleRegistration
            {
                TenantId = TenantId, VehicleId = vehicle.Id, Registration = plate, CountryCode = country,
                RecordedAt = RequiredTime(row, "recorded_at"), RecordedBy = users.Actor(row, "recorded_by_ref")
            };
            if (!last.TryGetValue(vehicle.Id, out var previous) || previous.RecordedAt <= entry.RecordedAt) last[vehicle.Id] = entry;
            db.VehicleRegistrations.Add(entry);
        });
        foreach (var item in vehicles.Values)
        {
            var vehicle = item.Vehicle;
            if (last.TryGetValue(vehicle.Id, out var latest) && latest.Registration == vehicle.Registration
                && latest.CountryCode == item.Profile.RegistrationCountry) continue;
            // The current registration is a snapshot of the imported vehicle, with its own import provenance.
            db.VehicleRegistrations.Add(new() { TenantId = TenantId, VehicleId = vehicle.Id, Registration = vehicle.Registration,
                CountryCode = item.Profile.RegistrationCountry, RecordedBy = CsvImport.Actor });
        }
        seen.Clear();
        var readings = new Dictionary<Guid, OdometerReading>();
        Each("odometer", row =>
        {
            Unique(row, seen, row.Require("reading_ref"));
            var car = Find(vehicles, row, "vehicle_ref").Vehicle;
            var reading = new OdometerReading { TenantId = TenantId, VehicleId = car.Id, Kilometers = Kilometers(row),
                RecordedAt = RequiredTime(row, "recorded_at"), RecordedBy = users.Actor(row, "recorded_by_ref") };
            if (!readings.TryGetValue(car.Id, out var previous) || previous.RecordedAt <= reading.RecordedAt) readings[car.Id] = reading;
            db.OdometerReadings.Add(reading);
        });
        foreach (var item in vehicles.Values)
        {
            var vehicle = item.Vehicle;
            if (!readings.TryGetValue(vehicle.Id, out var reading)) continue;
            if (vehicle.OdometerKm < reading.Kilometers)
                throw new InvalidDataException("Az aktuális kilométerállás kisebb a legutolsó exportált értéknél.");
            vehicle.OdometerKm ??= reading.Kilometers;
        }
    }

    private void ImportAssignments()
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var open = new HashSet<Guid>();
        Each("vehicle_users", row =>
        {
            Unique(row, ids, row.Require("assignment_ref"));
            var car = Find(vehicles, row, "vehicle_ref").Vehicle;
            var member = Member(row);
            var user = users.Find(row);
            var starts = RequiredTime(row, "assigned_at");
            var ends = row.Time("released_at");
            if (ends is null)
            {
                Unique(row, open, car.Id);
                if (!member.IsActive || user.Archived) throw row.Error("Nyitott hozzárendeléshez aktív cégtag szükséges.");
            }
            if (ends < starts) throw row.Error("A visszaadás időpontja megelőzi a hozzárendelést.");
            db.VehicleUserAssignments.Add(new()
            {
                TenantId = TenantId, VehicleId = car.Id, UserId = user.Name, AssignedAt = starts, ReleasedAt = ends,
                AssignedBy = users.Actor(row, "assigned_by_ref"), ReleasedBy = users.OptionalActor(row, "released_by_ref")
            });
        });
    }

    private void ImportContracts()
    {
        var active = new Dictionary<Guid, List<(DateOnly Starts, DateOnly Ends)>>();
        Each("leases", row =>
        {
            var car = Find(vehicles, row, "vehicle_ref");
            var partner = Find(partners, row, "partner_ref");
            var data = FleetValidation.Lease(new(partner.Id, row.Require("contract_number"), RequiredDate(row, "start_date"), RequiredDate(row, "end_date"),
                row.Decimal("payment_amount"), row.Require("currency"), row.Require("billing_frequency"), row.Long("annual_km_limit"),
                row.Long("total_km_limit"), row.Require("status"), row.Text("document_url"), row.Text("notes")));
            if (data.Status == "Active")
            {
                if (!partner.IsLessor || partner.IsArchived || car.Profile.Ownership is not ("Leased" or "Rented"))
                    throw row.Error("Aktív szerződéshez aktív lízingbeadó és lízingelt vagy bérelt jármű szükséges.");
                AddPeriod(active, row, car.Vehicle.Id, data.StartDate, data.EndDate, "Az aktív lízingszerződések átfedik egymást.");
            }
            var lease = new VehicleLease
            {
                TenantId = TenantId, VehicleId = car.Vehicle.Id, PartnerId = partner.Id, ContractNumber = data.ContractNumber,
                StartDate = data.StartDate, EndDate = data.EndDate, PaymentAmount = data.PaymentAmount, Currency = data.Currency,
                BillingFrequency = data.BillingFrequency, AnnualKmLimit = data.AnnualKmLimit, TotalKmLimit = data.TotalKmLimit,
                Status = data.Status, DocumentUrl = data.DocumentUrl, Notes = data.Notes, CreatedAt = row.Time("source_created_at") ?? DateTimeOffset.UtcNow,
                CreatedBy = CreatedBy(row), UpdatedAt = row.Time("source_updated_at"), UpdatedBy = UpdatedBy(row)
            };
            Add(leases, row, "lease_ref", lease);
            db.VehicleLeases.Add(lease);
        });
        Each("services", row =>
        {
            var car = Find(vehicles, row, "vehicle_ref").Vehicle;
            var partner = Find(partners, row, "partner_ref");
            var data = FleetValidation.Service(new(partner.Id, RequiredDate(row, "performed_on"), row.Long("kilometers"), row.Require("description"),
                row.Text("work_order_number"), row.Decimal("cost"), row.Require("currency"), row.Date("next_service_date"),
                row.Long("next_service_km"), row.Text("document_url"), row.Text("notes")));
            var service = new VehicleService
            {
                TenantId = TenantId, VehicleId = car.Id, PartnerId = partner.Id, PerformedOn = data.PerformedOn, Kilometers = data.Kilometers,
                Description = data.Description, WorkOrderNumber = data.WorkOrderNumber, Cost = data.Cost, Currency = data.Currency,
                NextServiceDate = data.NextServiceDate, NextServiceKm = data.NextServiceKm, DocumentUrl = data.DocumentUrl, Notes = data.Notes,
                IsVoided = row.Bool("is_voided", false), VoidReason = row.Field("void_reason", 500),
                CreatedAt = row.Time("source_created_at") ?? DateTimeOffset.UtcNow, CreatedBy = CreatedBy(row),
                UpdatedAt = row.Time("source_updated_at"), UpdatedBy = UpdatedBy(row)
            };
            Add(services, row, "service_ref", service);
            db.VehicleServices.Add(service);
        });
    }

    private void ImportOperations()
    {
        var settings = new HashSet<Guid>();
        Each("booking_settings", row =>
        {
            var car = Find(vehicles, row, "vehicle_ref").Vehicle;
            Unique(row, settings, car.Id);
            db.VehicleBookingSettings.Add(new() { TenantId = TenantId, VehicleId = car.Id, Enabled = row.Bool("enabled") });
        });
        var bookings = new HashSet<string>(StringComparer.Ordinal);
        var active = new Dictionary<Guid, List<(DateOnly Starts, DateOnly Ends)>>();
        Each("bookings", row =>
        {
            Unique(row, bookings, row.Require("booking_ref"));
            var car = Find(vehicles, row, "vehicle_ref").Vehicle;
            var starts = RequiredDate(row, "starts_on");
            var ends = RequiredDate(row, "ends_on");
            if (ends.DayNumber - starts.DayNumber is < 0 or > 6) throw row.Error("A foglalás 1–7 naptári napos lehet.");
            var cancelled = row.Time("cancelled_at");
            if (cancelled is null) AddPeriod(active, row, car.Id, starts, ends, "A jármű foglalásai átfedik egymást.");
            db.VehicleBookings.Add(new() { TenantId = TenantId, VehicleId = car.Id, UserId = Member(row).UserSubject,
                StartsOn = starts, EndsOn = ends, CancelledAt = cancelled, CancelledBy = users.OptionalActor(row, "cancelled_by_ref") });
        });
        var appointments = new HashSet<Guid>();
        Each("service_appointments", row =>
        {
            var car = Find(vehicles, row, "vehicle_ref").Vehicle;
            Unique(row, appointments, car.Id);
            db.VehicleServiceAppointments.Add(new() { TenantId = TenantId, VehicleId = car.Id, StartsAt = RequiredTime(row, "starts_at"), Notes = row.Field("notes", 500) });
        });
        var fuel = new HashSet<string>(StringComparer.Ordinal);
        Each("fuel_entries", row =>
        {
            var reference = row.Require("fuel_ref");
            Unique(row, fuel, reference);
            var car = Find(vehicles, row, "vehicle_ref").Vehicle;
            var fueled = RequiredDate(row, "fueled_on");
            if (fueled > FleetManagement.LocalDay(DateTimeOffset.UtcNow, input.Company.TimeZone)) throw row.Error("Jövőbeli tankolási dátum.");
            var liters = row.Decimal("liters") ?? throw row.Error("Kötelező mező: liters.");
            var amount = row.Decimal("amount") ?? throw row.Error("Kötelező mező: amount.");
            FleetValidation.Range(liters, 999_999, "Liter", 3);
            FleetValidation.Range(amount, 999_999_999_999.99m, "Összeg", 2);
            if (liters == 0) throw row.Error("Pozitív tankolási mennyiség szükséges.");
            var entry = new VehicleFuelEntry
            {
                TenantId = TenantId, VehicleId = car.Id, FueledOn = fueled, Kilometers = Kilometers(row), Liters = liters, Amount = amount,
                Currency = FleetValidation.Currency(row.Require("currency")), RecordedBy = users.Actor(row, "recorded_by_ref"),
                VoidedAt = row.Time("voided_at"), Receipt = InlineImage("fuel_receipt", reference)
            };
            db.VehicleFuelEntries.Add(entry);
            if (row.Field("void_reason", 500) is { } reason)
                Audit("data.legacy_fuel_void", entry.Id.ToString(), entry.RecordedBy, entry.VoidedAt ?? DateTimeOffset.UtcNow, new { reason });
        });
        var handovers = new HashSet<string>(StringComparer.Ordinal);
        Each("handovers", row =>
        {
            var reference = row.Require("handover_ref");
            Unique(row, handovers, reference);
            var car = Find(vehicles, row, "vehicle_ref").Vehicle;
            var entry = new VehicleHandover
            {
                TenantId = TenantId, VehicleId = car.Id, RecordedAt = RequiredTime(row, "recorded_at"), Kilometers = Kilometers(row),
                Condition = FleetValidation.Text(row.Require("condition"), 200, "Állapot", true)!,
                PreviousUserId = users.Optional(row, "previous_user_ref")?.Name, NextUserId = users.Optional(row, "next_user_ref")?.Name,
                RecordedBy = users.Actor(row, "recorded_by_ref"), Notes = row.Field("notes", 1000),
                Photo = InlineImage("handover_photo", reference)
            };
            db.VehicleHandovers.Add(entry);
        });
    }

    private TenantMembership Member(CsvImportRow row)
    {
        var user = users.Find(row);
        return memberships.TryGetValue(user.Name, out var member) ? member : throw row.Error("A hivatkozott felhasználó nem tagja ennek a cégnek.");
    }
    private static long Kilometers(CsvImportRow row)
    {
        var km = row.Long("kilometers") ?? throw row.Error("Kötelező mező: kilometers.");
        FleetValidation.Range(km, 100_000_000, "Kilométerállás");
        return km;
    }
    private static DateOnly RequiredDate(CsvImportRow row, string key) => row.Date(key) ?? throw row.Error($"Kötelező mező: {key}.");
    private static DateTimeOffset RequiredTime(CsvImportRow row, string key) => row.Time(key) ?? throw row.Error($"Kötelező mező: {key}.");

    private static void AddPeriod(Dictionary<Guid, List<(DateOnly Starts, DateOnly Ends)>> periods, CsvImportRow row,
        Guid vehicle, DateOnly starts, DateOnly ends, string message)
    {
        if (!periods.TryGetValue(vehicle, out var set)) periods.Add(vehicle, set = []);
        if (set.Any(item => item.Starts <= ends && item.Ends >= starts)) throw row.Error(message);
        set.Add((starts, ends));
    }

    private void ImportAudit()
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        Each("audit_events", row =>
        {
            Unique(row, ids, row.Require("event_ref"));
            db.AccessAuditEvents.Add(new()
            {
                TenantId = TenantId, ActorSubject = users.Actor(row, "actor_ref"), TargetSubject = row.Field("entity_ref", 256),
                Action = "data.legacy_event", Details = CsvImport.LegacyEvent(row), CreatedAt = RequiredTime(row, "occurred_at")
            });
        });
        ids.Clear();
        Each("invitations", row =>
        {
            var id = row.Require("invitation_ref");
            Unique(row, ids, id);
            var email = row.Require("email");
            if (!UserAccounts.ValidEmail(email)) throw row.Error("Érvénytelen e-mail-cím.");
            var permissions = (row.Text("permission_codes") ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (permissions.Any(code => !Permissions.All.Contains(code, StringComparer.Ordinal))) throw row.Error("Ismeretlen meghívási jogosultság.");
            Audit("data.legacy_invitation", null, users.Actor(row, "invited_by_ref"), RequiredTime(row, "created_at"),
                new { source = id, email, permissions, expiresAt = row.Time("expires_at"), acceptedAt = row.Time("accepted_at"), revokedAt = row.Time("revoked_at") });
        });
        Audit("data.csv_imported", TenantId.ToString(), CsvImport.Actor, DateTimeOffset.UtcNow,
            new { package.Fingerprint, sourceCompany = input.Reference, owner });
    }

    private void Audit(string action, string? subject, string actor, DateTimeOffset at, object details) =>
        db.AccessAuditEvents.Add(new()
        {
            TenantId = TenantId, Action = action, TargetSubject = subject,
            ActorSubject = actor, CreatedAt = at, Details = JsonSerializer.Serialize(details)
        });
}
