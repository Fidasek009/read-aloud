import type { InferenceSession, Tensor } from 'onnxruntime-web';

interface Style { ttl: Tensor; dp: Tensor }
interface Engine {
  dpOrt: InferenceSession;
  textEncOrt: InferenceSession;
  vectorEstOrt: InferenceSession;
  vocoderOrt: InferenceSession;
  sampleRate: number;
  call(text: string, language: string, style: Style, steps: number, speed: number, silence: number): Promise<{ wav: number[]; duration: number[] }>;
}
export function loadTextToSpeech(directory: string, options: InferenceSession.SessionOptions): Promise<{ textToSpeech: Engine }>;
export function loadVoiceStyle(paths: string[]): Promise<Style>;
