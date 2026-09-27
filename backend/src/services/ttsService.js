const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../config/logger');

class TTSService {
  constructor() {
    this.hasGoogle = !!process.env.GOOGLE_TTS_KEY_PATH || !!process.env.GOOGLE_TTS_API_KEY;
    this.hasOpenAI = !!process.env.OPENAI_API_KEY;
    this.hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
    
    if (this.hasGoogle) {
      if (process.env.GOOGLE_TTS_KEY_PATH) {
        this.googleClient = new textToSpeech.TextToSpeechClient({
          keyFilename: process.env.GOOGLE_TTS_KEY_PATH
        });
      } else {
        this.googleClient = new textToSpeech.TextToSpeechClient({
          apiKey: process.env.GOOGLE_TTS_API_KEY
        });
      }
    }
    
    logger.info(`TTS providers: OpenAI=${this.hasOpenAI}, ElevenLabs=${this.hasElevenLabs}, Google=${this.hasGoogle}`);
  }

  async textToSpeech(text, outputPath, options = {}) {
    const provider = await this.resolveProvider(options.provider, options.voiceName);

    switch(provider) {
      case 'openai-compatible':
      case 'kokoro':
        return await this.openAICompatibleTTS(text, outputPath, options);
      case 'elevenlabs':
        return await this.elevenLabsTTS(text, outputPath, options);
      case 'openai':
        return await this.openAITTS(text, outputPath, options);
      case 'google':
        return await this.googleTTS(text, outputPath, options);
      default:
        return await this.systemTTS(text, outputPath, options);
    }
  }

  async elevenLabsTTS(text, outputPath, options = {}) {
    if (!this.hasElevenLabs) {
      logger.warn('ElevenLabs API key not configured');
      return { success: false, error: 'ElevenLabs API key required' };
    }

    try {
      const voiceId = options.voiceName || 'EXAVITQu4vr4xnSDxMaL'; // Sarah voice
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: options.speed || 1.0
          }
        },
        {
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );

      await fs.promises.writeFile(outputPath, response.data);
      logger.info(`Generated audio with ElevenLabs: ${outputPath}`);
      return { success: true, path: outputPath };
    } catch (error) {
      logger.error('ElevenLabs TTS error:', error.message);
      return { success: false, error: error.message };
    }
  }

  async openAITTS(text, outputPath, options = {}) {
    if (!this.hasOpenAI) {
      logger.warn('OpenAI API key not configured');
      return { success: false, error: 'OpenAI API key required' };
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        {
          model: 'tts-1-hd',
          voice: options.voiceName || 'alloy',
          input: text,
          speed: options.speed || 1.0
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );

      await fs.promises.writeFile(outputPath, response.data);
      logger.info(`Generated audio with OpenAI: ${outputPath}`);
      return { success: true, path: outputPath };
    } catch (error) {
      logger.error('OpenAI TTS error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Pick a provider that can actually run. Users default to 'google' in the DB, so if the
   * requested cloud provider has no key but the local Kokoro server is up, use Kokoro.
   * A reader-style "oai:" voice always means the local server.
   */
  async resolveProvider(requested, voiceName) {
    const openaiTts = require('./openaiTts');
    if (String(voiceName || '').startsWith('oai:')) return 'openai-compatible';
    const configured = {
      google: this.hasGoogle,
      openai: this.hasOpenAI,
      elevenlabs: this.hasElevenLabs,
      'openai-compatible': await openaiTts.isConfigured(),
      kokoro: await openaiTts.isConfigured()
    };
    if (requested && configured[requested]) return requested;
    if (await openaiTts.isAvailable()) return 'openai-compatible';
    return requested || 'google';
  }

  async openAICompatibleTTS(text, outputPath, options = {}) {
    const openaiTts = require('./openaiTts');
    try {
      // Cloud voice names (e.g. en-US-Neural2-J) don't exist on Kokoro; map to a real voice
      const voice = await openaiTts.resolveVoice(options.voiceName);
      await openaiTts.speak(text, outputPath, { voice, speed: options.speed });
      return { success: true, path: outputPath };
    } catch (error) {
      const detail = error.response ? `HTTP ${error.response.status}` : error.message;
      logger.error(`OpenAI-compatible TTS error: ${detail}`);
      return { success: false, error: detail };
    }
  }

  async googleTTS(text, outputPath, options = {}) {
    if (!this.hasGoogle) {
      logger.warn('Google TTS not configured');
      return { success: false, error: 'Google TTS key required' };
    }

    try {
      const request = {
        input: { text },
        voice: {
          languageCode: options.languageCode || 'en-US',
          name: options.voiceName || 'en-US-Neural2-J',
          ssmlGender: options.gender || 'MALE'
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: options.speed || 1.0,
          pitch: options.pitch || 0.0
        }
      };

      const [response] = await this.googleClient.synthesizeSpeech(request);
      await fs.promises.writeFile(outputPath, response.audioContent, 'binary');
      
      logger.info(`Generated audio with Google: ${outputPath}`);
      return { success: true, path: outputPath };
    } catch (error) {
      logger.error('Google TTS error:', error.message);
      return { success: false, error: error.message };
    }
  }

  async systemTTS(text, outputPath, options = {}) {
    try {
      const say = require('say');
      
      await new Promise((resolve, reject) => {
        say.export(text, null, options.speed || 1.0, outputPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      logger.info(`Generated audio: ${outputPath}`);
      return { success: true, path: outputPath };
    } catch (error) {
      logger.error('System TTS error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Split text into chunks (Google TTS has 5000 char limit)
  splitText(text, maxLength = 4500) {
    const chunks = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    let currentChunk = '';
    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxLength) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }
    
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
  }

  async getVoices(provider = 'google') {
    if (provider === 'openai-compatible' || provider === 'kokoro') {
      const openaiTts = require('./openaiTts');
      return (await openaiTts.listVoices()).map(id => ({ id, name: openaiTts.describeVoice(id) }));
    }

    const voices = {
      openai: [
        { id: 'alloy', name: 'Alloy (Neutral)', gender: 'neutral' },
        { id: 'echo', name: 'Echo (Male)', gender: 'male' },
        { id: 'fable', name: 'Fable (British Male)', gender: 'male' },
        { id: 'onyx', name: 'Onyx (Deep Male)', gender: 'male' },
        { id: 'nova', name: 'Nova (Female)', gender: 'female' },
        { id: 'shimmer', name: 'Shimmer (Soft Female)', gender: 'female' }
      ],
      elevenlabs: [
        { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Female)', gender: 'female' },
        { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Male)', gender: 'male' },
        { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Male)', gender: 'male' },
        { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold (Male)', gender: 'male' },
        { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (Female)', gender: 'female' },
        { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy (Female)', gender: 'female' }
      ],
      google: [
        { id: 'en-US-Neural2-J', name: 'US Male (Neural)', gender: 'male' },
        { id: 'en-US-Neural2-F', name: 'US Female (Neural)', gender: 'female' },
        { id: 'en-GB-Neural2-B', name: 'UK Male (Neural)', gender: 'male' },
        { id: 'en-GB-Neural2-C', name: 'UK Female (Neural)', gender: 'female' }
      ]
    };
    
    return voices[provider] || [];
  }
}

module.exports = new TTSService();
