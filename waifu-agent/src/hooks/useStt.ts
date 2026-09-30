import { useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * STT hook — MediaRecorder(WebM) → base64 → invoke("stt_transcribe") → text
 */
export function useStt(language = "zh") {
  const langRef = useRef(language);
  langRef.current = language;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const startRecording = useCallback(async () => {
    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const recorder = recorderRef.current;
    const stream = streamRef.current;
    if (!recorder) return null;

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        setIsRecording(false);
        setIsTranscribing(true);
        stream?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const base64 = await blobToBase64(blob);
          const text: string = await invoke("stt_transcribe", { audioBase64: base64, language: langRef.current });
          resolve(text);
        } catch (e) {
          console.error("STT failed:", e);
          resolve(null);
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.stop();
    });
  }, []);

  const cancelRecording = useCallback(() => {
    const recorder = recorderRef.current;
    const stream = streamRef.current;
    if (recorder && recorder.state !== "inactive") {
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorder.stop();
    }
    setIsRecording(false);
    setIsTranscribing(false);
  }, []);

  return { isRecording, isTranscribing, startRecording, stopRecording, cancelRecording };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // strip "data:...;base64,"
    };
    reader.readAsDataURL(blob);
  });
}
