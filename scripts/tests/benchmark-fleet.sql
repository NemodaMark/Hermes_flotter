-- Run as the scratch PostgreSQL administrator in the seeded hermes_qa database.
-- This fixture adds a synthetic company. It is independent of the existing demo fleet.
BEGIN;
DO $$
BEGIN
    IF current_database() <> 'hermes_qa'
        OR (SELECT count(*) FROM tenants) <> 1
        OR NOT EXISTS (SELECT 1 FROM tenants WHERE "Name" = 'Demo Flotta')
        OR (SELECT count(*) FROM vehicles) <> 30
        OR EXISTS (SELECT 1 FROM vehicles WHERE "Registration" !~ '^DEMO-[0-9]{3}$')
        OR NOT EXISTS (SELECT 1 FROM identity_users WHERE "Id" = 'demo.nagy.anna')
    THEN RAISE EXCEPTION 'Use the isolated, freshly seeded hermes_qa database.';
    END IF;
END $$;

INSERT INTO tenants ("Id", "Name", "TimeZone")
VALUES (gen_random_uuid(), 'HERMES QA 300', 'Europe/Budapest');

CREATE TEMP TABLE qa_tenant ON COMMIT DROP AS
SELECT "Id" FROM tenants WHERE "Name" = 'HERMES QA 300';

INSERT INTO company_profiles ("TenantId","LegalName","CountryCode","Currency","DistanceUnit","Version","CreatedAt")
SELECT "Id", 'HERMES QA 300', 'HU', 'HUF', 'km', 1, now() FROM qa_tenant;

INSERT INTO tenant_memberships ("TenantId","UserSubject","IsActive","HasDirectAccess","Version","JoinedAt")
SELECT "Id", 'demo.nagy.anna', true, true, 1, now() FROM qa_tenant;

INSERT INTO tenant_membership_permissions ("TenantId","UserSubject","Code")
SELECT t."Id", 'demo.nagy.anna', p."Code"
FROM qa_tenant t CROSS JOIN permission_definitions p WHERE p."Code" NOT LIKE 'system.%';

INSERT INTO company_sites ("TenantId","Id","Name","Code","NormalizedCode","CountryCode","IsArchived","Version","CreatedAt","CreatedBy")
SELECT t."Id", gen_random_uuid(), 'QA telephely ' || n, 'QA' || n, 'QA' || n, 'HU', false, 1, now(), 'demo.nagy.anna'
FROM qa_tenant t CROSS JOIN generate_series(1, 3) n;

INSERT INTO vehicles ("Id","TenantId","Registration","Make","Model","Status","CreatedAt","OdometerKm","Version","CreatedBy")
SELECT gen_random_uuid(), t."Id", 'QA-' || lpad(n::text, 3, '0'), 'QA', 'Tesztjármű ' || n,
       CASE WHEN n % 9 = 0 THEN 'Maintenance' ELSE 'Active' END, now() - interval '1 year', 30000 + 37*n + 11*400, 1, 'demo.nagy.anna'
FROM qa_tenant t CROSS JOIN generate_series(1, 300) n;

CREATE TEMP TABLE qa_vehicles ON COMMIT DROP AS
SELECT v."Id", v."TenantId", v."Registration", 30000 + 37*substring(v."Registration", 4)::integer AS initial_km,
       substring(v."Registration", 4)::integer AS ordinal
FROM vehicles v JOIN qa_tenant t ON v."TenantId" = t."Id";

INSERT INTO vehicle_profiles ("TenantId","VehicleId","RegistrationCountry","Category","FuelType","Transmission","Ownership","BodyType","InspectionDueDate","NextServiceDate")
SELECT "TenantId","Id",'HU','PassengerCar','Diesel','Manual','Owned','Sedan',
       current_date + (ordinal % 61 - 30), current_date + (ordinal % 51 - 20)
FROM qa_vehicles;

INSERT INTO vehicle_site_assignments ("TenantId","VehicleId","SiteId")
SELECT v."TenantId", v."Id", s."Id" FROM qa_vehicles v JOIN company_sites s
ON v."TenantId" = s."TenantId" AND s."Code" = 'QA' || (1 + v.ordinal % 3);

INSERT INTO vehicle_registration_history ("TenantId","Id","VehicleId","Registration","CountryCode","RecordedBy","RecordedAt")
SELECT "TenantId",gen_random_uuid(),"Id","Registration",'HU','demo.nagy.anna',now() - interval '1 year' FROM qa_vehicles;

CREATE TEMP TABLE qa_months ON COMMIT DROP AS
SELECT n, (date_trunc('month', now()) - (11 - n) * interval '1 month')::date AS starts
FROM generate_series(0, 11) n;

INSERT INTO vehicle_odometer_readings ("TenantId","Id","VehicleId","Kilometers","RecordedBy","RecordedAt")
SELECT v."TenantId",gen_random_uuid(),v."Id",v.initial_km + n*400,'demo.nagy.anna',m.starts
FROM qa_vehicles v CROSS JOIN qa_months m;

INSERT INTO vehicle_fuel_entries ("TenantId","Id","VehicleId","FueledOn","Kilometers","Liters","Amount","Currency","RecordedBy","RecordedAt","IsFullTank","ReceiptNumber","Version")
SELECT v."TenantId",gen_random_uuid(),v."Id",m.starts,v.initial_km + n*400,35,21000,'HUF','demo.nagy.anna',m.starts,true,
       v."Registration" || '-' || n,1
FROM qa_vehicles v CROSS JOIN qa_months m;

INSERT INTO vehicle_booking_settings ("TenantId","VehicleId","Enabled")
SELECT "TenantId","Id",true FROM qa_vehicles;

INSERT INTO vehicle_bookings ("TenantId","Id","VehicleId","UserId","StartsOn","EndsOn")
SELECT v."TenantId",gen_random_uuid(),v."Id",'demo.nagy.anna',m.starts + 4,m.starts + 5
FROM qa_vehicles v CROSS JOIN qa_months m;

SELECT count(*) AS vehicles FROM qa_vehicles;
SELECT count(*) AS months FROM qa_months;
COMMIT;
