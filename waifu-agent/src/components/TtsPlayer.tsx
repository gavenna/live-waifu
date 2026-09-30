import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  ttsAudioBase64: string;
  ttsDurationMs: number;
  onPlaybackEnd: () => void;
  onEnergy?: (energy: number[]) => void;
  volume?: number;
}

export function TtsPlayer({ ttsAudioBase64, ttsDurationMs, onPlaybackEnd, onEnergy, volume }: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!ttsAudioBase64) return;

    invoke("play_tts_audio", { audioBase64: ttsAudioBase64, volume: volume ?? 80 })
      .then((result: any) => {
        if (result?.energy?.length > 0) onEnergy?.(result.energy);
      })
      .catch((err) => console.warn("TTS playback failed:", err));

    timerRef.current = setTimeout(() => { onPlaybackEnd(); }, ttsDurationMs);
    return () => { clearTimeout(timerRef.current); };
  }, [ttsAudioBase64, ttsDurationMs, onPlaybackEnd, onEnergy, volume]);

  return null;
}
