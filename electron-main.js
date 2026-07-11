import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

async function createWindow() {
  // Create the native browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'PD Investigation Dashboard',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Remove the default menu bar for a cleaner look
  mainWindow.setMenuBarVisibility(false);

  // Inject the true Downloads folder path so the Express backend knows where it is
  // (This is much more reliable than os.homedir() if the user moved their Downloads to OneDrive or D: drive)
  process.env.ELECTRON_DOWNLOADS_PATH = app.getPath('downloads');

  // Start the Express server on a guaranteed free port
  try {
    const { default: appModule } = await import('./server/server.js');
    
    // Listen on port 0 to let the OS assign a random open port
    const server = appModule.listen(0, () => {
      const port = server.address().port;
      console.log(`Express backend started successfully inside Electron on port ${port}.`);
      
      // Load the UI using the dynamically assigned port
      mainWindow.loadURL(`http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to start Express server inside Electron:', error);
    // As a fallback, try to load it anyway in case it was already running externally
    mainWindow.loadURL('http://localhost:3000');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
    process.exit(0); // Ensure the Node process terminates so Express stops
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
