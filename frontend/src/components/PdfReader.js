import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import { toast } from 'react-toastify';
import './PdfReader.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const getApiBaseUrl = () => {
  const { protocol, hostname, port, origin } = window.location;
  return port === '3000' ? `${protocol}//${hostname}:5000` : origin;
};

// Sentence chunks ≤ ~300 chars for text-to-speech, mirroring the EPUB reader's chunking.
const splitIntoChunks = (text) => {
  const chunks = [];
  const sentenceRe = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g;
  let current = '';
  let m;
  while ((m = sentenceRe.exec(text)) !== null) {
    if (!m[0]) { sentenceRe.lastIndex++; continue; }
    let sentence = m[0];
    while (sentence.length > 400) {
      const cut = Math.max(sentence.lastIndexOf(', ', 300), sentence.lastIndexOf(' ', 300));
      const at = cut > 50 ? cut + 1 : 300;
      if (current) { chunks.push(current.trim()); current = ''; }
      chunks.push(sentence.slice(0, at).trim());
      sentence = sentence.slice(at);
    }
    if (current && (current + sentence).length > 300) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
};

const PdfReader = ({ book, onClose, onStarredChange }) => {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('ttsVoice') || '');
  const [speechRate, setSpeechRate] = useState(parseFloat(localStorage.getItem('ttsRate')) || 1);

  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const audioRef = useRef(null);
  const speakingRef = useRef(false);
  const genRef = useRef(0);
  const abortRef = useRef(null);
  const voiceRef = useRef(selectedVoice);
  const rateRef = useRef(speechRate);

  const loadVoices = useCallback(() => {
    const token = localStorage.getItem('token');
    fetch(`${getApiBaseUrl()}/api/tts/voices`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((v) => {
        if (!Array.isArray(v)) return;
        setVoices(v);
        if (v.length && !v.find((x) => x.id === voiceRef.current)) {
          voiceRef.current = v[0].id;
          setSelectedVoice(v[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadVoices(); }, [loadVoices]);

  useEffect(() => {
    let doc = null;
    const token = localStorage.getItem('token');
    const url = `${getApiBaseUrl()}/api/books/${book.id}/file?token=${encodeURIComponent(token || '')}`;
    setLoading(true);
    setError(null);
    pdfjsLib.getDocument({ url, cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`, cMapPacked: true })
      .promise
      .then((d) => { doc = d; setPdfDoc(d); setNumPages(d.numPages); setPageNumber(1); setLoading(false); })
      .catch((err) => { setError(`Failed to load PDF: ${err.message}`); setLoading(false); });
    return () => { if (doc) doc.destroy().catch(() => {}); };
  }, [book.id]);

  useEffect(() => {
    if (!pdfDoc) return undefined;
    let cancelled = false;
    const render = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (renderTaskRef.current) renderTaskRef.current.cancel();
        renderTaskRef.current = page.render({ canvasContext: ctx, viewport });
        await renderTaskRef.current.promise;
      } catch (e) {
        if (e && e.name === 'RenderingCancelledException') return;
        console.error('PDF render error:', e);
      }
    };
    render();
    return () => { cancelled = true; if (renderTaskRef.current) renderTaskRef.current.cancel(); };
  }, [pdfDoc, pageNumber, scale]);

  const stopSpeaking = () => {
    genRef.current++;
    speakingRef.current = false;
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (audioRef.current) { audioRef.current.onended = null; audioRef.current.pause(); audioRef.current = null; }
    setIsSpeaking(false);
  };

  const speakPage = async (from = 0) => {
    if (!pdfDoc || !speakingRef.current) return;
    const gen = genRef.current;

    let text = '';
    try {
      const page = await pdfDoc.getPage(pageNumber);
      const content = await page.getTextContent();
      text = content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim();
    } catch (e) {
      stopSpeaking();
      toast.error('Could not read this page');
      return;
    }
    if (!text) {
      // Blank page: move on
      if (pageNumber < numPages) { setPageNumber(pageNumber + 1); setTimeout(() => { if (speakingRef.current && genRef.current === gen) speakPage(0); }, 400); }
      else stopSpeaking();
      return;
    }

    const chunks = splitIntoChunks(text.slice(from));
    if (!chunks.length) { stopSpeaking(); return; }

    const token = localStorage.getItem('token');
    const controller = new AbortController();
    abortRef.current = controller;
    const voice = voiceRef.current;
    const speed = rateRef.current;

    const fetchChunk = async (chunk) => {
      const request = () => fetch(`${getApiBaseUrl()}/api/tts/speak`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk, voice, speed })
      });
      let res = await request();
      if (!res.ok && genRef.current === gen) {
        await new Promise((r) => setTimeout(r, 2000));
        if (genRef.current !== gen) throw new DOMException('superseded', 'AbortError');
        res = await request();
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Text-to-speech failed (HTTP ${res.status})`);
      }
      return URL.createObjectURL(await res.blob());
    };

    const fail = (err) => {
      if (genRef.current !== gen || err?.name === 'AbortError') return;
      stopSpeaking();
      toast.error(`Read aloud stopped: ${err.message}`);
    };

    const playChunk = async (i) => {
      if (genRef.current !== gen || !speakingRef.current) return;
      if (i >= chunks.length) {
        if (pageNumber < numPages) {
          setPageNumber(pageNumber + 1);
          setTimeout(() => { if (speakingRef.current && genRef.current === gen) speakPage(0); }, 500);
        } else {
          stopSpeaking();
        }
        return;
      }
      let url;
      try {
        url = await fetchChunk(chunks[i]);
      } catch (err) { fail(err); return; }
      if (genRef.current !== gen || !speakingRef.current) { URL.revokeObjectURL(url); return; }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); playChunk(i + 1); };
      audio.onerror = () => { URL.revokeObjectURL(url); fail(new Error('Could not play the generated audio')); };
      audio.play().catch(fail);
    };

    playChunk(0);
  };

  const toggleSpeak = () => {
    if (isSpeaking) { stopSpeaking(); return; }
    speakingRef.current = true;
    setIsSpeaking(true);
    speakPage(0);
  };

  const onVoiceChange = (id) => {
    voiceRef.current = id;
    setSelectedVoice(id);
    localStorage.setItem('ttsVoice', id);
    if (speakingRef.current) { stopSpeaking(); speakingRef.current = true; setIsSpeaking(true); speakPage(0); }
  };

  const onRateChange = (rate) => {
    rateRef.current = rate;
    setSpeechRate(rate);
    localStorage.setItem('ttsRate', rate);
    if (speakingRef.current) { stopSpeaking(); speakingRef.current = true; setIsSpeaking(true); speakPage(0); }
  };

  useEffect(() => () => { stopSpeaking(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="reader-overlay" onClick={onClose}>
      <div className="pdf-reader-container" onClick={(e) => e.stopPropagation()}>
        <div className="reader-header">
          <h2>{book.title}</h2>
          <button className="reader-close" onClick={onClose}>×</button>
        </div>

        <div className="pdf-controls">
          <button onClick={() => setPageNumber((p) => Math.max(1, p - 1))} disabled={pageNumber <= 1}>◀ Prev</button>
          <span className="pdf-page-indicator">{pageNumber} / {numPages}</span>
          <button onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages}>Next ▶</button>
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}>A-</button>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.1))}>A+</button>
          <select value={selectedVoice} onChange={(e) => onVoiceChange(e.target.value)} className="pdf-voice-select">
            {voices.some((v) => v.local) ? (
              <>
                <optgroup label="Kokoro (local)">{voices.filter((v) => v.local).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</optgroup>
                <optgroup label="Edge (online)">{voices.filter((v) => !v.local).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</optgroup>
              </>
            ) : voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <select value={speechRate} onChange={(e) => onRateChange(parseFloat(e.target.value))} className="pdf-rate-select">
            {['0.75', '1', '1.25', '1.5', '2'].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
          <button className={`pdf-speak-btn ${isSpeaking ? 'speaking' : ''}`} onClick={toggleSpeak}>
            {isSpeaking ? '⏹ Stop' : '🔊 Read Aloud'}
          </button>
        </div>

        <div className="pdf-canvas-wrap">
          {loading && <div className="reader-loading">Loading PDF…</div>}
          {error && <div className="error-message">{error}</div>}
          <canvas ref={canvasRef} style={{ display: loading || error ? 'none' : 'block' }} />
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PdfReader;
