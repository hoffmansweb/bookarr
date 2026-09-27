// Locations of external tools. The Docker image sets these env vars to system
// packages (apt ffmpeg, python venv); on Windows/dev the npm-bundled binaries are used.
const installerPath = (pkg) => {
  try {
    return require(pkg).path;
  } catch (e) {
    return null;
  }
};

module.exports = {
  ffmpegPath: process.env.FFMPEG_PATH || installerPath('@ffmpeg-installer/ffmpeg') || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || installerPath('@ffprobe-installer/ffprobe') || 'ffprobe',
  pythonPath: process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3')
};
