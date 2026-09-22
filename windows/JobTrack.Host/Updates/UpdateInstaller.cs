using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using JobTrack.Host.Resources;

namespace JobTrack.Host.Updates;

/// <summary>Why a downloaded installer was not trusted. The message is shown to the user.</summary>
internal sealed class UpdateVerificationException(string message) : Exception(message);

/// <summary>
/// Downloads a release's installer, proves it is the file that was published, and runs it.
/// </summary>
/// <remarks>
/// Two checks stand between a download and running it:
///
/// <list type="bullet">
/// <item>The SHA-256 published beside the installer has to match. That catches a truncated or
/// corrupted download, which is the realistic failure.</item>
/// <item>When this JobTrack.exe is itself Authenticode-signed, the installer has to carry a valid
/// signature from the same publisher. The checksum lives on the same release as the installer, so
/// it cannot tell a tampered release from a real one; a signature can. Unsigned builds, which is
/// every release until code signing is configured, cannot demand what they do not have themselves,
/// and skip it.</item>
/// </list>
///
/// The installer is the ordinary Inno Setup one, run with <c>/SILENT</c>: no wizard pages, only its
/// progress window, so the person who clicked Install can see it happening. Its
/// <c>PrepareToInstall</c> already stops a running JobTrack, and <c>/relaunch=1</c> tells it to
/// start the new one afterwards (see <c>windows/installer/JobTrack.iss</c>).
/// </remarks>
internal static class UpdateInstaller
{
    /// <summary>Passed by the installer when it relaunches JobTrack at the end of an update.</summary>
    public const string UpdatedSwitch = "--updated";

    /// <summary>Downloads live beside the logs: ours, disposable, and removed on uninstall.</summary>
    private static string DownloadDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JobTrack", "updates");

    /// <summary>
    /// Clears out installers from earlier updates. The installer that just ran cannot delete
    /// itself, so the next start does it.
    /// </summary>
    public static void DeleteStaleDownloads()
    {
        try
        {
            if (!Directory.Exists(DownloadDir)) return;
            foreach (var file in Directory.EnumerateFiles(DownloadDir))
            {
                try { File.Delete(file); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* Still running; next time. */ }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // Leftover downloads cost disk space, not correctness.
        }
    }

    /// <returns>The path of an installer that passed every check.</returns>
    /// <exception cref="UpdateVerificationException">The download is not the published installer.</exception>
    public static async Task<string> DownloadAndVerifyAsync(HttpClient http, ReleaseInfo release, IProgress<double> progress)
    {
        Directory.CreateDirectory(DownloadDir);
        var target = Path.Combine(DownloadDir, release.InstallerName);
        var partial = target + ".partial";

        var expected = await FetchChecksumAsync(http, release);

        using (var response = await http.GetAsync(release.InstallerUrl, HttpCompletionOption.ResponseHeadersRead))
        {
            response.EnsureSuccessStatusCode();
            var total = response.Content.Headers.ContentLength ?? release.Size;

            await using var source = await response.Content.ReadAsStreamAsync();
            await using var file = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true);
            var buffer = new byte[81920];
            long received = 0;
            int read;
            while ((read = await source.ReadAsync(buffer)) > 0)
            {
                await file.WriteAsync(buffer.AsMemory(0, read));
                received += read;
                if (total > 0) progress.Report(Math.Min(1d, (double)received / total));
            }
        }

        string actual;
        await using (var file = File.OpenRead(partial))
        {
            actual = Convert.ToHexStringLower(await SHA256.HashDataAsync(file));
        }
        if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(partial);
            throw new UpdateVerificationException(Strings.Get("updates.checksumMismatch"));
        }

        if (!HasMatchingSignature(partial))
        {
            File.Delete(partial);
            throw new UpdateVerificationException(Strings.Get("updates.notSigned"));
        }

        File.Move(partial, target, overwrite: true);
        return target;
    }

    /// <summary>Starts the installer silently, asking it to relaunch JobTrack when it is done.</summary>
    public static void Launch(string installerPath)
    {
        Process.Start(new ProcessStartInfo(installerPath, "/SILENT /SUPPRESSMSGBOXES /NORESTART /relaunch=1")
        {
            UseShellExecute = false,
            WorkingDirectory = DownloadDir,
        });
    }

    /// <summary>The <c>.sha256</c> file is the lowercase hash alone, as windows-release.yml writes it.</summary>
    private static async Task<string> FetchChecksumAsync(HttpClient http, ReleaseInfo release)
    {
        var text = await http.GetStringAsync(release.ChecksumUrl);
        var hash = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? string.Empty;
        if (hash.Length != 64 || !hash.All(Uri.IsHexDigit))
        {
            throw new UpdateVerificationException(Strings.Get("updates.checksumUnreadable"));
        }
        return hash;
    }

    // --------------------------------------------------------------------------------- signatures

    private static bool HasMatchingSignature(string installerPath)
    {
        var self = Environment.ProcessPath;
        if (self is null || !IsTrusted(self)) return true; // An unsigned build has no publisher to match.
        if (!IsTrusted(installerPath)) return false;
        return string.Equals(SignerSubject(self), SignerSubject(installerPath), StringComparison.Ordinal);
    }

    private static string? SignerSubject(string path)
    {
        try
        {
            // No replacement exists for reading an Authenticode signer: X509CertificateLoader only
            // reads certificate files, not the signature embedded in a PE.
#pragma warning disable SYSLIB0057
            using var certificate = X509Certificate.CreateFromSignedFile(path);
#pragma warning restore SYSLIB0057
            return certificate.Subject;
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    /// <summary>Whether Windows trusts the file's Authenticode signature, without any UI or network fetches.</summary>
    private static bool IsTrusted(string path)
    {
        var fileInfo = new WinTrustFileInfo
        {
            StructSize = (uint)Marshal.SizeOf<WinTrustFileInfo>(),
            FilePath = Marshal.StringToCoTaskMemUni(path),
        };
        var fileInfoPointer = Marshal.AllocCoTaskMem(Marshal.SizeOf<WinTrustFileInfo>());
        try
        {
            Marshal.StructureToPtr(fileInfo, fileInfoPointer, fDeleteOld: false);
            var data = new WinTrustData
            {
                StructSize = (uint)Marshal.SizeOf<WinTrustData>(),
                UiChoice = WtdUiNone,
                RevocationChecks = WtdRevokeNone,
                UnionChoice = WtdChoiceFile,
                File = fileInfoPointer,
                StateAction = WtdStateActionIgnore,
                ProviderFlags = WtdCacheOnlyUrlRetrieval,
            };
            return WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, ref data) == 0;
        }
        finally
        {
            Marshal.FreeCoTaskMem(fileInfoPointer);
            Marshal.FreeCoTaskMem(fileInfo.FilePath);
        }
    }

    /// <summary>WINTRUST_ACTION_GENERIC_VERIFY_V2: the Authenticode policy.</summary>
    private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    private const uint WtdUiNone = 2;
    private const uint WtdRevokeNone = 0;
    private const uint WtdChoiceFile = 1;
    private const uint WtdStateActionIgnore = 0;
    private const uint WtdCacheOnlyUrlRetrieval = 0x1000;

    [StructLayout(LayoutKind.Sequential)]
    private struct WinTrustFileInfo
    {
        public uint StructSize;
        public IntPtr FilePath;
        public IntPtr FileHandle;
        public IntPtr KnownSubject;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WinTrustData
    {
        public uint StructSize;
        public IntPtr PolicyCallbackData;
        public IntPtr SipClientData;
        public uint UiChoice;
        public uint RevocationChecks;
        public uint UnionChoice;
        public IntPtr File;
        public uint StateAction;
        public IntPtr StateData;
        public IntPtr UrlReference;
        public uint ProviderFlags;
        public uint UiContext;
        public IntPtr SignatureSettings;
    }

    [DllImport("wintrust.dll", ExactSpelling = true)]
    private static extern int WinVerifyTrust(IntPtr window, [MarshalAs(UnmanagedType.LPStruct)] Guid action, ref WinTrustData data);
}
