// Namespaces used across most of the project, on top of the SDK's implicit usings (System,
// System.Collections.Generic, System.Linq, System.Threading and System.Threading.Tasks). A WPF
// project leaves out System.IO and System.Net.Http, so they are here; the rest are almost all here
// because supervising a child process is the bulk of what this application does.
global using System.ComponentModel;      // Win32Exception, from the job object P/Invokes
global using System.Diagnostics;         // Process, ProcessStartInfo
global using System.IO;                  // File, Path, streams
global using System.Net.Http;            // HttpClient, for reminders and updates
global using System.Runtime.InteropServices; // ExternalException, marshalling attributes
