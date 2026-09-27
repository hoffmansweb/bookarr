const EPub = require('epub');
const path = require('path');
const fs = require('fs');
const ttsService = require('./ttsService');
const logger = require('../config/logger');

class EbookToAudiobookService {
  /**
   * Narrate an EPUB into a chaptered .m4b.
   * @param {object} options  { provider, voiceName, speed, languageCode, meta, coverPath, onProgress }
   */
  async convertToAudiobook(epubPath, outputDir, options = {}) {
    const workDir = path.join(outputDir, `.tts-work`);
    let successState = false;
    try {
      logger.info(`Converting ${epubPath} to audiobook...`);
      fs.mkdirSync(workDir, { recursive: true });

      const chapters = await this.extractChapters(epubPath);
      if (!chapters.length) throw new Error('No readable chapters found in EPUB');
      logger.info(`Found ${chapters.length} chapters`);

      const audioFiles = [];
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        logger.info(`Narrating chapter ${i + 1}/${chapters.length}: ${chapter.title}`);
        if (options.onProgress) options.onProgress({ chapter: i + 1, chapters: chapters.length, percent: Math.round((i / chapters.length) * 90) });

        const chunks = ttsService.splitText(chapter.content);
        const chunkFiles = new Array(chunks.length);
        
        let chunkIndex = 0;
        const CONCURRENCY = 8; // Process 8 chunks at a time in parallel
        
        const workers = new Array(CONCURRENCY).fill(null).map(async () => {
          while (true) {
            const j = chunkIndex++;
            if (j >= chunks.length) break;
            
            const chunkPath = path.join(workDir, `ch${String(i + 1).padStart(3, '0')}_${String(j).padStart(4, '0')}.mp3`);
            
            try {
              const stats = fs.statSync(chunkPath);
              if (stats.size > 0) {
                chunkFiles[j] = { path: chunkPath, title: chapter.title };
                continue; // Skip, already synthesized
              }
            } catch (e) {}
            
            let result;
            let retries = 5;
            let delay = 2000;
            for (let attempt = 1; attempt <= retries; attempt++) {
              result = await ttsService.textToSpeech(chunks[j], chunkPath, options);
              if (result.success) break;
              
              if (attempt < retries) {
                logger.warn(`TTS failed on chapter ${i + 1} chunk ${j + 1} (Attempt ${attempt}/${retries}): ${result.error}. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                delay *= 2; // exponential backoff
              }
            }
            
            if (!result.success) throw new Error(`TTS failed on chapter ${i + 1} chunk ${j + 1} after ${retries} attempts: ${result.error}`);
            chunkFiles[j] = { path: chunkPath, title: chapter.title };
          }
        });
        
        await Promise.all(workers);
        audioFiles.push({ parts: chunkFiles, title: chapter.title });
      }

      // Flatten chunks into one input list; each chapter starts at its first chunk
      const { convertToM4b } = require('./audiobookPipeline');
      const flat = [];
      audioFiles.forEach(ch => ch.parts.forEach((p, k) => flat.push({ path: p.path, title: ch.title, first: k === 0 })));
      const m4bPath = path.join(outputDir, `${options.fileName || 'audiobook'}.m4b`);
      const result = await convertToM4b({
        bookId: options.bookId || 'tts',
        files: flat,
        meta: { genre: 'Audiobook', comment: 'Narrated with text-to-speech', ...(options.meta || {}) },
        coverPath: options.coverPath || null,
        outPath: m4bPath,
        workDir,
        mergeByTitle: true
      });

      logger.info(`Audiobook created: ${m4bPath}`);
      return { success: true, path: m4bPath, chapters: result.chapters, duration: result.duration };
    } catch (error) {
      logger.error(`Conversion error: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      if (successState) {
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch(e){}
      }
    }
  }

  extractChapters(epubPath) {
    return new Promise((resolve, reject) => {
      const epub = new EPub(epubPath);
      
      epub.on('end', async () => {
        try {
          const chapters = [];
          
          for (const item of epub.flow) {
            const content = await this.getChapterContent(epub, item.id);
            
            if (content && content.trim().length > 100) {
              chapters.push({
                id: item.id,
                title: item.title || `Chapter ${chapters.length + 1}`,
                content: this.cleanText(content)
              });
            }
          }
          
          resolve(chapters);
        } catch (error) {
          reject(error);
        }
      });
      
      epub.on('error', reject);
      epub.parse();
    });
  }

  getChapterContent(epub, chapterId) {
    return new Promise((resolve, reject) => {
      epub.getChapter(chapterId, (error, text) => {
        if (error) reject(error);
        else resolve(text);
      });
    });
  }

  cleanText(html) {
    // Remove HTML tags
    let text = html.replace(/<[^>]*>/g, ' ');
    
    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'");
    
    // Remove extra whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }
}

module.exports = new EbookToAudiobookService();
