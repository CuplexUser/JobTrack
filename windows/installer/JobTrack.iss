; JobTrack Windows installer.
;
; Built by .github/workflows/windows-release.yml:
;   ISCC.exe /DAppVersion=1.0.11 windows\installer\JobTrack.iss
;
; The defining constraint is PrivilegesRequired=lowest. Everything JobTrack touches is per-user --
; the install goes under %LOCALAPPDATA%\Programs, autostart is an HKCU Run value, and the data
; directory is %APPDATA%\jobtrack -- so there is no reason to ask for admin, and asking would put a
; UAC prompt in front of a tool somebody just wants to run. No elevation at any point, including
; the uninstaller.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "JobTrack"
#define AppPublisher "CuplexUser"
#define AppUrl "https://github.com/CuplexUser/JobTrack"

[Setup]
; Never change AppId. It is what makes an install an upgrade rather than a second copy.
AppId={{B3F5A9C2-7E14-4D6B-9A83-1C0E5F72D48A}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
VersionInfoVersion={#AppVersion}

DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto

PrivilegesRequired=lowest
; Empty on purpose: no "install for all users" option, because nothing here is machine-wide.
PrivilegesRequiredOverridesAllowed=
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

OutputDir=Output
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
LZMANumBlockThreads=4
; ISCC itself is 32-bit, and an ultra64 dictionary over a solid ~300 MB payload runs it out of
; address space. This hands the compression to a separate 64-bit process, which has the headroom.
LZMAUseSeparateProcess=yes

LicenseFile=..\..\LICENSE
SetupIconFile=..\..\apps\web\public\favicon.ico
UninstallDisplayIcon={app}\JobTrack.exe
UninstallDisplayName={#AppName}
WizardStyle=modern
; We stop the running instance ourselves in PrepareToInstall, which is more reliable than Inno's
; window-based detection for a process whose only window is a tray icon.
CloseApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Start {#AppName} when I sign in"; GroupDescription: "Startup:"
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
; payload\host is the published .NET output; payload\node and payload\app come from
; windows/scripts/build-payload.mjs.
Source: "payload\host\*"; DestDir: "{app}";       Flags: recursesubdirs createallsubdirs ignoreversion
Source: "payload\node\*"; DestDir: "{app}\node";  Flags: recursesubdirs createallsubdirs ignoreversion
Source: "payload\app\*";  DestDir: "{app}\app";   Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\JobTrack.exe"
Name: "{autodesktop}\{#AppName}";  Filename: "{app}\JobTrack.exe"; Tasks: desktopicon

[Registry]
; The same key and value name apps/tray/src/autostart.ts uses, so installing over an
; `npm install -g jobtrack` replaces its entry instead of leaving two copies fighting for the port.
; --autostart tells the app it was launched at sign-in rather than by a person.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; \
  ValueName: "JobTrack"; ValueData: """{app}\JobTrack.exe"" --autostart"; \
  Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\JobTrack.exe"; Description: "Start {#AppName} now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Ours, not the user's: no need to ask.
Type: filesandordirs; Name: "{localappdata}\{#AppName}"

[Code]
const
  QuitTimeoutSeconds = 15;

// Stops a running JobTrack before the files it has open are replaced or deleted.
//
// JobTrack.exe --quit signals a named event the running instance listens on, waits for it to go,
// and returns a non-zero exit code if it did not. Without this, an upgrade over a running copy
// fails partway through with JobTrack.exe and libvips-42.dll locked.
function StopRunningApp(): Boolean;
var
  Exe: string;
  ResultCode: Integer;
begin
  Result := True;
  Exe := ExpandConstant('{app}\JobTrack.exe');
  if not FileExists(Exe) then
    Exit;

  if Exec(Exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0) then
    Exit;

  // It ignored us, or it was wedged. Kill it -- the job object it holds takes node.exe with it,
  // which is exactly the case that guarantee exists for.
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM JobTrack.exe /F', '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);
  Sleep(1000);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  NeedsRestart := False;
  StopRunningApp();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningApp();
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: string;
begin
  if CurUninstallStep <> usPostUninstall then
    Exit;

  // uninsdeletevalue above only covers the value if the autostart task was ticked at install time,
  // and the tray can turn it on later. Delete it unconditionally.
  RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'JobTrack');

  // The database is the user's work, and it is shared with any npm-installed copy. Never remove it
  // without asking, never default to Yes, and never touch it during a silent uninstall.
  DataDir := ExpandConstant('{userappdata}\jobtrack');
  if DirExists(DataDir) and (not UninstallSilent) then
  begin
    if MsgBox('Also delete your JobTrack data?' + #13#10#13#10 +
              DataDir + #13#10#13#10 +
              'This is your applications database, settings and downloaded search model. ' +
              'It cannot be undone.',
              mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(DataDir, True, True, True);
  end;
end;
