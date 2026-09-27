const ytdlp = require('../utils/ytdlp');
const logger = require('../config/logger');

class YouTubeScraper {
  async search(title, author) {
    try {
      // Both queries, 20 results each, in parallel: most hits are shorts/trailers that get
      // filtered out, so searching only 8 (and stopping after the first query) left almost nothing
      const queries = [
        `"${title}" ${author} audiobook`,
        `${title} ${author} full audiobook unabridged`
      ];
      const settled = await Promise.allSettled(queries.map(query => {
        logger.info(`YouTube search: ${query}`);
        return ytdlp.run('ytsearch20:' + query, { dumpSingleJson: true, noDownload: true, noWarnings: true, flatPlaylist: true });
      }));
      const seen = new Set();
      const allResults = [];
      settled.forEach(s => {
        if (s.status !== 'fulfilled') { logger.warn(`YouTube search failed: ${ytdlp.describeError(s.reason)}`); return; }
        for (const e of s.value?.entries || []) {
          if (e?.id && !seen.has(e.id)) { seen.add(e.id); allResults.push(e); }
        }
      });

      const norm = (s) => ` ${String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
      const titlePhrase = norm(String(title).replace(/\s*[([].*?[)\]]\s*/g, ' ').split(/:\s| - /)[0]);
      const surname = norm(author).trim().split(' ').filter(w => w.length > 1).pop();
      // Videos that mention the book but aren't a reading of it
      const NOT_AUDIOBOOK = /\b(ambien(ce|t)|soundscape|asmr|playlist|music|song|lyrics|trailer|teaser|review|reaction|summary|recap|explained|analysis|book talk|booktube|podcast|ep\.?\s*\d+|episode\s*\d+|interview|unboxing|haul|movie|film|clip|scene|sample|preview|learn english|english stories|stories with levels|graded reader|level \d|[abc][12] (level|advanced|intermediate|beginner)|chapter\s*1\b\s*(only)?)\b/i;

      // Count why videos were dropped so the log says whether YouTube has this audiobook
      const rejected = { short: 0, title: 0, notAudiobook: 0, author: 0 };
      const kept = allResults.filter(e => {
        if (!(e.duration > 1800)) { rejected.short++; return false; }  // at least 30 min
        const t = norm(e.title);
        if (!t.includes(titlePhrase)) { rejected.title++; return false; } // the title as a phrase
        if (NOT_AUDIOBOOK.test(e.title || '')) { rejected.notAudiobook++; return false; }
        // Author named in the title or channel, or the video says it's an audiobook
        const mentionsAuthor = surname && (t.includes(` ${surname} `) || norm(e.channel || e.uploader).includes(` ${surname} `));
        if (mentionsAuthor || /audio ?book|unabridged|narrated|read by/i.test(e.title || '')) return true;
        rejected.author++;
        return false;
      });
      logger.info(`YouTube "${title}": ${kept.length ? `${kept.length} full audiobook(s) found` : 'no full audiobook found'}`
        + ` (${allResults.length} videos checked; skipped ${rejected.short} under 30 min, ${rejected.title} other titles,`
        + ` ${rejected.notAudiobook} reviews/podcasts/etc, ${rejected.author} wrong author)`);

      return kept
        .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
        .map(e => ({
          title: e.title,
          url: `https://www.youtube.com/watch?v=${e.id}`,
          videoId: e.id,
          duration: e.duration,
          channel: e.channel || e.uploader,
          thumbnail: e.thumbnail,
          viewCount: e.view_count,
          format: 'audiobook',
          source: 'youtube'
        }));
    } catch (error) {
      logger.error('YouTube search error:', error.message);
      return [];
    }
  }

  async getVideoInfo(url) {
    try {
      const info = await ytdlp.run(url, {
        dumpSingleJson: true,
        noDownload: true,
        noWarnings: true
      });

      const chapters = (info.chapters || []).map(ch => ({
        title: ch.title,
        startTime: ch.start_time,
        endTime: ch.end_time
      }));

      return {
        title: info.title,
        duration: info.duration,
        chapters,
        thumbnail: info.thumbnail,
        description: info.description
      };
    } catch (error) {
      logger.error('YouTube info error:', error.message);
      return null;
    }
  }

  // Downloads go through the audiobook pipeline (download -> M4B with chapters -> library)
  download(url, bookId, opts = {}) {
    const audiobookPipeline = require('../services/audiobookPipeline');
    return audiobookPipeline.enqueue(bookId, { source: 'youtube', type: 'youtube', downloadUrl: url, indexer: 'YouTube', title: url }, opts);
  }
}

module.exports = new YouTubeScraper();
