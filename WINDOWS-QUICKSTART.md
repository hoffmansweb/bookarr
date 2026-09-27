# Bookarr - Quick Start for Windows

## Installation (Choose One Method)

### 🚀 Method 1: Simple Install (Recommended)
1. Double-click `install.bat`
2. Wait for installation
3. Edit `backend\.env` if needed
4. Double-click `start-bookarr.bat`
5. Open http://localhost:3000

### 📦 Method 2: Professional Installer
1. Download and install [Inno Setup](https://jrsoftware.org/isdl.php)
2. Right-click `bookarr-installer.iss` → Compile
3. Run `installer-output\BookarrSetup.exe`
4. Follow wizard

### 🔧 Method 3: Windows Service (Auto-start)
```batch
npm install -g node-windows
install-service.bat
```

## Usage

**Start:** Double-click `start-bookarr.bat` or desktop shortcut
**Stop:** Double-click `stop-bookarr.bat`
**Access:** http://localhost:3000

## Files Overview

- `install.bat` - Main installer
- `start-bookarr.bat` - Start application
- `stop-bookarr.bat` - Stop application
- `install-service.bat` - Install as Windows service
- `create-portable-package.bat` - Create distributable package
- `bookarr-installer.iss` - Inno Setup installer script

## Requirements

- Windows 10/11
- Node.js v16+ ([Download](https://nodejs.org/))

## Troubleshooting

**Port in use?** Edit `backend\.env` and change PORT
**Node not found?** Install Node.js and restart PC
**Permission error?** Run as Administrator

See `INSTALL.md` for detailed instructions.
