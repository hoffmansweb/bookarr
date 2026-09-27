"""Edge TTS wrapper - reads text from stdin to avoid shell escaping issues."""
import sys
import asyncio
import json
import edge_tts

async def main():
    voice = sys.argv[1]
    rate = sys.argv[2]
    output = sys.argv[3]
    text = sys.stdin.buffer.read().decode('utf-8', errors='ignore')
    # Remove surrogates and other invalid unicode
    text = text.encode('utf-8', errors='ignore').decode('utf-8')
    
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    
    # Collect word boundaries for seeking
    words = []
    with open(output, 'wb') as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "WordBoundary":
                words.append({
                    "offset": chunk["offset"],      # ms into audio
                    "text": chunk["text"],
                    "textOffset": chunk["text_offset"]  # char position in text
                })
            elif chunk["type"] == "audio":
                f.write(chunk["data"])
    
    # Write word boundaries as JSON sidecar
    with open(output + '.json', 'w') as f:
        json.dump(words, f)

if __name__ == '__main__':
    asyncio.run(main())
