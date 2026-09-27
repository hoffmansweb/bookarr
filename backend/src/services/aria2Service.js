const axios = require('axios');

class Aria2Service {
  constructor(client) {
    this.host = client.host;
    this.port = client.port || 6800;
    this.secret = client.apiKey || '';
    this.useSsl = client.useSsl;
    this.baseUrl = `${this.useSsl ? 'https' : 'http'}://${this.host}:${this.port}/jsonrpc`;
  }

  async callRPC(method, params = []) {
    try {
      const payload = {
        jsonrpc: '2.0',
        id: Date.now().toString(),
        method: method,
        params: params
      };
      
      // Only add token if secret is set
      if (this.secret) {
        payload.params = [`token:${this.secret}`, ...params];
      }
      
      const response = await axios.post(this.baseUrl, payload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return { success: true, data: response.data.result };
    } catch (error) {
      console.error(`[aria2] RPC call failed (${method}):`, error.message);
      if (error.response) {
        console.error('[aria2] Response data:', error.response.data);
      }
      return { success: false, error: error.message, code: error.code };
    }
  }

  async addUri(url, options = {}) {
    try {
      const opts = {
        out: options.out || options.filename || '',
        dir: options.dir || '',
        header: [
          'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept: */*'
        ],
        ...options
      };
      
      // Remove empty values
      Object.keys(opts).forEach(key => {
        if (opts[key] === '' || opts[key] === undefined) {
          delete opts[key];
        }
      });

      const result = await this.callRPC('aria2.addUri', [[url], opts]);
      
      if (result.success) {
        console.log('[aria2] Download added, GID:', result.data);
        return { success: true, gid: result.data };
      }
      
      return result;
    } catch (error) {
      console.error('[aria2] Add URI failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async tellStatus(gid) {
    try {
      const result = await this.callRPC('aria2.tellStatus', [gid]);
      
      if (result.success) {
        const status = result.data;
        const totalLength = parseInt(status.totalLength) || 0;
        const completedLength = parseInt(status.completedLength) || 0;
        const percentage = totalLength > 0 ? (completedLength / totalLength) * 100 : 0;
        
        return {
          success: true,
          status: status.status,
          percentage: percentage.toFixed(2),
          downloadSpeed: parseInt(status.downloadSpeed) || 0,
          completedLength,
          totalLength,
          files: status.files
        };
      }
      
      return result;
    } catch (error) {
      console.error('[aria2] Tell status failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async tellActive() {
    try {
      const result = await this.callRPC('aria2.tellActive');
      return result;
    } catch (error) {
      console.error('[aria2] Tell active failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async tellStopped(offset = 0, num = 100) {
    try {
      const result = await this.callRPC('aria2.tellStopped', [offset, num]);
      return result;
    } catch (error) {
      console.error('[aria2] Tell stopped failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async remove(gid) {
    try {
      const result = await this.callRPC('aria2.remove', [gid]);
      return result;
    } catch (error) {
      console.error('[aria2] Remove failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async purgeDownloadResult(gid) {
    try {
      const result = await this.callRPC('aria2.removeDownloadResult', [gid]);
      return result;
    } catch (error) {
      console.error('[aria2] Purge failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async purgeAll() {
    try {
      const result = await this.callRPC('aria2.purgeDownloadResult');
      return result;
    } catch (error) {
      console.error('[aria2] Purge all failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testConnection() {
    try {
      const result = await this.callRPC('aria2.getVersion');
      
      if (result.success) {
        return { success: true, message: `aria2 ${result.data.version} is accessible` };
      }
      
      if (result.code === 'ECONNREFUSED') {
        return { success: false, error: 'Connection refused. Make sure aria2c is running with --enable-rpc' };
      }
      return { success: false, error: result.error };
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        return { 
          success: false, 
          error: 'Connection refused. Make sure aria2c is running with --enable-rpc' 
        };
      }
      return { success: false, error: error.message };
    }
  }
}

module.exports = Aria2Service;
