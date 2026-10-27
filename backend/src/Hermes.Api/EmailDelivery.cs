using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Hermes.Api;

public sealed class EmailOptions
{
    public string Mode { get; set; } = "Disabled";
    public string PublicBaseUrl { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "HERMES";
    public string PickupDirectory { get; set; } = "";
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string Security { get; set; } = "StartTls";
    public string UserName { get; set; } = "";
    public string Password { get; set; } = "";
}

public sealed record EmailMessage(string Recipient, string Subject, string Text);
public interface IEmailTransport
{
    Task Send(EmailMessage message, CancellationToken ct);
}

public sealed class EmailOptionsValidator(IHostEnvironment environment) : IValidateOptions<EmailOptions>
{
    public ValidateOptionsResult Validate(string? name, EmailOptions options)
    {
        if (options.Mode == "Disabled") return ValidateOptionsResult.Success;
        if (options.Mode is not ("Smtp" or "Pickup")) return ValidateOptionsResult.Fail("Email:Mode must be Disabled, Smtp or Pickup.");
        if (!Uri.TryCreate(options.PublicBaseUrl, UriKind.Absolute, out var url)
            || !string.IsNullOrEmpty(url.UserInfo) || !string.IsNullOrEmpty(url.Query) || !string.IsNullOrEmpty(url.Fragment)
            || !(url.Scheme == "https" || environment.IsDevelopment() && url.Scheme == "http" && url.IsLoopback))
            return ValidateOptionsResult.Fail("Email:PublicBaseUrl must be a trusted HTTPS application URL (loopback HTTP is allowed in Development).");
        if (!MailboxAddress.TryParse(options.FromAddress, out var from) || from.Address != options.FromAddress)
            return ValidateOptionsResult.Fail("Email:FromAddress must be one mailbox address.");
        if (options.Mode == "Pickup" && (!environment.IsDevelopment() || !Path.IsPathFullyQualified(options.PickupDirectory)))
            return ValidateOptionsResult.Fail("Pickup mail is Development-only and requires an absolute directory.");
        if (options.Mode == "Smtp" && (string.IsNullOrWhiteSpace(options.Host) || options.Port is < 1 or > 65535
            || options.Security is not ("StartTls" or "SslOnConnect")
            || string.IsNullOrEmpty(options.UserName) != string.IsNullOrEmpty(options.Password)))
            return ValidateOptionsResult.Fail("Configure the SMTP host, port, mandatory TLS mode, and both credentials or neither.");
        return ValidateOptionsResult.Success;
    }
}

public sealed class EmailTransport(IOptions<EmailOptions> settings) : IEmailTransport
{
    public async Task Send(EmailMessage message, CancellationToken ct)
    {
        var options = settings.Value;
        var mime = new MimeMessage();
        mime.From.Add(new MailboxAddress(options.FromName, options.FromAddress));
        mime.To.Add(MailboxAddress.Parse(message.Recipient));
        mime.Subject = message.Subject;
        mime.Body = new TextPart("plain") { Text = message.Text };
        if (options.Mode == "Pickup")
        {
            Directory.CreateDirectory(options.PickupDirectory);
            var path = Path.Combine(options.PickupDirectory, $"{Guid.NewGuid():N}.eml");
            await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            await mime.WriteToAsync(file, ct);
            return;
        }
        using var smtp = new SmtpClient { Timeout = 10_000 };
        await smtp.ConnectAsync(options.Host, options.Port,
            options.Security == "SslOnConnect" ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls, ct);
        if (!string.IsNullOrEmpty(options.UserName)) await smtp.AuthenticateAsync(options.UserName, options.Password, ct);
        await smtp.SendAsync(mime, ct);
        await smtp.DisconnectAsync(true, ct);
    }
}

public sealed class EmailDelivery(IOptions<EmailOptions> settings, IEmailTransport transport, ILogger<EmailDelivery> logger)
{
    public bool Enabled => settings.Value.Mode != "Disabled";
    // Links use operator configuration, never the untrusted HTTP Host or forwarded headers.
    public string Link(string fragment) => settings.Value.PublicBaseUrl.TrimEnd('/') + "/#" + fragment;

    public async Task<string> TrySend(EmailMessage message, CancellationToken ct)
    {
        if (!Enabled) return "disabled";
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            await transport.Send(message, timeout.Token);
            return settings.Value.Mode == "Pickup" ? "saved" : "sent";
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            // SMTP responses/exception messages can contain addresses or message content.
            logger.LogWarning("Email delivery failed ({FailureType}).", error.GetType().Name);
            return "failed";
        }
    }
}
