using Hermes.Api;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using MimeKit;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class EmailDeliveryTests
{
    private sealed class Host(string environment) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environment;
        public string ApplicationName { get; set; } = "Hermes.Tests";
        public string ContentRootPath { get; set; } = Path.GetTempPath();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
    private static EmailOptions Options() => new()
    { Mode = "Smtp", Host = "smtp.example.test", FromAddress = "hermes@example.test", PublicBaseUrl = "https://fleet.example.test" };

    [Theory]
    [InlineData("http://fleet.example.test")]
    [InlineData("https://user:secret@fleet.example.test")]
    [InlineData("https://fleet.example.test/?redirect=other")]
    [InlineData("https://fleet.example.test/#fragment")]
    public void Public_links_reject_untrusted_url_forms(string url)
    {
        var options = Options();
        options.PublicBaseUrl = url;
        Assert.True(new EmailOptionsValidator(new Host("Production")).Validate(null, options).Failed);
    }

    [Fact]
    public void Smtp_requires_tls_and_pickup_is_development_only()
    {
        var validator = new EmailOptionsValidator(new Host("Production"));
        var options = Options();
        Assert.True(validator.Validate(null, options).Succeeded);
        options.Security = "None";
        Assert.True(validator.Validate(null, options).Failed);
        options.Mode = "Pickup";
        options.PickupDirectory = Path.GetTempPath();
        Assert.True(validator.Validate(null, options).Failed);
    }

    [Fact]
    public async Task Pickup_writes_a_real_mime_message_without_contacting_an_smtp_server()
    {
        var root = Path.Combine(Path.GetTempPath(), "hermes-email-test-" + Guid.NewGuid().ToString("N"));
        var options = Options();
        options.Mode = "Pickup";
        options.PickupDirectory = root;
        options.PublicBaseUrl = "http://127.0.0.1:5173";
        Assert.True(new EmailOptionsValidator(new Host("Development")).Validate(null, options).Succeeded);
        try
        {
            await new EmailTransport(Microsoft.Extensions.Options.Options.Create(options)).Send(new("anna@example.test", "Teszt üzenet", "Teszt tartalom"), CancellationToken.None);
            var path = Assert.Single(Directory.GetFiles(root, "*.eml"));
            using var message = await MimeMessage.LoadAsync(path);
            Assert.Equal("Teszt üzenet", message.Subject);
            Assert.Equal("Teszt tartalom", message.TextBody?.TrimEnd('\r', '\n'));
            Assert.Equal("anna@example.test", Assert.IsType<MailboxAddress>(Assert.Single(message.To)).Address);
        }
        finally
        {
            if (Directory.Exists(root))
            {
                foreach (var file in Directory.GetFiles(root)) File.Delete(file);
                Directory.Delete(root);
            }
        }
    }
}
