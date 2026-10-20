using System.Globalization;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Http.Features;

namespace Hermes.Api;

public static class DocumentEndpoints
{
    public static void MapDocumentEndpoints(this WebApplication app)
    {
        var vehicles = app.MapGroup("/api/v1/vehicles/{vehicleId:guid}").RequireAuthorization().WithMetadata(new TenantRequired());
        Map(vehicles.MapGroup("/leases/{parentId:guid}/documents"), true);
        Map(vehicles.MapGroup("/services/{parentId:guid}/documents"), false);
    }
    private static void Map(RouteGroupBuilder routes, bool lease)
    {
        var read = lease ? Permissions.LeasingRead : Permissions.ServicesRead;
        var write = lease ? Permissions.LeasingManage : Permissions.ServicesManage;
        routes.MapGet("/", async (Guid vehicleId, Guid parentId, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.ListDocuments(vehicleId, parentId, lease, ct))).RequireAuthorization(read);
        // Explicitly parse multipart only after checking the actual vehicle and parent record.
        routes.MapPost("/", async (Guid vehicleId, Guid parentId, HttpRequest request, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.UploadDocument(vehicleId, parentId, lease, () => ReadUpload(request, ct), ct)))
            .RequireAuthorization(write).RequireRateLimiting("accounts");
        routes.MapGet("/{id:guid}/content", async (Guid vehicleId, Guid parentId, Guid id, HttpContext http, FleetManagement service, CancellationToken ct) =>
        {
            var file = await service.DownloadDocument(vehicleId, parentId, lease, id, ct);
            http.Response.Headers.CacheControl = "private, no-store";
            http.Response.Headers.Pragma = "no-cache";
            http.Response.Headers["X-Content-Type-Options"] = "nosniff";
            http.Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
            return Results.File(file.Bytes, file.ContentType, fileDownloadName: file.FileName);
        }).RequireAuthorization(read);
        routes.MapPatch("/{id:guid}/status", async (Guid vehicleId, Guid parentId, Guid id, DocumentStatusInput input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.DocumentStatus(vehicleId, parentId, lease, id, input, ct))).RequireAuthorization(write);
    }
    private static async Task<DocumentUpload> ReadUpload(HttpRequest request, CancellationToken ct)
    {
        if (request.ContentType?.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase) != true)
            throw UserAccounts.Error(400, "upload_form", "Multipart fájlfeltöltés szükséges.");
        if (request.ContentLength > DocumentLimits.RequestBytes) throw TooLarge();
        if (request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit) limit.MaxRequestBodySize = DocumentLimits.RequestBytes;
        IFormCollection form;
        try
        {
            form = await request.ReadFormAsync(new FormOptions
            {
                MultipartBodyLengthLimit = DocumentLimits.RequestBytes, ValueCountLimit = 4, KeyLengthLimit = 64,
                ValueLengthLimit = 1024, MultipartHeadersCountLimit = 16, MultipartHeadersLengthLimit = 4096,
            }, ct);
        }
        catch (InvalidDataException e)
        {
            if (e.Message.Contains("limit", StringComparison.OrdinalIgnoreCase)) throw TooLarge();
            throw UserAccounts.Error(400, "upload_form", "Hibás vagy hiányos fájlfeltöltés.");
        }
        catch (BadHttpRequestException e)
        {
            if (e.StatusCode == 413) throw TooLarge();
            throw UserAccounts.Error(400, "upload_form", "Hibás vagy hiányos fájlfeltöltés.");
        }
        if (form.Files.Count != 1 || form.Files[0].Name != "file" || form.Count != 1 || form["version"].Count != 1
            || !long.TryParse(form["version"], NumberStyles.None, CultureInfo.InvariantCulture, out var version) || version < 1)
            throw UserAccounts.Error(400, "upload_form", "Egy fájlt és a bejegyzés aktuális verzióját küldd el.");
        var file = form.Files[0];
        if (file.Length is < 1 or > DocumentLimits.FileBytes) throw TooLarge();
        await using var stream = file.OpenReadStream();
        using var output = new MemoryStream((int)file.Length);
        var buffer = new byte[81920]; int length;
        while ((length = await stream.ReadAsync(buffer, ct)) > 0)
        {
            if (output.Length + length > DocumentLimits.FileBytes) throw TooLarge();
            await output.WriteAsync(buffer.AsMemory(0, length), ct);
        }
        return new DocumentUpload(file.FileName, output.ToArray(), version);
    }
    private static ManagementException TooLarge() => UserAccounts.Error(413, "document_size", "A fájl mérete 1 bájt és 10 MB közötti lehet.");
}
