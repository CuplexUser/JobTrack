using Microsoft.Win32;

namespace JobTrack.Host.Config;

/// <summary>
/// The "start JobTrack when I sign in" toggle, as a per-user registry Run value.
/// </summary>
/// <remarks>
/// The same key and the same value name <c>apps/tray/src/autostart.ts</c> uses, so an install that
/// follows an <c>npm install -g jobtrack</c> replaces that entry rather than adding a second one
/// that would fight it for the port.
///
/// What changes is what the value points at. The npm version registers
/// <c>"&lt;node.exe&gt;" "&lt;package&gt;\bin\jobtrack.js"</c>, which has two problems: <c>node.exe</c>
/// is a console-subsystem binary, so signing in opens a console window; and it bakes in whichever
/// <c>node.exe</c> happened to be running when the box was ticked, so upgrading or moving Node
/// breaks autostart silently. Pointing at this application's own GUI-subsystem exe fixes both.
///
/// HKCU, never HKLM: no admin rights, and it survives a reinstall because it is not tied to the
/// install location.
/// </remarks>
internal static class Autostart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "JobTrack";

    /// <summary>Marks a launch as coming from sign-in rather than from a person clicking.</summary>
    public const string AutostartSwitch = "--autostart";

    public static bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) is string value && value.Contains("JobTrack.exe", StringComparison.OrdinalIgnoreCase);
        }
    }

    public static void Enable()
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
        var exe = Environment.ProcessPath ?? Path.Combine(Paths.InstallDir, "JobTrack.exe");
        key.SetValue(ValueName, $"\"{exe}\" {AutostartSwitch}", RegistryValueKind.String);
    }

    public static void Disable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        // DeleteValue throws when the value is absent unless told not to, and "already off" is a
        // perfectly ordinary state to ask for.
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }

    public static void Set(bool enabled)
    {
        if (enabled) Enable();
        else Disable();
    }
}
