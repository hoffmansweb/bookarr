const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { ffprobePath } = require('../utils/binaries');

const extractChapters = async (filePath) => {
  try {
    // execFile with an argument array: filePath comes from the DB and must never be
    // interpreted by a shell (a '"' in the path previously allowed command injection).
    const { stdout } = await execFileAsync(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_chapters', filePath], {
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024
    });
    const data = JSON.parse(stdout);
    
    if (!data.chapters || data.chapters.length === 0) {
      console.log('[Chapter Extraction] No chapters found in file');
      return [];
    }
    
    console.log('[Chapter Extraction] Found', data.chapters.length, 'chapters');
    const chapters = data.chapters.map((chapter, index) => ({
      id: chapter.id || index,
      title: chapter.tags?.title || `Chapter ${index + 1}`,
      start: parseFloat(chapter.start_time),
      end: parseFloat(chapter.end_time)
    }));
return chapters;
  } catch (error) {
    if (error.code === 'ENOENT' || String(error.message).includes('not recognized')) {
      console.log('ffprobe not installed - chapter extraction disabled');
    } else {
      console.error('Chapter extraction error:', error.message);
    }
    return [];
  }
};

module.exports = { extractChapters };
