"""Kokoro TTS synthesis script - called by Node.js backend"""
import sys
import json
import soundfile as sf
from kokoro_onnx import Kokoro
import os

MODEL_DIR = os.path.join(os.path.dirname(__file__), 'kokoro')
kokoro = Kokoro(
    os.path.join(MODEL_DIR, 'kokoro-v1.0.onnx'),
    os.path.join(MODEL_DIR, 'voices-v1.0.bin')
)

def get_voices():
    voices = kokoro.get_voices()
    result = []
    for v in voices:
        # Parse voice naming: af=American Female, am=American Male, bf=British Female, etc
        prefix = v[:2]
        name = v[3:]
        labels = {
            'af': '🇺🇸♀', 'am': '🇺🇸♂',
            'bf': '🇬🇧♀', 'bm': '🇬🇧♂',
            'ef': '🇪🇸♀', 'em': '🇪🇸♂',
            'ff': '🇫🇷♀', 'hf': '🇮🇳♀', 'hm': '🇮🇳♂',
            'if': '🇮🇹♀', 'im': '🇮🇹♂',
            'jf': '🇯🇵♀', 'jm': '🇯🇵♂',
            'pf': '🇧🇷♀', 'pm': '🇧🇷♂',
            'zf': '🇨🇳♀', 'zm': '🇨🇳♂',
        }
        label = f"{labels.get(prefix, prefix)} {name}"
        result.append({'id': v, 'label': label})
    return result

def synthesize(text, voice, speed, output_path):
    import numpy as np
    import warnings
    warnings.filterwarnings('ignore')
    # Split into small chunks to avoid phoneme limit (510)
    chunks = split_text(text)
    all_samples = []
    sr = 24000
    for chunk in chunks:
        if not chunk.strip():
            continue
        try:
            samples, sr = kokoro.create(chunk, voice=voice, speed=speed)
            all_samples.append(samples)
        except (IndexError, RuntimeError):
            # If chunk still too long, split further
            for sub in split_text(chunk, max_chars=150):
                try:
                    samples, sr = kokoro.create(sub, voice=voice, speed=speed)
                    all_samples.append(samples)
                except Exception:
                    continue
    if not all_samples:
        raise RuntimeError('No audio generated')
    combined = np.concatenate(all_samples)
    sf.write(output_path, combined, sr)
    return output_path

def split_text(text, max_chars=250):
    """Split text into sentence-bounded chunks under max_chars."""
    import re
    sentences = re.split(r'(?<=[.!?;:,])\s+', text)
    chunks = []
    current = ''
    for s in sentences:
        if len(s) > max_chars:
            # Force split long sentences on word boundaries
            if current:
                chunks.append(current)
                current = ''
            words = s.split()
            part = ''
            for w in words:
                if len(part) + len(w) + 1 > max_chars and part:
                    chunks.append(part)
                    part = w
                else:
                    part = (part + ' ' + w).strip() if part else w
            if part:
                chunks.append(part)
        elif len(current) + len(s) + 1 > max_chars and current:
            chunks.append(current)
            current = s
        else:
            current = (current + ' ' + s).strip() if current else s
    if current:
        chunks.append(current)
    return chunks

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'voices':
        print(json.dumps(get_voices()))
    elif cmd == 'speak':
        text = sys.argv[2]
        voice = sys.argv[3] if len(sys.argv) > 3 else 'af_bella'
        speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
        output = sys.argv[5] if len(sys.argv) > 5 else 'output.wav'
        synthesize(text, voice, speed, output)
        print(output)
