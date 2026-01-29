
export interface FrameData {
  id: number;
  originalBlob: string;
  processedBlob: string | null;
  selected: boolean;
  timestamp: number;
}

export interface ChromaSettings {
  targetColor: { r: number; g: number; b: number };
  threshold: number;
  smoothing: number;
  enabled: boolean;
}

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  prefix: string;
}
