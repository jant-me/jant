/**
 * Client-side Audio Waveform Extraction
 *
 * Decodes an audio file with the Web Audio API and samples the peaks the
 * player draws. Image dimensions and blurhash come from `ImageProcessor`;
 * video dimensions, poster, and blurhash come from `VideoProcessor`.
 */

/**
 * Extract waveform peak amplitudes from an audio file.
 * Decodes via Web Audio API and returns a JSON string of ~100 normalized peak values (0–1).
 *
 * @param file - Audio file to extract peaks from
 * @returns JSON string of peak values, e.g. "[0.2,0.8,0.5,...]"
 */
export async function extractAudioWaveform(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();

  try {
    const decoded = await audioCtx.decodeAudioData(buffer);
    const raw = decoded.getChannelData(0);
    const count = 100;
    const step = Math.max(1, Math.floor(raw.length / count));
    const peaks: number[] = new Array(count);

    for (let i = 0; i < count; i++) {
      let max = 0;
      const start = i * step;
      const end = Math.min(start + step, raw.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(raw[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }

    let maxPeak = 0;
    for (const p of peaks) if (p > maxPeak) maxPeak = p;
    if (maxPeak > 0) {
      for (let i = 0; i < count; i++)
        peaks[i] = Math.round((peaks[i] / maxPeak) * 100) / 100;
    }

    return JSON.stringify(peaks);
  } finally {
    await audioCtx.close();
  }
}
