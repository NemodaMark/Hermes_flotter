using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class ReverseProxyTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Theory]
    [InlineData("192.0.2.10", 200)]
    [InlineData("192.0.2.99", 500)]
    public async Task Production_csrf_accepts_https_only_from_the_configured_proxy(string peer, int expectedStatus)
    {
        await using var factory = fixture.CreateFactory("Production").WithWebHostBuilder(builder =>
            builder.UseSetting("ReverseProxy:KnownProxies:0", "192.0.2.10"));
        var result = await factory.Server.SendAsync(context =>
        {
            context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
            context.Request.Scheme = "http";
            context.Request.Host = new("localhost");
            context.Request.Path = "/api/v1/auth/csrf";
            context.Request.Headers["X-Forwarded-Proto"] = "https";
            context.Request.Headers["X-Forwarded-For"] = "198.51.100.3";
        });
        Assert.Equal(expectedStatus, result.Response.StatusCode);
        if (expectedStatus == 200)
        {
            Assert.Contains("secure", result.Response.Headers.SetCookie.ToString(), StringComparison.OrdinalIgnoreCase);
            Assert.Equal(IPAddress.Parse("198.51.100.3"), result.Connection.RemoteIpAddress);
        }
    }

    [Fact]
    public async Task Forwarded_https_is_disabled_without_explicit_proxy_configuration()
    {
        await using var factory = fixture.CreateFactory("Production");
        var result = await factory.Server.SendAsync(context =>
        {
            context.Connection.RemoteIpAddress = IPAddress.Loopback;
            context.Request.Scheme = "http";
            context.Request.Host = new("localhost");
            context.Request.Path = "/api/v1/auth/csrf";
            context.Request.Headers["X-Forwarded-Proto"] = "https";
        });
        Assert.Equal(500, result.Response.StatusCode);
    }
}
