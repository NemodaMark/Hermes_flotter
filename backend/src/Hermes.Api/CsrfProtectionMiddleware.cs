using Microsoft.AspNetCore.Antiforgery;

namespace Hermes.Api;

public sealed class CsrfProtectionMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, IAntiforgery antiforgery)
    {
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.Headers.CacheControl = "no-store";
            if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method)
                && !HttpMethods.IsOptions(context.Request.Method))
            {
                // Uploads use the SPA's CSRF header. Never parse a potentially large multipart body to look for a token.
                if (context.Request.HasFormContentType && string.IsNullOrEmpty(context.Request.Headers["X-CSRF-TOKEN"]))
                {
                    await Results.Problem(statusCode: 400, title: "A biztonsági ellenőrzéshez hiányzik a CSRF fejléc.").ExecuteAsync(context);
                    return;
                }
                try { await antiforgery.ValidateRequestAsync(context); }
                catch (AntiforgeryValidationException)
                {
                    await Results.Problem(statusCode: 400, title: "A biztonsági ellenőrzés nem sikerült. Frissítsd az oldalt, és próbáld újra.").ExecuteAsync(context);
                    return;
                }
            }
        }
        await next(context);
    }
}
