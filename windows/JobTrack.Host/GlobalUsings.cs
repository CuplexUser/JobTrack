// Namespaces used across most of the project. WinForms' implicit usings cover System,
// System.Drawing, System.IO, System.Linq, System.Threading and System.Windows.Forms; these are the
// ones this application needs on top of that, and they are almost all here because supervising a
// child process is the bulk of what it does.
global using System.ComponentModel;      // Win32Exception, from the job object P/Invokes
global using System.Diagnostics;         // Process, ProcessStartInfo
global using System.Runtime.InteropServices; // ExternalException, marshalling attributes
