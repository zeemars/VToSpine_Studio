
import { ChromaSettings } from '../types';

export const extractFramesFromVideo = async (
  videoUrl: string,
  frameCount: number,
  onProgress: (progress: number) => void
): Promise<{ blob: string; timestamp: number }[]> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.crossOrigin = 'anonymous';

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const interval = duration / frameCount;
      const frames: { blob: string; timestamp: number }[] = [];
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) return resolve([]);

      for (let i = 0; i < frameCount; i++) {
        const time = i * interval;
        video.currentTime = time;
        await new Promise((r) => (video.onseeked = r));
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push({
          blob: canvas.toDataURL('image/png'),
          timestamp: time
        });
        onProgress(((i + 1) / frameCount) * 100);
      }
      resolve(frames);
    };
  });
};

export const getTopLeftColor = (sourceBase64: string): Promise<{ r: number; g: number; b: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = sourceBase64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve({ r: 0, g: 0, b: 0 });
      ctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
      const pixel = ctx.getImageData(0, 0, 1, 1).data;
      resolve({ r: pixel[0], g: pixel[1], b: pixel[2] });
    };
  });
};

export const applyChromaKey = (
  sourceBase64: string,
  settings: ChromaSettings
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = sourceBase64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(sourceBase64);

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      const { r: targetR, g: targetG, b: targetB } = settings.targetColor;
      const { threshold, smoothing } = settings;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Euclidean distance in color space
        const distance = Math.sqrt(
          Math.pow(r - targetR, 2) +
          Math.pow(g - targetG, 2) +
          Math.pow(b - targetB, 2)
        );

        if (distance < threshold) {
          data[i + 3] = 0; // Transparent
        } else if (distance < threshold + smoothing) {
          // Smooth edge
          const alpha = (distance - threshold) / smoothing;
          data[i + 3] = alpha * 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
  });
};
