const axios = require('axios');
const logger = require('../config/logger');
const { getSetting } = require('../controllers/settingsController');

const sendWebhook = async (title, message, coverUrl) => {
  try {
    const webhookUrl = await getSetting('discord_webhook_url');
    if (!webhookUrl) return;

    const payload = {
      embeds: [{
        title: title,
        description: message,
        color: 3447003, // blue
        thumbnail: coverUrl ? { url: coverUrl } : undefined,
        timestamp: new Date().toISOString()
      }]
    };

    await axios.post(webhookUrl, payload, { timeout: 5000 });
    logger.info(`Discord webhook sent: ${title}`);
  } catch (error) {
    logger.error(`Webhook failed: ${error.message}`);
  }
};

module.exports = { sendWebhook };
