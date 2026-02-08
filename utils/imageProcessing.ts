
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
      const { threshold, smoothing, edgeShrink } = settings;

      // Step 1: Apply chroma key
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

      // Step 2: Apply edge shrink if needed
      if (edgeShrink > 0) {
        const shrinkDistance = edgeShrink;
        const newData = new Uint8ClampedArray(data);

        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const index = (y * canvas.width + x) * 4;
            const alpha = data[index + 3];

            if (alpha > 0) {
              // Check surrounding pixels
              let hasTransparentNeighbor = false;
              
              for (let dy = -shrinkDistance; dy <= shrinkDistance; dy++) {
                for (let dx = -shrinkDistance; dx <= shrinkDistance; dx++) {
                  if (dx === 0 && dy === 0) continue;
                  
                  const nx = x + dx;
                  const ny = y + dy;
                  
                  if (nx >= 0 && nx < canvas.width && ny >= 0 && ny < canvas.height) {
                    const neighborIndex = (ny * canvas.width + nx) * 4;
                    const neighborAlpha = data[neighborIndex + 3];
                    
                    if (neighborAlpha === 0) {
                      hasTransparentNeighbor = true;
                      break;
                    }
                  }
                }
                if (hasTransparentNeighbor) break;
              }

              if (hasTransparentNeighbor) {
                newData[index + 3] = 0; // Make transparent
              }
            }
          }
        }

        ctx.putImageData(new ImageData(newData, canvas.width, canvas.height), 0, 0);
      } else {
        ctx.putImageData(imageData, 0, 0);
      }

      // Step 3: Apply canvas resize
      let finalCanvas = canvas;
      let finalCtx = ctx;
      
      // Create resized canvas if needed
      if (settings.canvasWidth !== canvas.width || settings.canvasHeight !== canvas.height) {
        const resizeCanvas = document.createElement('canvas');
        resizeCanvas.width = settings.canvasWidth;
        resizeCanvas.height = settings.canvasHeight;
        const resizeCtx = resizeCanvas.getContext('2d');
        
        if (resizeCtx) {
          // Calculate aspect ratio to maintain proportions
          const aspectRatio = Math.min(
            settings.canvasWidth / canvas.width,
            settings.canvasHeight / canvas.height
          );
          const newWidth = canvas.width * aspectRatio;
          const newHeight = canvas.height * aspectRatio;
          
          // Calculate offset based on canvasPosition
          let offsetX = 0;
          let offsetY = 0;
          
          switch (settings.canvasPosition) {
            case 'top-left':
              offsetX = 0;
              offsetY = 0;
              break;
            case 'top-center':
              offsetX = (settings.canvasWidth - newWidth) / 2;
              offsetY = 0;
              break;
            case 'top-right':
              offsetX = settings.canvasWidth - newWidth;
              offsetY = 0;
              break;
            case 'center-left':
              offsetX = 0;
              offsetY = (settings.canvasHeight - newHeight) / 2;
              break;
            case 'center':
              offsetX = (settings.canvasWidth - newWidth) / 2;
              offsetY = (settings.canvasHeight - newHeight) / 2;
              break;
            case 'center-right':
              offsetX = settings.canvasWidth - newWidth;
              offsetY = (settings.canvasHeight - newHeight) / 2;
              break;
            case 'bottom-left':
              offsetX = 0;
              offsetY = settings.canvasHeight - newHeight;
              break;
            case 'bottom-center':
              offsetX = (settings.canvasWidth - newWidth) / 2;
              offsetY = settings.canvasHeight - newHeight;
              break;
            case 'bottom-right':
              offsetX = settings.canvasWidth - newWidth;
              offsetY = settings.canvasHeight - newHeight;
              break;
          }
          
          // Draw image to resized canvas
          resizeCtx.drawImage(
            canvas, 
            offsetX, offsetY, 
            newWidth, newHeight
          );
          
          finalCanvas = resizeCanvas;
          finalCtx = resizeCtx;
        }
      }
      
      // Apply pixelation if pixelate is enabled and pixelSize > 1
      if (settings.pixelate && settings.pixelSize > 1) {
        const pixelSize = settings.pixelSize;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = Math.floor(finalCanvas.width / pixelSize);
        tempCanvas.height = Math.floor(finalCanvas.height / pixelSize);
        const tempCtx = tempCanvas.getContext('2d');
        
        if (tempCtx) {
          // Draw image to temp canvas with reduced size
          tempCtx.drawImage(finalCanvas, 0, 0, tempCanvas.width, tempCanvas.height);
          
          // Clear final canvas
          finalCtx.clearRect(0, 0, finalCanvas.width, finalCanvas.height);
          
          // Draw pixelated image back to final canvas
          finalCtx.imageSmoothingEnabled = false;
          finalCtx.drawImage(tempCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
        }
      }

      // Crop is now handled in batch mode via handleCrop function in App.tsx
      // This function no longer performs individual frame cropping

      // Use final canvas for output
      resolve(finalCanvas.toDataURL('image/png'));
    };
  });
};
