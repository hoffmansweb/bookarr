const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

// Look for ebook-convert in the standard Calibre installation path on Windows
const CALIBRE_PATH = 'C:\\Program Files\\Calibre2\\ebook-convert.exe';

class EbookConverter {
  async convertToEpub(sourcePath) {
    if (!fs.existsSync(CALIBRE_PATH)) {
      throw new Error('Calibre is not installed at the default location. Auto-conversion skipped.');
    }

    const epubPath = sourcePath.replace(/\.[^/.]+$/, '.epub');
    
    return new Promise((resolve, reject) => {
      logger.info(`Starting Calibre conversion: ${sourcePath} -> .epub`);
      
      const process = spawn(CALIBRE_PATH, [sourcePath, epubPath]);
      
      let errorOutput = '';
      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0 && fs.existsSync(epubPath)) {
          logger.info(`Conversion successful: ${epubPath}`);
          // Remove the original non-epub file
          fs.unlink(sourcePath, () => {});
          resolve(epubPath);
        } else {
          logger.error(`Calibre conversion failed with code ${code}. ${errorOutput}`);
          reject(new Error(`Calibre conversion failed: ${errorOutput}`));
        }
      });
      
      process.on('error', (err) => {
        logger.error(`Failed to launch ebook-convert: ${err.message}`);
        reject(err);
      });
    });
  }
}

module.exports = new EbookConverter();
