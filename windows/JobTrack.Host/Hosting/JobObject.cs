using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace JobTrack.Host.Hosting;

/// <summary>
/// A Windows job object that kills everything in it when the last handle closes.
/// </summary>
/// <remarks>
/// This is the answer to the orphaned-node problem. Today <c>bin/jobtrack.js</c> spawns a child
/// and blocks on it, so killing the parent leaves a <c>node.exe</c> holding port 3001 with no tray
/// icon and no obvious way to find it. Here, <c>node.exe</c> is assigned to a job whose handle the
/// host owns for its whole lifetime: when the host exits — cleanly, by crashing, or by End Task
/// from Task Manager — the kernel closes that handle and takes the server down with it. There is
/// no code path that can leak a server, because the guarantee is not made by code.
///
/// A graceful <c>quit</c> over stdin is still tried first (see <see cref="NodeSupervisor"/>) so
/// SQLite gets closed properly; this is the backstop underneath it, not the usual route.
/// </remarks>
internal sealed class JobObject : IDisposable
{
    /// <summary>JOBOBJECTINFOCLASS.JobObjectExtendedLimitInformation.</summary>
    private const int ExtendedLimitInformationClass = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x2000;

    private readonly SafeFileHandle _handle;

    public JobObject()
    {
        _handle = CreateJobObject(IntPtr.Zero, null);
        if (_handle.IsInvalid) throw new InvalidOperationException("CreateJobObject failed.", new Win32Exception());

        var info = new JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new JobObjectBasicLimitInformation { LimitFlags = JobObjectLimitKillOnJobClose },
        };

        var size = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, fDeleteOld: false);
            if (!SetInformationJobObject(_handle, ExtendedLimitInformationClass, buffer, (uint)size))
            {
                throw new InvalidOperationException("SetInformationJobObject failed.", new Win32Exception());
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>
    /// Puts a process in the job. Call it immediately after starting the process — anything the
    /// child spawns before this lands (esbuild, for one) is outside the guarantee.
    /// </summary>
    public void Assign(Process process)
    {
        if (!AssignProcessToJobObject(_handle, process.Handle))
        {
            throw new InvalidOperationException("AssignProcessToJobObject failed.", new Win32Exception());
        }
    }

    public void Dispose() => _handle.Dispose();

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nuint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public nuint ProcessMemoryLimit;
        public nuint JobMemoryLimit;
        public nuint PeakProcessMemoryUsed;
        public nuint PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateJobObject(IntPtr securityAttributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(SafeFileHandle job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);
}
