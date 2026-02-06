
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
  edgeShrink: number;
  pixelate: boolean;
  pixelSize: number;
  canvasWidth: number;
  canvasHeight: number;
  crop: boolean;
  cropMode: 'max' | 'fixed';
  fixedCropWidth: number;
  fixedCropHeight: number;
  cropMargin: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  enabled: boolean;
}

export interface ExportSettings {
  fps: number;
  prefix: string;
  // Sprite Sheet Layout
  layout: 'grid' | 'horizontal' | 'vertical';
  columns: number;
  // Frame Size
  useCurrentSize: boolean;
  frameWidth: number;
  frameHeight: number;
  lockRatio: boolean;
  // Scaling Algorithm
  scalingAlgorithm: string;
  // Spacing
  spacing: number;
}
