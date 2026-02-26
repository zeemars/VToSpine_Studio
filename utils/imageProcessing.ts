
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



function applyPerfectPixel(canvas: HTMLCanvasElement, pixelSize: number): HTMLCanvasElement {
  // Early return if pixel size is 1 or canvas is too small
  if (pixelSize <= 1 || canvas.width < pixelSize || canvas.height < pixelSize) {
    return canvas;
  }
  
  // Calculate grid size directly based on pixel size
  const gridW = Math.floor(canvas.width / pixelSize);
  const gridH = Math.floor(canvas.height / pixelSize);
  
  // Create output canvas with reduced size
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = gridW;
  outputCanvas.height = gridH;
  const outputCtx = outputCanvas.getContext('2d')!;
  const outputData = outputCtx.createImageData(gridW, gridH);
  
  // Get original image data
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const { width, height } = canvas;
  
  // Process each grid cell
  for (let j = 0; j < gridH; j++) {
    const y0 = j * pixelSize;
    const y1 = Math.min((j + 1) * pixelSize, height);
    
    for (let i = 0; i < gridW; i++) {
      const x0 = i * pixelSize;
      const x1 = Math.min((i + 1) * pixelSize, width);
      
      let totalAlpha = 0;
      const colorCounts: Record<string, number> = {};
      let maxCount = 0;
      let majorityColor = [0, 0, 0];
      
      // Process pixels in the cell
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const index = (y * width + x) * 4;
          const alpha = data[index + 3];
          totalAlpha += alpha;
          
          if (alpha > 0) {
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            const key = `${r},${g},${b}`;
            
            // Update color count
            const count = (colorCounts[key] || 0) + 1;
            colorCounts[key] = count;
            
            // Update majority color
            if (count > maxCount) {
              maxCount = count;
              majorityColor = [r, g, b];
            }
          }
        }
      }
      
      // Calculate average alpha
      const cellArea = (y1 - y0) * (x1 - x0);
      const averageAlpha = cellArea > 0 ? totalAlpha / cellArea : 0;
      
      // Set output pixel
      const outputIndex = (j * gridW + i) * 4;
      outputData.data[outputIndex] = majorityColor[0];
      outputData.data[outputIndex + 1] = majorityColor[1];
      outputData.data[outputIndex + 2] = majorityColor[2];
      outputData.data[outputIndex + 3] = Math.round(averageAlpha);
    }
  }
  
  // Put processed data to output canvas
  outputCtx.putImageData(outputData, 0, 0);
  
  // Create final canvas with pixelated effect
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = canvas.width;
  finalCanvas.height = canvas.height;
  const finalCtx = finalCanvas.getContext('2d')!;
  
  // Draw sampled image back to original size with no smoothing
  finalCtx.imageSmoothingEnabled = false;
  finalCtx.drawImage(outputCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
  
  return finalCanvas;
}

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

        // Early exit if shrink distance is too large for the canvas
        if (shrinkDistance >= Math.min(canvas.width, canvas.height) / 2) {
          ctx.putImageData(imageData, 0, 0);
        } else {
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const index = (y * canvas.width + x) * 4;
              const alpha = data[index + 3];

              if (alpha > 0) {
                // Check surrounding pixels with early exit
                let hasTransparentNeighbor = false;
                
                // Only check within the actual canvas bounds
                const startY = Math.max(0, y - shrinkDistance);
                const endY = Math.min(canvas.height - 1, y + shrinkDistance);
                const startX = Math.max(0, x - shrinkDistance);
                const endX = Math.min(canvas.width - 1, x + shrinkDistance);
                
                // Check only the perimeter of the shrink distance
                // This reduces the number of checks from (2d+1)^2 to 4d
                for (let dy = startY; dy <= endY; dy++) {
                  if (dy === startY || dy === endY) {
                    // Check entire row
                    for (let dx = startX; dx <= endX; dx++) {
                      if (dx === x && dy === y) continue;
                      const neighborIndex = (dy * canvas.width + dx) * 4;
                      if (data[neighborIndex + 3] === 0) {
                        hasTransparentNeighbor = true;
                        break;
                      }
                    }
                  } else {
                    // Check only first and last column
                    const leftIndex = (dy * canvas.width + startX) * 4;
                    const rightIndex = (dy * canvas.width + endX) * 4;
                    if (data[leftIndex + 3] === 0 || data[rightIndex + 3] === 0) {
                      hasTransparentNeighbor = true;
                      break;
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
        }
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
        // Use perfect pixelation algorithm
        finalCanvas = applyPerfectPixel(finalCanvas, settings.pixelSize);
        finalCtx = finalCanvas.getContext('2d')!;
      }

      // Crop is now handled in batch mode via handleCrop function in App.tsx
      // This function no longer performs individual frame cropping

      // Use final canvas for output
      resolve(finalCanvas.toDataURL('image/png'));
    };
  });
};
