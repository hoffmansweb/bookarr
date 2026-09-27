const axios = require('axios');

class JDownloader2Service {
  constructor(client) {
    this.host = client.host;
    this.port = client.port || 9666;
    this.useSsl = client.useSsl;
    this.baseUrl = `${this.useSsl ? 'https' : 'http'}://${this.host}:${this.port}`;
  }

  async addLinks(urls, packageName = 'Bookarr') {
    try {
      const linksArray = Array.isArray(urls) ? urls : [urls];
      const linksText = linksArray.join('\r\n');
      
      // Try Click'n'Load first
      try {
        const params = new URLSearchParams();
        params.append('crypted', Buffer.from(linksText).toString('base64'));
        params.append('jk', 'function f(){ return \'\';} f();');
        params.append('passwords', '');
        params.append('source', 'Bookarr');
        params.append('package', packageName);
        
        const https = require('https');
        const response = await axios.post(
          `${this.baseUrl}/flash/addcrypted2`,
          params.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000,
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
          }
        );
        
        console.log('[JDownloader2] Links added via Click\'n\'Load');
        return { success: true, data: response.data };
      } catch (clickError) {
        console.log('[JDownloader2] Click\'n\'Load failed, trying folder watch method');
        
        // Fallback: Create .crawljob file for folder watch
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        // Try common JDownloader2 folder watch locations
        const possiblePaths = [
          path.join(os.homedir(), 'JDownloader', 'folderwatch'),
          path.join(os.homedir(), 'JDownloader 2.0', 'folderwatch'),
          'C:\\JDownloader\\folderwatch',
          'C:\\JDownloader 2.0\\folderwatch'
        ];
        
        let folderWatchPath = null;
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            folderWatchPath = p;
            break;
          }
        }
        
        if (folderWatchPath) {
          const crawlJobContent = {
            text: linksText,
            packageName: packageName,
            autoStart: true,
            autoConfirm: true
          };
          
          const fileName = `bookarr_${Date.now()}.crawljob`;
          const filePath = path.join(folderWatchPath, fileName);
          
          fs.writeFileSync(filePath, JSON.stringify(crawlJobContent));
          console.log('[JDownloader2] Created crawljob file:', filePath);
          return { success: true, method: 'folderwatch' };
        }
        
        throw new Error('Both Click\'n\'Load and folder watch failed');
      }
    } catch (error) {
      console.error('[JDownloader2] Add links failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async getDownloads() {
    // Click'n'Load doesn't provide download status
    return [];
  }

  async testConnection() {
    try {
      const https = require('https');
      const response = await axios.get(`${this.baseUrl}/flash/`, {
        timeout: 5000,
        validateStatus: () => true,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      });
      
      if (response.status === 200 || response.status === 404 || response.status === 500) {
        return { success: true, message: 'JDownloader2 Click\'n\'Load is accessible on port ' + this.port };
      }
      
      return { success: false, error: `Unexpected status: ${response.status}` };
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        return { 
          success: false, 
          error: `Connection refused on port ${this.port}. Make sure JDownloader2 is running and Click'n'Load is enabled (should be on port 9666 by default).` 
        };
      }
      return { success: false, error: error.message };
    }
  }
}

module.exports = JDownloader2Service;
