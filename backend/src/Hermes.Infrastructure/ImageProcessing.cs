using Hermes.Application;
using StbImageSharp;
using StbImageWriteSharp;

namespace Hermes.Infrastructure;

public static class ImageProcessing
{
    public const int MaxBytes = 5 * 1024 * 1024;
    public static byte[] Normalize(ImageUpload upload, bool avatar) => Normalize(upload, avatar ? 512 : 2048);
    internal static byte[] NormalizeCardBackground(ImageUpload upload) => Normalize(upload, 900);

    private static byte[] Normalize(ImageUpload upload, int max)
    {
        var bytes = upload.Bytes;
        if (bytes.Length is < 1 or > MaxBytes) throw UserAccounts.Error(413, "image_size", "Legfeljebb 5 MB-os képet válassz.");
        var jpg = bytes.AsSpan().StartsWith(new byte[] { 255, 216, 255 });
        var png = bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
        if (!jpg && !png) throw UserAccounts.Error(400, "image_type", "JPG- vagy PNG-képet válassz.");
        try
        {
            using var stream = new MemoryStream(bytes, writable: false);
            var info = ImageInfo.FromStream(stream);
            if (info is null || info.Value.Width < 1 || info.Value.Height < 1 || info.Value.Width > 8192 || info.Value.Height > 8192
                || (long)info.Value.Width * info.Value.Height > 16_000_000)
                throw UserAccounts.Error(400, "image_dimensions", "Legfeljebb 16 megapixeles, oldalanként legfeljebb 8192 képpontos képet válassz.");
            // Decode and rewrite pixels: uploaded metadata and trailing payload never reach browsers.
            var image = ImageResult.FromMemory(bytes, StbImageSharp.ColorComponents.RedGreenBlueAlpha);
            var scale = Math.Min(1d, (double)max / Math.Max(image.Width, image.Height));
            var width = Math.Max(1, (int)Math.Round(image.Width * scale));
            var height = Math.Max(1, (int)Math.Round(image.Height * scale));
            var pixels = new byte[width * height * 3];
            for (var y = 0; y < height; y++) for (var x = 0; x < width; x++)
            {
                var src = (Math.Min(image.Height - 1, (int)(y / scale)) * image.Width + Math.Min(image.Width - 1, (int)(x / scale))) * 4;
                var dest = (y * width + x) * 3;
                for (var c = 0; c < 3; c++) pixels[dest + c] = (byte)((image.Data[src + c] * image.Data[src + 3] + 255 * (255 - image.Data[src + 3])) / 255);
            }
            using var output = new MemoryStream();
            new ImageWriter().WriteJpg(pixels, width, height, StbImageWriteSharp.ColorComponents.RedGreenBlue, output, 88);
            if (output.Length > MaxBytes) throw UserAccounts.Error(413, "image_size", "A kép túl nagy. Válassz kisebb felbontást.");
            return output.ToArray();
        }
        catch (ManagementException) { throw; }
        catch (Exception ex) when (ex is not (OutOfMemoryException or OperationCanceledException))
        { throw UserAccounts.Error(400, "invalid_image", "A kép sérült vagy nem olvasható. Válassz másik JPG- vagy PNG-fájlt."); }
    }
}
