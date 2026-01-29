
import { FrameData, ExportSettings } from '../types';

/**
 * 计算网格布局信息
 */
const getGridLayout = (count: number) => {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
};

/**
 * 将所有选择的帧拼接成一张大图 (Sprite Sheet)
 */
export const generateSpriteSheet = async (frames: FrameData[], settings: ExportSettings): Promise<string> => {
  const selectedFrames = frames.filter(f => f.selected);
  if (selectedFrames.length === 0) return "";

  const { cols, rows } = getGridLayout(selectedFrames.length);
  const canvas = document.createElement('canvas');
  canvas.width = cols * settings.width;
  canvas.height = rows * settings.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return "";

  const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = src;
  });

  for (let i = 0; i < selectedFrames.length; i++) {
    const frame = selectedFrames[i];
    const img = await loadImage(frame.processedBlob || frame.originalBlob);
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.drawImage(img, col * settings.width, row * settings.height, settings.width, settings.height);
  }

  return canvas.toDataURL('image/png');
};

export const generateSpineJson = (frames: FrameData[], settings: ExportSettings) => {
  const selectedFrames = frames.filter(f => f.selected);
  const frameNames = selectedFrames.map((_, i) => `${settings.prefix}_${i + 1}`);
  
  const attachments: any = {};
  frameNames.forEach((name) => {
    attachments[name] = {
      x: 0, 
      y: 0, 
      width: settings.width, 
      height: settings.height
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
      x: -settings.width / 2, 
      y: -settings.height / 2,
      width: settings.width, 
      height: settings.height,
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
  const { cols, rows } = getGridLayout(selectedFrames.length);
  const sheetWidth = cols * settings.width;
  const sheetHeight = rows * settings.height;

  let atlas = "skeleton.png\n";
  atlas += `size: ${sheetWidth},${sheetHeight}\n`;
  atlas += `format: RGBA8888\n`;
  atlas += `filter: Linear,Linear\n`;
  atlas += `repeat: none\n`;

  selectedFrames.forEach((_, i) => {
    const name = `${settings.prefix}_${i + 1}`;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * settings.width;
    const y = row * settings.height;

    atlas += `${name}\n`;
    atlas += `  rotate: false\n`;
    atlas += `  xy: ${x}, ${y}\n`;
    atlas += `  size: ${settings.width}, ${settings.height}\n`;
    atlas += `  orig: ${settings.width}, ${settings.height}\n`;
    atlas += `  offset: 0, 0\n`;
    atlas += `  index: -1\n`;
  });
  
  return atlas;
};
