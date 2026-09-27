# Bookarr Windows Installation Guide

## Quick Install (Recommended)

### Option 1: Simple Installation
1. Double-click `install.bat`
2. Wait for installation to complete
3. Edit `backend\.env` with your settings
4. Double-click `start-bookarr.bat` to launch
5. Access at http://localhost:3000

### Option 2: Professional Installer (Inno Setup)
1. Install [Inno Setup](https://jrsoftware.org/isdl.php)
2. Open `bookarr-installer.iss` in Inno Setup
3. Click "Compile" to create installer
4. Run the generated `BookarrSetup.exe`
5. Follow the installation wizard

## Prerequisites

- **Node.js** (v16 or higher) - [Download](https://nodejs.org/)
- **Windows 10/11** or Windows Server 2016+

## Installation Methods

### Method 1: Batch Script Installation

Run `install.bat` which will:
- Check for Node.js
- Install backend dependencies
- Install frontend dependencies
- Build frontend for production
- Create desktop shortcuts
- Set up configuration files

### Method 2: Manual Installation

```batch
REM Backend
cd backend
npm install
copy .env.example .env
REM Edit .env file

REM Frontend
cd ..\frontend
npm install --legacy-peer-deps
npm run build

REM Install serve globally
npm install -g serve
```

### Method 3: Windows Service (Auto-start)

To run Bookarr as a Windows service:

```batch
REM Install node-windows globally
npm install -g node-windows

REM Run service installer as Administrator
install-service.bat
```

This will:
- Install Bookarr as a Windows service
- Start automatically with Windows
- Run in the background
- Restart automatically if it crashes

To uninstall the service:
```batch
cd backend
node uninstall-service.js
```

## Configuration

Edit `backend\.env` file:

```env
PORT=5000
JWT_SECRET=
GOOGLE_BOOKS_API_KEY=your-api-key-here
```

Leave `JWT_SECRET` blank (or delete the line) and Bookarr generates a random secret on first start,
stored in `backend\.jwt_secret` next to the database. Placeholder values copied from the example
files — `<your-secure-random-secret-here>`, `your-secret-key-here` and friends — are ignored,
because a signing key that is published in the docs would let anyone forge a login token.

## Running Bookarr

### Start Application
- Double-click `start-bookarr.bat`, or
- Use desktop shortcut "Start Bookarr"

### Stop Application
- Double-click `stop-bookarr.bat`, or
- Use desktop shortcut "Stop Bookarr"

### Access Application
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

## Troubleshooting

### Port Already in Use
Edit `backend\.env` and change `PORT=5000` to another port.

### Node.js Not Found
Install Node.js from https://nodejs.org/ and restart your computer.

### Installation Fails
Run Command Prompt as Administrator and try again.

### Frontend Won't Start
Install serve globally:
```batch
npm install -g serve
```

## Uninstallation

### If installed via Inno Setup:
- Use Windows "Add or Remove Programs"

### If installed via batch script:
1. Run `stop-bookarr.bat`
2. Delete the Bookarr folder
3. Remove desktop shortcuts

### If installed as service:
```batch
cd backend
node uninstall-service.js
```

## Building the Installer

To create a distributable installer:

1. Install [Inno Setup](https://jrsoftware.org/isdl.php)
2. Open `bookarr-installer.iss`
3. Click "Build" → "Compile"
4. Find `BookarrSetup.exe` in `installer-output` folder
5. Distribute this single executable

## Firewall Configuration

Windows may prompt to allow Node.js through the firewall. Click "Allow" for both private and public networks.

## Updates

To update Bookarr:
1. Stop the application
2. Pull latest changes or download new version
3. Run `install.bat` again
4. Restart the application

## Support

For issues and questions:
- Check README.md
- Check TIPS_AND_TROUBLESHOOTING.md
- Open an issue on GitHub
