import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { bookAPI } from '../services/api';
import { toast } from 'react-toastify';
import { ReactReader } from 'react-reader';
import './Reader.css';

// Same rule as services/api.js: dev server on :3000 -> backend :5000, otherwise same origin
const getApiBaseUrl = () => {
  const { protocol, hostname, port, origin } = window.location;
  return port === '3000' ? `${protocol}//${hostname}:5000` : origin;
};

// Split text into ~1–3 sentence chunks (≤ ~300 chars) for text-to-speech. `base` is the
// offset of `text` within the page, so each chunk knows its absolute start position.
const getTextRange = (body, startOffset, endOffset) => {
  const treeWalker = body.ownerDocument.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */, null, false);
  let currentOffset = 0;
  let startNode = null;
  let startLocal = 0;
  let endNode = null;
  let endLocal = 0;

  let node;
  while ((node = treeWalker.nextNode())) {
    const len = node.nodeValue.length;
    if (!startNode && currentOffset + len > startOffset) {
      startNode = node;
      startLocal = startOffset - currentOffset;
    }
    if (!endNode && currentOffset + len >= endOffset) {
      endNode = node;
      endLocal = endOffset - currentOffset;
      break;
    }
    currentOffset += len;
  }

  if (startNode && endNode) {
    const range = body.ownerDocument.createRange();
    range.setStart(startNode, startLocal);
    range.setEnd(endNode, endLocal);
    return range;
  }
  return null;
};

const splitIntoChunks = (text, base = 0, maxLen = 300) => {
  const chunks = [];
  const sentenceRe = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g;
  let current = '';
  let currentStart = 0;
  let carry = null; // sentence ending in an abbreviation ("Mr.") is joined to the next one
  let m;
  while ((m = sentenceRe.exec(text)) !== null) {
    if (!m[0]) { sentenceRe.lastIndex++; continue; }
    let sentence = m[0];
    let start = m.index;
    if (carry) { sentence = carry.text + sentence; start = carry.start; carry = null; }
    if (/\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Mt|Capt|Col|Gen|Lt|vs|etc|No|e\.g|i\.e)\.\s*$/i.test(sentence) && sentenceRe.lastIndex < text.length) {
      carry = { text: sentence, start };
      continue;
    }
    // Very long sentence: break at commas/spaces so no chunk is huge
    while (sentence.length > maxLen * 1.5) {
      const cut = Math.max(sentence.lastIndexOf(', ', maxLen), sentence.lastIndexOf(' ', maxLen));
      const at = cut > 50 ? cut + 1 : maxLen;
      if (current) { chunks.push({ start: base + currentStart, text: current }); current = ''; }
      chunks.push({ start: base + start, text: sentence.slice(0, at) });
      sentence = sentence.slice(at);
      start += at;
    }
    if (!current) currentStart = start;
    if (current && (current + sentence).length > maxLen) {
      chunks.push({ start: base + currentStart, text: current });
      current = sentence;
      currentStart = start;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push({ start: base + currentStart, text: current });
  return chunks.filter(c => c.text.trim().length > 0);
};

const Reader = ({ book, onClose, onStarredChange }) => {
  const [fileUrl, setFileUrl] = useState(null);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [chapters, setChapters] = useState(book.chapters || []);
  const [extracting, setExtracting] = useState(false);
  const [location, setLocation] = useState(book.lastReadingPosition || 0);
  const [epubData, setEpubData] = useState(null);
  const [fontSize, setFontSize] = useState(100);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  // Saved voice may be Edge ("…Neural") or local Kokoro ("oai:af_bella"); validated once the list loads.
  // With nothing saved, the first server voice (best Kokoro voice when available) is used.
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('ttsVoice') || '');
  const selectedVoiceRef = useRef(localStorage.getItem('ttsVoice') || '');
  const [speechRate, setSpeechRate] = useState(parseFloat(localStorage.getItem('ttsRate')) || 1);
  const speechRateRef = useRef(parseFloat(localStorage.getItem('ttsRate')) || 1);
  const audioRef = useRef(null);
  const ttsAudioRef = useRef(null);
  const blobUrlRef = useRef(null);
  const renditionRef = useRef(null);
  const speakingRef = useRef(false);
  const autoAdvanceRef = useRef(false);
  const ttsGenRef = useRef(0);
  const pageTextRef = useRef('');
  const wordTimingsRef = useRef([]);
  const lastCharPosRef = useRef(0);
  const chunkRef = useRef({ from: 0, text: '' }); // text currently being spoken (for voices without word timings)
  const abortRef = useRef(null); // cancels in-flight TTS requests on stop / voice change
  // "Waiting on the TTS server" feedback (Kokoro can take seconds to produce the first chunk)
  const [ttsWait, setTtsWait] = useState(null); // null or a message like "Switching voice…"
  const ttsWaitReasonRef = useRef(null);
  const ttsWaitTimerRef = useRef(null);
  const showTtsWait = (message, delayMs = 0) => {
    clearTimeout(ttsWaitTimerRef.current);
    if (delayMs) ttsWaitTimerRef.current = setTimeout(() => setTtsWait(message), delayMs);
    else setTtsWait(message);
  };
  const clearTtsWait = () => {
    clearTimeout(ttsWaitTimerRef.current);
    ttsWaitReasonRef.current = null;
    setTtsWait(null);
  };
  // Voice/speed change while reading: restart from the current spot, with immediate feedback
  const restartSpeechWith = (reason) => {
    const charPos = getCurrentCharPosition();
    if (!speakingRef.current) return;
    stopCurrentAudio();
    lastCharPosRef.current = charPos;
    wordTimingsRef.current = [];
    ttsWaitReasonRef.current = reason;
    showTtsWait(reason);
    setTimeout(() => speakPageFrom(charPos), 100);
  };
  const ttsActiveRef = useRef(false); // true while TTS initiated the current page // always tracks current position
  const locationRef = useRef(book.lastReadingPosition || 0); // latest location for save-on-unmount / interval
  const chaptersRequestedRef = useRef(null); // book id we already asked the server to extract chapters for
  const starredNotifiedRef = useRef(false); // host already told about this book's auto-star

  const [savedTtsPosition, setSavedTtsPosition] = useState(null);
  const [savedTtsCharPosition, setSavedTtsCharPosition] = useState(0);
  const [showResumePopup, setShowResumePopup] = useState(false);

  const isAudiobook = book.bookType === 'audiobook';

  // The `book` prop comes from lists/cards and doesn't carry this user's saved position
  // (that lives per-user in UserBooks), so fetch it fresh and don't show the book until we
  // have it. Otherwise the reader opened at page 1 and the 10s auto-save overwrote the
  // real position with page 1.
  const [positionReady, setPositionReady] = useState(false);
  const positionReadyRef = useRef(false); // readable from save timers/cleanups
  const savedAudioPositionRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    setPositionReady(false);
    positionReadyRef.current = false;
    const token = localStorage.getItem('token');
    fetch(`${getApiBaseUrl()}/api/books/${book.id}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : {}))
      .then(data => {
        if (cancelled) return;
        if (isAudiobook) {
          savedAudioPositionRef.current = Number(data.lastPosition) || 0;
        } else {
          const start = data.lastReadingPosition || data.ttsPosition || book.lastReadingPosition || 0;
          setLocation(start);
          locationRef.current = start;
          if (data.ttsPosition) {
            setSavedTtsPosition(data.ttsPosition);
            setSavedTtsCharPosition(data.ttsCharPosition || 0);
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) { positionReadyRef.current = true; setPositionReady(true); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, isAudiobook]);

  // POST progress; `keepalive` lets the request finish even if the tab is closing.
  // The reply says whether this save filed the book under Favorites (first progress on it),
  // so the star can fill in and the host list can refresh without a page reload.
  useEffect(() => {
    if (isAudiobook && 'mediaSession' in navigator) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: book.title || 'Unknown Title',
        artist: book.author?.name || book.author || 'Unknown Author',
        album: book.series ? `${book.series} ${book.seriesNumber ? '#' + book.seriesNumber : ''}` : 'Bookarr',
        artwork: book.coverUrl ? [{ src: book.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : []
      });

      navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play());
      navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15); });
      navigator.mediaSession.setActionHandler('seekforward', () => { if (audioRef.current) audioRef.current.currentTime += 15; });
    }
  }, [book, isAudiobook]);

  const postProgress = (path, body) => {
    const token = localStorage.getItem('token');
    return fetch(`${getApiBaseUrl()}/api/books/${book.id}/${path}`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(res => res.json().catch(() => ({})))
      .then(data => {
        if (!data?.starred || starredNotifiedRef.current) return;
        starredNotifiedRef.current = true;
        // Starred by this very save (it wasn't a favorite before) — say so, once
        if (data.autoStarred) toast.success('⭐ Added to Favorites');
        onStarredChange?.();
      })
      .catch(() => {});
  };

  // Audiobooks: save listening position every 10s while playing, on pause and on close
  useEffect(() => {
    if (!isAudiobook) return undefined;
    const save = () => {
      const t = audioRef.current?.currentTime;
      if (t && t > 5) postProgress('progress', { position: Math.floor(t) });
    };
    const timer = setInterval(() => { if (audioRef.current && !audioRef.current.paused) save(); }, 10000);
    return () => { clearInterval(timer); save(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, isAudiobook]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // Save position and stop TTS only on unmount / book change. With `location` in
  // the deps this cleanup ran on every page turn, POSTing progress each time and
  // pausing + discarding the TTS audio whenever the location changed mid-speech.
  useEffect(() => {
    return () => {
      if (speakingRef.current) {
        if (ttsAudioRef.current) { ttsAudioRef.current.onended = null; ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
      }
      const currentLocation = locationRef.current;
      if (currentLocation && !isAudiobook && positionReadyRef.current) {
        const body = { position: currentLocation };
        if (speakingRef.current) {
          body.ttsPosition = currentLocation;
          body.ttsCharPosition = getCurrentCharPosition();
        }
        postProgress('reading-progress', body);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, isAudiobook]);

  const [fileIssue, setFileIssue] = useState(null);
  const [loadingFile, setLoadingFile] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('token');
    const fileUrlBase = `${getApiBaseUrl()}/api/books/${book.id}/file?token=${encodeURIComponent(token || '')}`;

    setFileIssue(null);
    setEpubData(null);
    setFileUrl(null);
    setLoadingFile(true);

    const fail = (title, detail, extra = {}) => {
      if (cancelled) return;
      setFileIssue({ title, detail, ...extra });
      setLoadingFile(false);
    };

    // Ask the server first: a book whose file sits on an unreachable share should
    // say so, instead of surfacing as an unexplained download error.
    bookAPI.getFileStatus(book.id)
      .then(({ data: status }) => {
        if (cancelled) return;

        if (!status.available) {
          const titles = {
            FILE_MISSING: 'File not reachable',
            NO_FILE_LINKED: 'No file linked',
            NO_MP3_IN_FOLDER: 'No audio files found',
            BOOK_NOT_FOUND: 'Book not found'
          };
          fail(titles[status.code] || 'File unavailable', status.reason || 'The book file is not available.', {
            code: status.code,
            path: status.path,
            tried: status.tried
          });
          return;
        }

        if (isAudiobook) {
          setFileUrl(fileUrlBase);
          setLoadingFile(false);
          return;
        }

        fetch(fileUrlBase)
          .then(res => {
            // Don't hand an error JSON body to the EPUB renderer
            if (res.ok) return res.arrayBuffer();
            return res.json().then(
              body => { throw new Error(body?.error || `HTTP ${res.status}`); },
              () => { throw new Error(`HTTP ${res.status}`); }
            );
          })
          .then(buffer => {
            if (cancelled) return;
            setEpubData(buffer);
            setLoadingFile(false);
          })
          .catch(err => {
            console.error('Fetch error:', err);
            fail('Failed to load ebook', err.message);
          });
      })
      .catch(err => {
        console.error('File status check failed:', err);
        fail('Could not check this book', err.response?.data?.error || err.message);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, book.bookType, isAudiobook, reloadKey]);


  useEffect(() => {
    const loadVoices = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${getApiBaseUrl()}/api/tts/voices`, { headers: { 'Authorization': `Bearer ${token}` } });
        const serverVoices = await res.json();
        if (!Array.isArray(serverVoices)) return;
        setVoices(serverVoices);
        // No saved choice, or it's unavailable right now (e.g. Kokoro down): use the first voice,
        // which is the best Kokoro voice when the server is up. Only an explicit pick is persisted,
        // so a temporary outage doesn't overwrite the user's preference.
        if (serverVoices.length && !serverVoices.find(v => v.id === selectedVoiceRef.current)) {
          const fallback = serverVoices[0].id;
          setSelectedVoice(fallback);
          selectedVoiceRef.current = fallback;
        }
      } catch (e) { console.error('Failed to load voices:', e); }
    };
    loadVoices();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    
    // Only try once per book: with `extracting` in the deps, a file without chapters
    // re-triggered extraction every time the previous request finished (endless loop).
    if (book.bookType === 'audiobook' && (!book.chapters || book.chapters.length === 0) && chaptersRequestedRef.current !== book.id) {
      chaptersRequestedRef.current = book.id;
      setExtracting(true);
      fetch(`${getApiBaseUrl()}/api/books/${book.id}/extract-chapters`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => setChapters(data.chapters || []))
      .catch(err => console.error('Chapter extraction failed:', err))
      .finally(() => setExtracting(false));
    }
  }, [book.id, book.bookType, book.chapters]);

  // Audiobook: jump to this user's saved position once the file's duration is known
  const handleAudioLoaded = () => {
    const saved = savedAudioPositionRef.current;
    const audio = audioRef.current;
    if (audio && saved > 5 && (!audio.duration || saved < audio.duration - 5)) {
      audio.currentTime = saved;
    }
  };

  useEffect(() => {
    // Read the latest location from a ref so the 10s timer isn't reset on every page turn
    const saveInterval = setInterval(() => {
      const currentLocation = locationRef.current;
      // Never save before the real saved position has been applied (would overwrite it with page 1)
      if (currentLocation && !isAudiobook && positionReadyRef.current) {
        const body = { position: currentLocation };
        if (speakingRef.current) {
          body.ttsPosition = currentLocation;
          body.ttsCharPosition = getCurrentCharPosition();
        }
        postProgress('reading-progress', body);
      }
    }, 10000);

    return () => clearInterval(saveInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, isAudiobook]);

  const handleAudioError = (e) => {
    console.error('Audio error:', e);
    setError('Failed to load audio file');
  };

  const togglePlayPause = () => {
    if (audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play();
        setIsPlaying(true);
      } else {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const jumpToChapter = (startTime) => {
    if (audioRef.current) {
      audioRef.current.currentTime = startTime;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
  };

  const stopCurrentAudio = () => {
    // Update lastCharPosRef before killing audio
    if (ttsAudioRef.current && !wordTimingsRef.current.length) getCurrentCharPosition();
    if (ttsAudioRef.current && wordTimingsRef.current.length) {
      const currentTimeMs = ttsAudioRef.current.currentTime * 1000;
      for (const w of wordTimingsRef.current) {
        if (w.offset <= currentTimeMs) lastCharPosRef.current = w.textOffset + w.text.length;
        else break;
      }
    }
    ttsGenRef.current++;
    ttsActiveRef.current = false;
    // Cancel queued/in-flight synthesis so the TTS server isn't left working on stale text
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.onended = null;
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
  };

  const getCurrentCharPosition = () => {
    const audio = ttsAudioRef.current;
    // Voices without word timings (Kokoro): estimate from playback progress, then step back to
    // the start of that sentence so resuming never starts mid-sentence
    if (audio && !wordTimingsRef.current.length && audio.duration > 0 && chunkRef.current.text) {
      const { from, text } = chunkRef.current;
      const approx = Math.floor((audio.currentTime / audio.duration) * text.length);
      const before = text.slice(0, approx);
      const sentenceStart = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('\n'));
      const pos = from + (sentenceStart > 0 ? sentenceStart + 2 : 0);
      lastCharPosRef.current = pos;
      return pos;
    }
    if (!audio || !wordTimingsRef.current.length) return lastCharPosRef.current;
    const currentTimeMs = ttsAudioRef.current.currentTime * 1000;
    let charPos = 0;
    for (const w of wordTimingsRef.current) {
      if (w.offset <= currentTimeMs) charPos = w.textOffset + w.text.length;
      else break;
    }
    lastCharPosRef.current = charPos;
    return charPos;
  };

  const toggleTTS = () => {
    if (isSpeaking) {
      // Capture position BEFORE stopping audio
      const charPos = getCurrentCharPosition();
      stopCurrentAudio();
      clearTtsWait();
      setIsSpeaking(false);
      speakingRef.current = false;
      const here = locationRef.current;
      if (here) {
        // Remember locally too, so the next Read continues from exactly here
        setSavedTtsPosition(here);
        setSavedTtsCharPosition(charPos);
        postProgress('reading-progress', { position: here, ttsPosition: here, ttsCharPosition: charPos });
      }
      return;
    }

    const rendition = renditionRef.current;
    if (!rendition) return;

    const here = locationRef.current;
    // Still on the page where reading stopped: just continue from the saved word
    if (savedTtsPosition && savedTtsPosition === here) {
      setIsSpeaking(true);
      speakingRef.current = true;
      speakPageFrom(savedTtsCharPosition || 0);
      return;
    }
    // Saved spot is on another page (you've browsed since): ask
    if (savedTtsPosition) {
      setShowResumePopup(true);
      return;
    }

    setIsSpeaking(true);
    speakingRef.current = true;
    speakPage();
  };

  const speakPageFrom = async (fromChar = 0) => {
    if (!speakingRef.current) return;

    const gen = ttsGenRef.current;
    const rendition = renditionRef.current;
    if (!rendition) return;
    
    const contents = rendition.getContents();
    if (!contents || contents.length === 0) {
      setTimeout(() => { if (gen === ttsGenRef.current) speakPageFrom(fromChar); }, 500);
      return;
    }

    const fullText = contents[0].document.body.textContent || '';
    if (!fullText || fullText.length < 10) {
      autoAdvanceRef.current = true;
      rendition.next();
      setTimeout(() => { if (gen === ttsGenRef.current) speakPage(); }, 800);
      return;
    }
    pageTextRef.current = fullText;
    const textToSpeak = fromChar > 0 ? fullText.slice(fromChar) : fullText;

    const advanceToNext = () => {
      if (!speakingRef.current || gen !== ttsGenRef.current) return;
      lastCharPosRef.current = 0;
      wordTimingsRef.current = [];
      autoAdvanceRef.current = true;
      rendition.next().then(() => {
        setTimeout(() => { if (speakingRef.current && gen === ttsGenRef.current) speakPage(); }, 800);
      }).catch(() => { speakingRef.current = false; setIsSpeaking(false); });
    };

    // Speak in small sentence chunks rather than the whole page in one request: audio starts
    // quickly, a CPU TTS server (Kokoro) never gets a huge job queued, and switching voice/speed
    // only has to wait for one short chunk.
    const chunks = splitIntoChunks(textToSpeak, fromChar);
    if (!chunks.length) { advanceToNext(); return; }

    const token = localStorage.getItem('token');
    const controller = new AbortController();
    abortRef.current = controller;
    const voice = selectedVoiceRef.current;
    const speed = speechRateRef.current;

    const fetchChunk = async (chunk) => {
      const request = () => fetch(`${getApiBaseUrl()}/api/tts/speak`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk.text, voice, speed })
      });
      let res = await request();
      // A TTS server hiccup (e.g. Kokoro restarting) is usually brief: retry once
      if (!res.ok && gen === ttsGenRef.current) {
        await new Promise(r => setTimeout(r, 2000));
        if (gen !== ttsGenRef.current) throw new DOMException('superseded', 'AbortError');
        res = await request();
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Text-to-speech failed (HTTP ${res.status})`);
      }
      return URL.createObjectURL(await res.blob());
    };

    const fail = (err) => {
      if (gen !== ttsGenRef.current || err?.name === 'AbortError') return;
      console.error('TTS error:', err);
      toast.error(`Read aloud stopped: ${err.message}`);
      clearTtsWait();
      ttsActiveRef.current = false;
      speakingRef.current = false;
      setIsSpeaking(false);
    };

    // Only ever one chunk prefetched ahead
    const pending = new Map();
    const getChunkAudio = (i) => {
      if (!pending.has(i)) pending.set(i, fetchChunk(chunks[i]));
      return pending.get(i);
    };

    const playChunk = async (i) => {
      if (gen !== ttsGenRef.current || !speakingRef.current) return;
      if (i >= chunks.length) { advanceToNext(); return; }
      // Feedback while the server synthesizes: at once after a voice/speed change, otherwise only
      // if it's slow (a prefetched chunk is usually ready, and a flash between chunks is noise)
      if (!ttsWaitReasonRef.current) showTtsWait(i === 0 ? 'Preparing speech…' : 'Generating speech…', 600);
      let url;
      try {
        url = await getChunkAudio(i);
      } catch (err) {
        fail(err);
        return;
      }
      if (gen !== ttsGenRef.current || !speakingRef.current) { URL.revokeObjectURL(url); return; }

      const chunk = chunks[i];
      chunkRef.current = { from: chunk.start, text: chunk.text };
      lastCharPosRef.current = chunk.start;
      wordTimingsRef.current = [];
      ttsActiveRef.current = true;

      // HIGHLIGHTING
        const contents = renditionRef.current?.getContents();
        if (contents && contents[0]) {
          try {
            const range = getTextRange(contents[0].document.body, chunk.start, chunk.start + chunk.text.length);
            if (range && contents[0].cfiFromRange) {
              const cfiRange = contents[0].cfiFromRange(range);
              // Clear previous by removing all
              contents[0].rendition.annotations.remove(cfiRange, "highlight"); // Actually epub.js remove takes CFI or just clears if you pass right args, but let's just clear all?
              // The epub.js annotations API allows highlighting
              contents[0].rendition.annotations.highlight(cfiRange, {}, (e) => {});
            }
          } catch(e) {}
        }
        
        const audio = new Audio(url);
      ttsAudioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); playChunk(i + 1); };
      audio.onerror = () => { URL.revokeObjectURL(url); fail(new Error('Could not play the generated audio')); };
      audio.onplaying = () => { if (gen === ttsGenRef.current) clearTtsWait(); };
      audio.play().catch(fail);

      // Prefetch the next chunk while this one plays
      if (i + 1 < chunks.length) getChunkAudio(i + 1).catch(() => {});

      // Word timings (Edge voices) for exact resume positions; cached server-side, so cheap
      fetch(`${getApiBaseUrl()}/api/tts/timings`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk.text, voice, speed })
      }).then(r => r.json()).then(timings => {
        if (gen === ttsGenRef.current && ttsAudioRef.current === audio && Array.isArray(timings)) {
          wordTimingsRef.current = timings.map(w => ({ ...w, textOffset: w.textOffset + chunk.start }));
        }
      }).catch(() => {});
    };

    playChunk(0);
  };

  const speakPage = () => speakPageFrom(0);

  // Jump to the saved page, wait until it's rendered, then continue from the saved word
  const handleResume = () => {
    const target = savedTtsPosition;
    const charPos = savedTtsCharPosition || 0;
    setShowResumePopup(false);
    const start = () => {
      setIsSpeaking(true);
      speakingRef.current = true;
      speakPageFrom(charPos);
    };
    const rendition = renditionRef.current;
    if (target && target !== locationRef.current && rendition) {
      autoAdvanceRef.current = true;
      setLocation(target);
      rendition.display(target)
        .then(() => setTimeout(start, 300))
        .catch(() => setTimeout(start, 800));
    } else {
      start();
    }
  };

  const handleStartFresh = () => {
    setShowResumePopup(false);
    setSavedTtsPosition(null);
    setIsSpeaking(true);
    speakingRef.current = true;
    speakPage();
  };

  // Full-screen, position:fixed overlay. Hosts render <Reader> inside their own DOM
  // (a .book-card, a modal), and any transformed ancestor becomes the containing block
  // for fixed children: .book-card:hover { transform: translateY(-4px) } teleported this
  // overlay into the card as soon as the pointer entered it, so the reader jumped off
  // screen (that flicker) and every click landed on the page behind it (nothing to stop).
  // A portal to <body> keeps the overlay positioned against the viewport, whatever CSS
  // the host applies to its own element.
  return createPortal(
    <div className="reader-overlay" onClick={onClose}>
      <div className="reader-container" onClick={(e) => e.stopPropagation()}>
        {showResumePopup && (
          <div className="resume-popup-overlay" onClick={() => setShowResumePopup(false)}>
            <div className="resume-popup" onClick={(e) => e.stopPropagation()}>
              <h3>Continue reading aloud?</h3>
              <p>You stopped reading aloud on a different page. Go back to where you stopped, or start reading from this page?</p>
              <div className="resume-popup-buttons">
                <button onClick={handleResume} className="resume-btn" autoFocus>Resume where I stopped</button>
                <button onClick={handleStartFresh} className="start-fresh-btn">Read from this page</button>
              </div>
            </div>
          </div>
        )}
        <div className="reader-header">
          <h2>{book.title}</h2>
          <button className="reader-close" onClick={onClose}>×</button>
        </div>
        
        <div className="reader-content">
          {error && <div className="error-message">{error}</div>}
          {loadingFile && !fileIssue && <div className="reader-loading">Loading book…</div>}
          {fileIssue && (
            <div className="error-message file-error">
              <h3>{fileIssue.title}</h3>
              <p>{fileIssue.detail}</p>
              {fileIssue.path && <code className="error-path">{fileIssue.path}</code>}
              {fileIssue.tried && fileIssue.tried.length > 1 && (
                <details className="error-tried">
                  <summary>Locations tried ({fileIssue.tried.length})</summary>
                  {fileIssue.tried.map(p => <code key={p} className="error-path">{p}</code>)}
                </details>
              )}
              {fileIssue.code === 'FILE_MISSING' && (
                <p className="error-hint">
                  Library moved? Point Bookarr at the new root with <code>LIBRARY_PATH_REMAP</code> in the backend <code>.env</code>.
                </p>
              )}
              <button className="error-retry" onClick={() => setReloadKey(k => k + 1)}>Retry</button>
            </div>
          )}
          {isAudiobook && !fileIssue && fileUrl && positionReady ? (

            <div className="audio-player" onClick={togglePlayPause}>
              <div className="audio-cover-container">
                {book.coverUrl && <img src={book.coverUrl} alt={book.title} className="audio-cover" />}
                <div className="play-pause-overlay">
                  {isPlaying ? '⏸' : '▶'}
                </div>
              </div>
              <audio 
                ref={audioRef} 
                controls 
                autoPlay 
                src={fileUrl}
                onError={handleAudioError}
                onClick={(e) => e.stopPropagation()}
                onLoadedMetadata={handleAudioLoaded}
                onPlay={() => setIsPlaying(true)}
                onPause={() => {
                  setIsPlaying(false);
                  const t = audioRef.current?.currentTime;
                  if (t && t > 5) postProgress('progress', { position: Math.floor(t) });
                }}
              >
                Your browser does not support audio playback.
              </audio>
              {chapters.length > 0 && (
                <div className="chapters-list" onClick={(e) => e.stopPropagation()}>
                  <h3>Chapters ({chapters.length})</h3>
                  {chapters.map((chapter, index) => (
                    <div key={index} className="chapter-item" onClick={() => jumpToChapter(chapter.start)}>
                      <span className="chapter-title">{index === 0 ? 'Intro' : `Chapter ${index}`}</span>
                      <span className="chapter-time">{formatTime(chapter.start)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : epubData && positionReady ? (
            <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: '10px', background: '#192734', padding: '15px', borderRadius: '8px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={selectedVoice} onChange={(e) => { const v = e.target.value; setSelectedVoice(v); selectedVoiceRef.current = v; localStorage.setItem('ttsVoice', v); restartSpeechWith('Switching voice…'); }} style={{ padding: '10px', background: '#0f1419', color: '#fff', border: '1px solid #38444d', borderRadius: '6px', cursor: 'pointer', minHeight: '44px', fontSize: '0.85rem', touchAction: 'manipulation' }}>
                    {voices.some(v => v.local) ? (
                      <>
                        <optgroup label="Kokoro (local, best first)">
                          {voices.filter(v => v.local).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </optgroup>
                        <optgroup label="Edge (online)">
                          {voices.filter(v => !v.local).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </optgroup>
                      </>
                    ) : voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                  <select value={speechRate} onChange={(e) => { const rate = parseFloat(e.target.value); setSpeechRate(rate); speechRateRef.current = rate; localStorage.setItem('ttsRate', rate); restartSpeechWith(`Changing speed to ${rate}x…`); }} style={{ padding: '10px', background: '#0f1419', color: '#fff', border: '1px solid #38444d', borderRadius: '6px', cursor: 'pointer', minHeight: '44px', fontSize: '0.85rem', touchAction: 'manipulation' }}>
                    <option value="0.5">0.5x</option>
                    <option value="0.75">0.75x</option>
                    <option value="1">1x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2x</option>
                    <option value="2.5">2.5x</option>
                    <option value="3">3x</option>
                    <option value="4">4x</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button onClick={() => { const next = Math.max(50, fontSize - 10); setFontSize(next); renditionRef.current?.themes.fontSize(`${next}%`); }}style={{ padding: '10px 15px', background: '#4a9eff', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', minHeight: '44px', fontSize: '1rem', fontWeight: '600', touchAction: 'manipulation', userSelect: 'none' }}>A-</button>
                  <span style={{ color: '#fff', padding: '10px', display: 'flex', alignItems: 'center', fontSize: '1rem' }}>{fontSize}%</span>
                  <button onClick={() => { const next = Math.min(200, fontSize + 10); setFontSize(next); renditionRef.current?.themes.fontSize(`${next}%`); }}style={{ padding: '10px 15px', background: '#4a9eff', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', minHeight: '44px', fontSize: '1rem', fontWeight: '600', touchAction: 'manipulation', userSelect: 'none' }}>A+</button>
                  <button onClick={() => { stopCurrentAudio(); autoAdvanceRef.current = true; renditionRef.current?.prev().then(() => { if (speakingRef.current) setTimeout(speakPage, 800); }); }} style={{ padding: '10px 15px', background: '#657786', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', minHeight: '44px', fontSize: '1rem', fontWeight: '600', touchAction: 'manipulation', userSelect: 'none' }}>◀ Prev</button>
                  <button onClick={() => { stopCurrentAudio(); autoAdvanceRef.current = true; renditionRef.current?.next().then(() => { if (speakingRef.current) setTimeout(speakPage, 800); }); }} style={{ padding: '10px 15px', background: '#657786', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', minHeight: '44px', fontSize: '1rem', fontWeight: '600', touchAction: 'manipulation', userSelect: 'none' }}>Next ▶</button>
                  <button onClick={toggleTTS} style={{ padding: '10px 15px', background: isSpeaking ? '#f91880' : '#00ba7c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', minHeight: '44px', fontSize: '1rem', fontWeight: '600', touchAction: 'manipulation', userSelect: 'none' }}>{isSpeaking ? '⏹ Stop' : '🔊 Read'}</button>
                </div>
              </div>
              {ttsWait && isSpeaking && (
                <div className="tts-wait" role="status" aria-live="polite">
                  <span className="tts-wait-bars" aria-hidden="true"><span /><span /><span /><span /><span /></span>
                  <span>{ttsWait}</span>
                </div>
              )}
              <div style={{ flex: 1 }}>
                <ReactReader
                  url={epubData}
                  location={location}
                  locationChanged={(epubcfi) => {
                    setLocation(epubcfi);
                    const rendition = renditionRef.current;
                    if (rendition && rendition.book && rendition.book.locations && rendition.book.locations.length() > 0) {
                      const percent = rendition.book.locations.percentageFromCfi(epubcfi);
                      if (percent >= 0) postProgress('reading-progress', { position: epubcfi, percent });
                    } else {
                      postProgress('reading-progress', { position: epubcfi });
                    }
                  }}
                  epubOptions={{
                    flow: 'paginated',
                    manager: 'default'
                  }}
                  getRendition={(rendition) => {
                    renditionRef.current = rendition;
                    rendition.themes.fontSize(`${fontSize}%`);
                    rendition.book.ready.then(() => rendition.book.locations.generate(1600)).catch(() => {});
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="loading">Loading book...</div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default Reader;
