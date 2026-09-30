#!/usr/bin/env python3
"""STT: faster-whisper local speech-to-text.

Usage:
    python scripts/stt.py <input.wav> [--model base] [--language zh]

Output:
    stdout → transcript text
    stderr → logs/errors
"""
import argparse
import logging
import sys

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_wav")
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="zh")
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(
        args.input_wav,
        language=args.language or None,
        beam_size=5,
    )
    transcript = " ".join(s.text.strip() for s in segments)
    print(transcript, end="")


if __name__ == "__main__":
    main()
