const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

class FileVerifier {
  // Check if file is a valid EPUB (which is a ZIP file)
  async isValidEpub(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        logger.error(`File not found: ${filePath}`);
        return false;
      }

      const buffer = Buffer.alloc(4);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buffer, 0, 4, 0);
      } finally {
        fs.closeSync(fd);
      }

      // EPUB files are ZIP files, check for ZIP signature
      // ZIP signature: 50 4B 03 04 (PK..)
      const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B && 
                    buffer[2] === 0x03 && buffer[3] === 0x04;

      if (!isZip) {
        logger.error(`Invalid EPUB: Not a ZIP file (${filePath})`);
        return false;
      }

      // Additional check: EPUB must contain mimetype file
      const AdmZip = require('adm-zip');
      try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();
        const hasMimetype = entries.some(e => e.entryName === 'mimetype');
        
        if (!hasMimetype) {
          logger.error(`Invalid EPUB: Missing mimetype file (${filePath})`);
          return false;
        }

        logger.info(`Valid EPUB verified: ${filePath}`);
        return true;
      } catch (zipError) {
        logger.error(`Invalid EPUB: Corrupt ZIP (${filePath})`);
        return false;
      }
    } catch (error) {
      logger.error(`EPUB verification error: ${error.message}`);
      return false;
    }
  }

  // Check if file is HTML (common when download fails)
  async isHtmlFile(filePath) {
    try {
      const buffer = Buffer.alloc(100);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buffer, 0, 100, 0);
      } finally {
        fs.closeSync(fd);
      }

      const content = buffer.toString('utf8').toLowerCase();
      return content.includes('<html') || content.includes('<!doctype');
    } catch (error) {
      return false;
    }
  }

  // Verify and rename if needed
  async verifyAndFix(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.epub') {
      const isValid = await this.isValidEpub(filePath);
      
      if (!isValid) {
        const isHtml = await this.isHtmlFile(filePath);
        
        if (isHtml) {
          const htmlPath = filePath.replace(/\.epub$/i, '.html');
          fs.renameSync(filePath, htmlPath);
          logger.warn(`Renamed invalid EPUB to HTML: ${htmlPath}`);
          return { valid: false, reason: 'Downloaded HTML instead of EPUB', newPath: htmlPath };
        }
        
        return { valid: false, reason: 'Corrupt or invalid EPUB file' };
      }
      
      return { valid: true };
    }
    
    return { valid: true }; // Not an EPUB, skip verification
  }
}

module.exports = new FileVerifier();
