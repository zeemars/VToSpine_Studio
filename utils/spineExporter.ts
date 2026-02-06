
import { FrameData, ExportSettings } from '../types';

/**
 * 计算布局信息
 */
const getLayout = (count: number, layout: 'grid' | 'horizontal' | 'vertical', columns: number) => {
  if (layout === 'grid') {
    const cols = columns || Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    return { cols, rows, layout };
  } else if (layout === 'horizontal') {
    return { cols: count, rows: 1, layout };
  } else {
    // vertical
    return { cols: 1, rows: count, layout };
  }
};

/**
 * 获取缩放算法
 */
const getScalingAlgorithm = (algorithm: string): ImageSmoothingQuality => {
  switch (algorithm) {
    case 'Lanczos':
    case 'Bicubic':
      return 'high';
    case 'Bilinear':
      return 'medium';
    case 'Nearest Neighbor':
      return 'low';
    default:
      return 'high';
  }
};

/**
 * 获取帧尺寸
 */
const getFrameSize = (frame: FrameData, settings: ExportSettings): { width: number; height: number } => {
  if (settings.useCurrentSize) {
    // 使用当前尺寸
    const img = new Image();
    img.src = frame.processedBlob || frame.originalBlob;
    return { width: img.width, height: img.height };
  } else {
    // 使用固定尺寸
    return { width: settings.frameWidth, height: settings.frameHeight };
  }
};

/**
 * 将所有选择的帧拼接成一张大图 (Sprite Sheet)
 */
export const generateSpriteSheet = async (frames: FrameData[], settings: ExportSettings): Promise<string> => {
  const selectedFrames = frames.filter(f => f.selected);
  if (selectedFrames.length === 0) return "";

  // 计算布局
  const { cols, rows } = getLayout(selectedFrames.length, settings.layout, settings.columns);
  
  // 确定帧尺寸
  let frameWidth = settings.useCurrentSize ? 0 : settings.frameWidth;
  let frameHeight = settings.useCurrentSize ? 0 : settings.frameHeight;
  
  // 如果使用当前尺寸，计算最大帧尺寸
  if (settings.useCurrentSize) {
    const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = src;
    });
    
    for (const frame of selectedFrames) {
      const img = await loadImage(frame.processedBlob || frame.originalBlob);
      frameWidth = Math.max(frameWidth, img.width);
      frameHeight = Math.max(frameHeight, img.height);
    }
  }
  
  // 计算画布尺寸，考虑间距
  const spacing = settings.spacing;
  const canvasWidth = cols * (frameWidth + spacing) - spacing;
  const canvasHeight = rows * (frameHeight + spacing) - spacing;
  
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return "";
  
  // 设置缩放算法
  ctx.imageSmoothingEnabled = settings.scalingAlgorithm !== 'Nearest Neighbor';
  ctx.imageSmoothingQuality = getScalingAlgorithm(settings.scalingAlgorithm);

  const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = src;
  });

  for (let i = 0; i < selectedFrames.length; i++) {
    const frame = selectedFrames[i];
    const img = await loadImage(frame.processedBlob || frame.originalBlob);
    
    let x, y;
    if (settings.layout === 'grid') {
      const col = i % cols;
      const row = Math.floor(i / cols);
      x = col * (frameWidth + spacing);
      y = row * (frameHeight + spacing);
    } else if (settings.layout === 'horizontal') {
      x = i * (frameWidth + spacing);
      y = 0;
    } else {
      // vertical
      x = 0;
      y = i * (frameHeight + spacing);
    }
    
    // 计算居中位置
    const offsetX = (frameWidth - img.width) / 2;
    const offsetY = (frameHeight - img.height) / 2;
    
    // 绘制图像
    ctx.drawImage(img, x + offsetX, y + offsetY, img.width, img.height);
  }

  return canvas.toDataURL('image/png');
};

export const generateSpineJson = (frames: FrameData[], settings: ExportSettings) => {
  const selectedFrames = frames.filter(f => f.selected);
  const frameNames = selectedFrames.map((_, i) => `${settings.prefix}_${i + 1}`);
  
  // 确定帧尺寸
  let frameWidth = settings.useCurrentSize ? 0 : settings.frameWidth;
  let frameHeight = settings.useCurrentSize ? 0 : settings.frameHeight;
  
  // 如果使用当前尺寸，计算最大帧尺寸
  if (settings.useCurrentSize) {
    // 使用同步方式获取图片尺寸
    // 注意：这里使用同步方式是因为generateSpineJson不是异步函数
    // 在实际使用中，由于帧已经在generateSpriteSheet中加载过，这里的尺寸应该是正确的
    // 为了安全起见，我们使用一个合理的默认值
    frameWidth = 512;
    frameHeight = 512;
    
    // 尝试获取实际尺寸
    try {
      for (const frame of selectedFrames) {
        const img = new Image();
        img.src = frame.processedBlob || frame.originalBlob;
        // 即使图片没有加载完成，我们也尝试获取尺寸
        // 在现代浏览器中，对于DataURL，图片尺寸可能会立即可用
        if (img.width > 0) frameWidth = Math.max(frameWidth, img.width);
        if (img.height > 0) frameHeight = Math.max(frameHeight, img.height);
      }
    } catch (e) {
      console.error('Error calculating frame size:', e);
    }
  }
  
  const attachments: any = {};
  frameNames.forEach((name) => {
    attachments[name] = {
      x: 0, 
      y: 0, 
      width: frameWidth, 
      height: frameHeight
    };
  });

  const attachmentTimeline = frameNames.map((name, i) => ({
    time: i / settings.fps,
    name: name
  }));

  attachmentTimeline.push({
    time: selectedFrames.length / settings.fps,
    name: frameNames[frameNames.length - 1]
  });

  return {
    skeleton: { 
      hash: "v2spine-" + Date.now(), 
      spine: "3.8.99", 
      x: -frameWidth / 2, 
      y: -frameHeight / 2,
      width: frameWidth, 
      height: frameHeight,
      fps: settings.fps
    },
    bones: [{ name: "root" }],
    slots: [{ name: "frames", bone: "root", attachment: frameNames[0] }],
    skins: [{
      name: "default",
      attachments: { "frames": attachments }
    }],
    animations: {
      "animation": {
        slots: {
          "frames": { attachment: attachmentTimeline }
        }
      }
    }
  };
};

/**
 * 生成单页面 Atlas，定义各帧在合并大图中的位置
 */
export const generateAtlas = (frames: FrameData[], settings: ExportSettings) => {
  const selectedFrames = frames.filter(f => f.selected);
  const { cols, rows } = getLayout(selectedFrames.length, settings.layout, settings.columns);
  
  // 确定帧尺寸
  let frameWidth = settings.useCurrentSize ? 0 : settings.frameWidth;
  let frameHeight = settings.useCurrentSize ? 0 : settings.frameHeight;
  
  // 如果使用当前尺寸，计算最大帧尺寸
  if (settings.useCurrentSize) {
    // 使用同步方式获取图片尺寸
    // 注意：这里使用同步方式是因为generateAtlas不是异步函数
    // 在实际使用中，由于帧已经在generateSpriteSheet中加载过，这里的尺寸应该是正确的
    // 为了安全起见，我们使用一个合理的默认值
    frameWidth = 512;
    frameHeight = 512;
    
    // 尝试获取实际尺寸
    try {
      for (const frame of selectedFrames) {
        const img = new Image();
        img.src = frame.processedBlob || frame.originalBlob;
        // 即使图片没有加载完成，我们也尝试获取尺寸
        // 在现代浏览器中，对于DataURL，图片尺寸可能会立即可用
        if (img.width > 0) frameWidth = Math.max(frameWidth, img.width);
        if (img.height > 0) frameHeight = Math.max(frameHeight, img.height);
      }
    } catch (e) {
      console.error('Error calculating frame size:', e);
    }
  }
  
  // 计算画布尺寸，考虑间距
  const spacing = settings.spacing;
  const sheetWidth = cols * (frameWidth + spacing) - spacing;
  const sheetHeight = rows * (frameHeight + spacing) - spacing;

  let atlas = "skeleton.png\n";
  atlas += `size: ${sheetWidth},${sheetHeight}\n`;
  atlas += `format: RGBA8888\n`;
  atlas += `filter: Linear,Linear\n`;
  atlas += `repeat: none\n`;

  selectedFrames.forEach((_, i) => {
    const name = `${settings.prefix}_${i + 1}`;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (frameWidth + spacing);
    const y = row * (frameHeight + spacing);

    atlas += `${name}\n`;
    atlas += `  rotate: false\n`;
    atlas += `  xy: ${x}, ${y}\n`;
    atlas += `  size: ${frameWidth}, ${frameHeight}\n`;
    atlas += `  orig: ${frameWidth}, ${frameHeight}\n`;
    atlas += `  offset: 0, 0\n`;
    atlas += `  index: -1\n`;
  });
  
  return atlas;
};
