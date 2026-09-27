const axios = require('axios');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');
const { Indexer } = require('../models');

const runProwlarrSync = async () => {
  try {
    const baseUrl = (await getSetting('prowlarr_url'))?.replace(/\/+$/, '');
    const apiKey = await getSetting('prowlarr_api_key');
    
    if (!baseUrl || !apiKey) return;

    logger.info('Starting Prowlarr Indexer Sync...');
    
    // Fetch indexers from Prowlarr's API
    const { data } = await axios.get(`${baseUrl}/api/v1/indexer`, {
      headers: { 'X-Api-Key': apiKey },
      timeout: 10000
    });

    let added = 0;
    for (const item of data) {
      if (!item.enable) continue;
      
      const protocol = item.protocol === 'torrent' ? 'torrent' : 'usenet';
      // Prowlarr exposes indexers via its own Torznab endpoints
      const indexerUrl = `${baseUrl}/${item.id}/api?apikey=${apiKey}`;

      const [indexer, created] = await Indexer.findOrCreate({
        where: { name: item.name },
        defaults: {
          url: indexerUrl,
          apiKey: apiKey,
          protocol: protocol,
          enabled: true,
          type: item.protocol === 'torrent' ? 'torznab' : 'newznab'
        }
      });

      if (created) {
        added++;
      } else if (indexer.url !== indexerUrl) {
        await indexer.update({ url: indexerUrl, apiKey, type: item.protocol === 'torrent' ? 'torznab' : 'newznab' });
      }
    }

    logger.info(`Prowlarr Sync Complete: added ${added} new indexers.`);
    return { summary: `Added ${added} indexers` };
  } catch (error) {
    logger.error(`Prowlarr Sync error: ${error.message}`);
    throw error;
  }
};

module.exports = runProwlarrSync;
