using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace Hermes.Api;

public static class ReverseProxyConfiguration
{
    public static void ConfigureHermesProxy(this IServiceCollection services, IConfiguration configuration)
    {
        var addresses = configuration.GetSection("ReverseProxy:KnownProxies").Get<string[]>() ?? [];
        if (addresses.Length == 0) return; // Forwarded headers stay disabled in local development.
        var proxies = addresses.Select(address =>
            IPAddress.TryParse(address, out var ip) && !ip.Equals(IPAddress.Any) && !ip.Equals(IPAddress.IPv6Any)
                ? ip : throw new InvalidOperationException("ReverseProxy:KnownProxies must contain individual proxy IP addresses.")).ToArray();
        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.ForwardLimit = 1;
            options.KnownProxies.Clear();
            options.KnownIPNetworks.Clear();
            foreach (var proxy in proxies) options.KnownProxies.Add(proxy);
        });
    }
}
