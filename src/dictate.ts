/* Deepgram streaming dictation with live interim results.
   Key comes from VITE_DEEPGRAM_API_KEY (.env). Falls back to the browser's
   built-in speech engine when no key is set. */
import { useRef, useState } from "react";

export type DictState = "idle" | "listening" | "connecting";

export function useDictation() {
  const [state, setState] = useState<DictState>("idle");
  const [interim, setInterim] = useState("");
  const [engine, setEngine] = useState<"deepgram" | "browser" | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const srRef = useRef<{ stop: () => void } | null>(null);
  const onFinalRef = useRef<(t: string) => void>(() => {});
  // `state` in a closure is stale right after stop(); a ref is always current,
  // so switching the mic from one field to another works on the first tap.
  const activeRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const stop = () => {
    wsRef.current?.close(); wsRef.current = null;
    recRef.current?.stop(); recRef.current = null;
    srRef.current?.stop(); srRef.current = null;
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    activeRef.current = false;
    setState("idle"); setInterim("");
  };

  const start = async (onFinal: (text: string) => void, onError: (msg: string) => void) => {
    if (activeRef.current) stop();
    activeRef.current = true;
    // A forgotten mic should not stream (and bill) forever.
    timerRef.current = window.setTimeout(() => { stop(); onError("Dictation stopped after 10 minutes — tap to continue"); }, 10 * 60 * 1000);
    onFinalRef.current = onFinal;
    const key = import.meta.env.VITE_DEEPGRAM_API_KEY as string | undefined;

    if (key) {
      try {
        setState("connecting");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ws = new WebSocket(
          "wss://api.deepgram.com/v1/listen?model=nova-2&language=en-IN&interim_results=true&smart_format=true&punctuate=true",
          ["token", key]
        );
        wsRef.current = ws;
        ws.onopen = () => {
          setState("listening"); setEngine("deepgram");
          const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
          recRef.current = rec;
          rec.ondataavailable = (e) => { if (e.data.size > 0 && ws.readyState === 1) ws.send(e.data); };
          rec.start(250);
        };
        ws.onmessage = (msg) => {
          try {
            const d = JSON.parse(msg.data);
            const alt = d.channel?.alternatives?.[0];
            if (!alt) return;
            if (d.is_final) { if (alt.transcript) onFinalRef.current(alt.transcript); setInterim(""); }
            else setInterim(alt.transcript ?? "");
          } catch { /* ignore non-JSON frames */ }
        };
        ws.onerror = () => { onError("Deepgram connection failed — check the API key in .env"); stop(); };
        ws.onclose = () => { stream.getTracks().forEach((t) => t.stop()); };
        return;
      } catch {
        onError("Microphone unavailable"); stop(); return;
      }
    }

    // fallback: browser speech engine
    const W = window as unknown as { webkitSpeechRecognition?: new () => { lang: string; continuous: boolean; interimResults: boolean; onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string }; isFinal?: boolean } | { 0: { transcript: string }; isFinal: boolean }; length: number }; resultIndex: number }) => void; onend: () => void; start: () => void; stop: () => void } };
    const SR = W.webkitSpeechRecognition;
    if (!SR) { onError("No Deepgram key set and this browser has no speech engine — paste VITE_DEEPGRAM_API_KEY into .env"); return; }
    const rec = new SR();
    rec.lang = "en-IN"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let fin = "", inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i] as { 0: { transcript: string }; isFinal: boolean };
        if (r.isFinal) fin += r[0].transcript; else inter += r[0].transcript;
      }
      if (fin) { onFinalRef.current(fin.trim()); setInterim(""); }
      else setInterim(inter);
    };
    rec.onend = () => setState("idle");
    rec.start(); srRef.current = rec; setEngine("browser"); setState("listening");
  };

  return { state, interim, engine, start, stop };
}
