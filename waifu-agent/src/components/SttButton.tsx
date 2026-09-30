import { useStt } from "../hooks/useStt";

interface Props {
  onResult: (text: string) => void;
  language?: string;
}

export function SttButton({ onResult, language }: Props) {
  const { isRecording, isTranscribing, startRecording, stopRecording, cancelRecording } = useStt(language);

  const handleMouseDown = async () => {
    try {
      await startRecording();
    } catch (e) {
      console.error("Mic access denied:", e);
    }
  };

  const handleMouseUp = async () => {
    if (!isRecording) return;
    const text = await stopRecording();
    if (text) onResult(text);
  };

  const handleMouseLeave = () => {
    if (isRecording) cancelRecording();
  };

  const icon = isTranscribing ? "⏳" : isRecording ? "🔴" : "🎤";
  const title = isTranscribing ? "转录中..." : isRecording ? "松开发送" : "按住说话";

  return (
    <button
      onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(); }}
      onMouseUp={(e) => { e.stopPropagation(); handleMouseUp(); }}
      onMouseLeave={handleMouseLeave}
      disabled={isTranscribing}
      title={title}
      style={{
        width: 32, height: 32,
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.15)",
        background: isRecording ? "rgba(220,50,50,0.5)" : "rgba(30,30,40,0.6)",
        color: "#ddd", fontSize: 16, cursor: isTranscribing ? "wait" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {icon}
    </button>
  );
}
