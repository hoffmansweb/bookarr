const Mobi = require('mobi');
const EPub = require('epub-gen');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

class MobiConverter {
  async convertToEpub(mobiPath) {
    const epubPath = mobiPath.replace(/\.mobi$/i, '.epub');
    
    try {
      logger.info(`Converting MOBI to EPUB: ${mobiPath}`);
      
      const mobi = new Mobi(mobiPath);
      await mobi.parse();
      
      const content = mobi.flow();
      const metadata = mobi.metadata();
      
      const option = {
        title: metadata.title || 'Unknown',
        author: metadata.author || 'Unknown',
        content: [{ data: content.toString() }]
      };
      
      await new EPub(option, epubPath).promise;
      
      if (fs.existsSync(epubPath)) {
        logger.info(`Conversion successful: ${epubPath}`);
        fs.unlinkSync(mobiPath);
        return epubPath;
      }
      
      logger.error('Conversion failed');
      return mobiPath;
    } catch (error) {
      logger.error(`MOBI conversion error: ${error.message}`);
      return mobiPath;
    }
  }
}

module.exports = new MobiConverter();
