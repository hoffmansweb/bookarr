[Setup]
AppName=Bookarr
AppVersion=1.0.0
AppPublisher=Bookarr
AppPublisherURL=https://github.com/yourusername/bookarr
DefaultDirName={autopf}\Bookarr
DefaultGroupName=Bookarr
OutputDir=installer-output
OutputBaseFilename=BookarrSetup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
SetupIconFile=compiler:SetupClassicIcon.ico
UninstallDisplayIcon={app}\bookarr.ico
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"
Name: "startupicon"; Description: "Start Bookarr with &Windows"; GroupDescription: "Startup:"

[Files]
Source: "backend\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "frontend\build\*"; DestDir: "{app}\frontend\build"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "start-bookarr.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "stop-bookarr.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme

[Icons]
Name: "{group}\Bookarr"; Filename: "{app}\start-bookarr.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 165
Name: "{group}\Stop Bookarr"; Filename: "{app}\stop-bookarr.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 132
Name: "{group}\Uninstall Bookarr"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Bookarr"; Filename: "{app}\start-bookarr.bat"; IconFilename: "{sys}\shell32.dll"; IconIndex: 165; Tasks: desktopicon
Name: "{autostartup}\Bookarr"; Filename: "{app}\start-bookarr.bat"; Tasks: startupicon

[Run]
Filename: "{cmd}"; Parameters: "/c cd /d ""{app}\backend"" && npm install --production"; StatusMsg: "Installing backend dependencies..."; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c cd /d ""{app}\frontend"" && npm install -g serve"; StatusMsg: "Installing frontend server..."; Flags: runhidden
Filename: "{app}\start-bookarr.bat"; Description: "Launch Bookarr"; Flags: postinstall shellexec skipifsilent

[UninstallRun]
Filename: "{app}\stop-bookarr.bat"; Flags: runhidden

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if not RegKeyExists(HKEY_LOCAL_MACHINE, 'SOFTWARE\Node.js') then
  begin
    if MsgBox('Node.js is required but not installed. Do you want to download it now?', mbConfirmation, MB_YESNO) = IDYES then
    begin
      ShellExec('open', 'https://nodejs.org/', '', '', SW_SHOW, ewNoWait, ResultCode);
    end;
    Result := False;
  end;
end;
