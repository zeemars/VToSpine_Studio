import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Settings, Trash2, Play, Pause, Rewind, Download, CheckCircle2, Eraser, Monitor,
  Image as ImageIcon, Loader2, Languages, ChevronRight, ChevronLeft, Eye, 
  Palette, Github, Check, FileVideo, AlertTriangle, Plus, RefreshCcw, X, Edit3, Layers,
  Minimize2, Maximize2, Scissors
} from 'lucide-react';
import { FrameData, ChromaSettings, ExportSettings } from './types';
import { extractFramesFromVideo, applyChromaKey, getTopLeftColor } from './utils/imageProcessing';
import { generateSpineJson, generateAtlas, generateSpriteSheet } from './utils/spineExporter';
import { translations, Language } from './translations';

interface BatchTask {
  id: string;
  file: File;
  name: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  frames: FrameData[];
  progress: number;
  videoUrl: string;
  thumbnail?: string;
  settings: ChromaSettings;
}

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>('zh');
  const t = translations[lang];

  const [currentStep, setCurrentStep] = useState(1);
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [globalProcessing, setGlobalProcessing] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  
  // Export States
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [gifWorkerUrl, setGifWorkerUrl] = useState<string | null>(null);
  const [isLibLoaded, setIsLibLoaded] = useState(false);

  // Detail View States
  const [previewFrameIdx, setPreviewFrameIdx] = useState(0);
  const [previewBg, setPreviewBg] = useState<'checker' | 'white' | 'black' | 'green' | 'blue'>('checker');
  const [showProcessedInPreview, setShowProcessedInPreview] = useState(true);
  const [previewPaused, setPreviewPaused] = useState(true);

  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    fps: 15, prefix: 'anim',
    layout: 'grid',
    columns: 4,
    useCurrentSize: true,
    frameWidth: 310,
    frameHeight: 494,
    lockRatio: true,
    scalingAlgorithm: 'Lanczos',
    spacing: 0
  });

  // 预览窗口状态
  const [previewWindow, setPreviewWindow] = useState({
    position: { x: 32, y: window.innerHeight - 400 }, // 初始位置
    isDragging: false,
    startDrag: { x: 0, y: 0 },
    isMinimized: false
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeTask = tasks.find(t => t.id === activeTaskId);

  useEffect(() => {
    const initGifLib = async () => {
      try {
        if (!(window as any).GIF) { setTimeout(initGifLib, 500); return; }
        const response = await fetch('https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setGifWorkerUrl(url);
        setIsLibLoaded(true);
      } catch (err) { console.error("GIF worker error:", err); }
    };
    initGifLib();
  }, []);

  // 预览窗口拖动事件处理
  const handleMouseDown = (e: React.MouseEvent) => {
    setPreviewWindow(prev => ({
      ...prev,
      isDragging: true,
      startDrag: {
        x: e.clientX - prev.position.x,
        y: e.clientY - prev.position.y
      }
    }));
  };

  // 添加全局鼠标事件监听器
  useEffect(() => {
    if (previewWindow.isDragging) {
      // 创建一个闭包，捕获当前的startDrag值
      const startDrag = { ...previewWindow.startDrag };
      
      const handleGlobalMouseMove = (e: MouseEvent) => {
        setPreviewWindow(prev => ({
          ...prev,
          position: {
            x: e.clientX - startDrag.x,
            y: e.clientY - startDrag.y
          }
        }));
      };
      
      const handleGlobalMouseUp = () => {
        setPreviewWindow(prev => ({
          ...prev,
          isDragging: false
        }));
      };
      
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [previewWindow.isDragging]);

  useEffect(() => {
    if (activeTask && activeTask.frames.length > 0 && !previewPaused) {
      const selectedFrames = activeTask.frames.filter(f => f.selected);
      if (selectedFrames.length === 0) return;
      const interval = setInterval(() => {
        setPreviewFrameIdx(prev => (prev + 1) % selectedFrames.length);
      }, 1000 / exportSettings.fps);
      return () => clearInterval(interval);
    }
  }, [activeTaskId, activeTask?.frames, exportSettings.fps, previewPaused]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const newTasks: BatchTask[] = Array.from(files).map((file: File) => ({
        id: Math.random().toString(36).substr(2, 9),
        file, 
        name: file.name, 
        status: 'pending', 
        frames: [], 
        progress: 0,
        videoUrl: URL.createObjectURL(file),
        settings: { targetColor: { r: 0, g: 0, b: 0 }, threshold: 30, smoothing: 10, edgeShrink: 0, pixelate: false, pixelSize: 4, canvasWidth: 512, canvasHeight: 512, crop: false, cropMode: 'max', fixedCropWidth: 512, fixedCropHeight: 512, cropMargin: { top: 0, bottom: 0, left: 0, right: 0 }, enabled: true }
      }));
      setTasks(prev => [...prev, ...newTasks]);
      if (!activeTaskId && newTasks.length > 0) setActiveTaskId(newTasks[0].id);
      setCurrentStep(2);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const processSingleTask = async (id: string, useAutoColor = true) => {
    const taskIdx = tasks.findIndex(t => t.id === id);
    if (taskIdx === -1) return;

    const task = { ...tasks[taskIdx] };
    task.status = 'processing';
    updateTask(task);

    try {
      const extracted = await extractFramesFromVideo(task.videoUrl, 20, (p) => {
        task.progress = p * 0.5;
        updateTask(task);
      });

      if (extracted.length > 0) {
        let finalSettings = { ...task.settings };
        if (useAutoColor) {
          const autoColor = await getTopLeftColor(extracted[0].blob);
          finalSettings.targetColor = autoColor;
        }

        const processedFrames: FrameData[] = [];
        for (let j = 0; j < extracted.length; j++) {
          const processed = await applyChromaKey(extracted[j].blob, finalSettings);
          processedFrames.push({
            id: j, originalBlob: extracted[j].blob, processedBlob: processed,
            selected: true, timestamp: extracted[j].timestamp
          });
          task.progress = 50 + ((j + 1) / extracted.length) * 50;
          updateTask(task);
        }
        task.frames = processedFrames;
        task.settings = finalSettings;
        task.status = 'done';
        task.thumbnail = extracted[0].blob;
      }
    } catch (err) { task.status = 'error'; }
    updateTask(task);
    // 处理完成后确保预览是暂停状态
    setPreviewPaused(true);
  };

  const processAllTasks = async () => {
    setGlobalProcessing(true);
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].status === 'done') continue;
      await processSingleTask(tasks[i].id, true);
      setOverallProgress(((i + 1) / tasks.length) * 100);
    }
    setGlobalProcessing(false);
  };

  const updateTask = (updatedTask: BatchTask) => {
    setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
  };

  const handleManualSettingsChange = (newSettings: Partial<ChromaSettings>) => {
    if (!activeTask) return;
    const task = { ...activeTask, settings: { ...activeTask.settings, ...newSettings } };
    updateTask(task);
    // 只更新设置，不进行实时处理
    // 处理将由用户点击按钮触发
  };
  
  const handleApplySettings = async () => {
    if (!activeTask) return;
    
    setGlobalProcessing(true);
    
    try {
      const task = { ...activeTask };
      const newFrames = [...task.frames];
      for (let i = 0; i < newFrames.length; i++) {
        newFrames[i].processedBlob = await applyChromaKey(newFrames[i].originalBlob, task.settings);
      }
      task.frames = newFrames;
      updateTask(task);
    } catch (error) {
      console.error('Error applying settings:', error);
    } finally {
      setGlobalProcessing(false);
      setPreviewPaused(true);
    }
  };
  
  const handleCrop = async () => {
    if (!activeTask) return;
    
    setGlobalProcessing(true);
    
    try {
      // Step 1: Calculate boundaries for all frames to determine max size
      let maxWidth = 0;
      let maxHeight = 0;
      const frameBoundaries = [];
      
      // First pass: Calculate boundaries for each frame
      for (let i = 0; i < activeTask.frames.length; i++) {
        const frame = activeTask.frames[i];
        if (!frame.processedBlob) continue;
        
        // Create canvas and load image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        
        const img = new Image();
        img.src = frame.processedBlob;
        await new Promise(resolve => { img.onload = resolve; });
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        // Calculate boundaries
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        let minX = canvas.width;
        let maxX = 0;
        let minY = canvas.height;
        let maxY = 0;
        
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const index = (y * canvas.width + x) * 4;
            const alpha = data[index + 3];
            if (alpha > 0) {
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
          }
        }
        
        // Add margins
        const margin = activeTask.settings.cropMargin;
        minX = Math.max(0, minX - margin.left);
        maxX = Math.min(canvas.width - 1, maxX + margin.right);
        minY = Math.max(0, minY - margin.top);
        maxY = Math.min(canvas.height - 1, maxY + margin.bottom);
        
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        
        frameBoundaries.push({ minX, maxX, minY, maxY, width, height });
        
        if (activeTask.settings.cropMode === 'max') {
          maxWidth = Math.max(maxWidth, width);
          maxHeight = Math.max(maxHeight, height);
        }
      }
      
      // Step 2: Apply cropping to all frames
      const updatedFrames = [...activeTask.frames];
      
      for (let i = 0; i < updatedFrames.length; i++) {
        const frame = updatedFrames[i];
        if (!frame.processedBlob) continue;
        
        const boundaries = frameBoundaries[i];
        if (!boundaries) continue;
        
        // Create canvas and load image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        
        const img = new Image();
        img.src = frame.processedBlob;
        await new Promise(resolve => { img.onload = resolve; });
        
        // Determine crop size based on mode
        let cropWidth, cropHeight, offsetX, offsetY;
        
        if (activeTask.settings.cropMode === 'max') {
          cropWidth = maxWidth;
          cropHeight = maxHeight;
          offsetX = (maxWidth - boundaries.width) / 2;
          offsetY = (maxHeight - boundaries.height) / 2;
        } else {
          // Fixed size mode
          cropWidth = activeTask.settings.fixedCropWidth;
          cropHeight = activeTask.settings.fixedCropHeight;
          offsetX = (cropWidth - boundaries.width) / 2;
          offsetY = (cropHeight - boundaries.height) / 2;
        }
        
        // Create crop canvas
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropWidth;
        cropCanvas.height = cropHeight;
        const cropCtx = cropCanvas.getContext('2d');
        if (!cropCtx) continue;
        
        // Clear canvas with transparent background
        cropCtx.clearRect(0, 0, cropWidth, cropHeight);
        
        // Draw cropped region centered in the new canvas
        cropCtx.drawImage(
          img,
          boundaries.minX, boundaries.minY,
          boundaries.width, boundaries.height,
          offsetX, offsetY,
          boundaries.width, boundaries.height
        );
        
        // Update frame with cropped image
        updatedFrames[i] = {
          ...frame,
          processedBlob: cropCanvas.toDataURL('image/png')
        };
      }
      
      // Update task with cropped frames
      setTasks(prev => prev.map(task => 
        task.id === activeTask.id 
          ? { ...task, frames: updatedFrames }
          : task
      ));
      
    } catch (error) {
      console.error('Crop error:', error);
    } finally {
      setGlobalProcessing(false);
    }
  };

  const getSafeBaseName = (filename: string, id: string) => {
    const parts = filename.split('.');
    if (parts.length > 1) parts.pop();
    const base = parts.join('.') || 'animation';
    return base;
  };

  const batchExportSpine = async () => {
    const JSZip = (window as any).JSZip;
    if (!JSZip) return alert(t.alertZipError);
    const completedTasks = tasks.filter(t => t.status === 'done');
    if (completedTasks.length === 0) return alert(t.alertSelectFrame);
    
    setIsExporting(true);
    setExportProgress(0);
    const zip = new JSZip();
    
    for (let i = 0; i < completedTasks.length; i++) {
      const task = completedTasks[i];
      const folderName = getSafeBaseName(task.name, task.id);
      const taskFolder = zip.folder(folderName);
      
      const spriteSheetBase64 = await generateSpriteSheet(task.frames, exportSettings);
      const spriteSheetData = spriteSheetBase64.split(',')[1];
      taskFolder.file("skeleton.png", spriteSheetData, { base64: true });
      taskFolder.file("skeleton.json", JSON.stringify(generateSpineJson(task.frames, exportSettings), null, 2));
      taskFolder.file("skeleton.atlas", generateAtlas(task.frames, exportSettings));
      
      setExportProgress(((i + 1) / completedTasks.length) * 100);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `spine_grid_atlas_${Date.now()}.zip`;
    link.click();
    setIsExporting(false);
  };

  const batchExportGifs = async () => {
    const GIF = (window as any).GIF;
    const JSZip = (window as any).JSZip;
    if (!GIF || !gifWorkerUrl || !JSZip) return alert(t.alertZipError);
    const completedTasks = tasks.filter(t => t.status === 'done');
    if (completedTasks.length === 0) return alert(t.alertSelectFrame);
    setIsExporting(true);
    const zip = new JSZip();
    
    const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((res) => { 
      const img = new Image(); 
      img.onload = () => res(img); 
      img.src = src; 
    });

    for (let i = 0; i < completedTasks.length; i++) {
      const task = completedTasks[i];
      setExportProgress(((i + 0.1) / completedTasks.length) * 100);
      
      const gif = new GIF({ 
        workers: 2, 
        quality: 10, 
        width: exportSettings.frameWidth, 
        height: exportSettings.frameHeight, 
        workerScript: gifWorkerUrl, 
        transparent: 'rgba(0,0,0,0)' 
      });

      for (const frame of task.frames.filter(f => f.selected)) {
        const img = await loadImage(frame.processedBlob || frame.originalBlob);
        gif.addFrame(img, { delay: 1000 / exportSettings.fps, copy: true });
      }

      const gifBlob: Blob = await new Promise(resolve => { 
        gif.on('finished', (blob: Blob) => resolve(blob)); 
        gif.render(); 
      });

      const gifFileName = `${getSafeBaseName(task.name, task.id)}.gif`;
      zip.file(gifFileName, gifBlob);
      setExportProgress(((i + 1) / completedTasks.length) * 100);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `gif_bundle_${Date.now()}.zip`;
    link.click();
    setIsExporting(false);
  };

  const batchExportPngs = async () => {
    const JSZip = (window as any).JSZip;
    if (!JSZip) return alert(t.alertZipError);
    const completedTasks = tasks.filter(t => t.status === 'done');
    if (completedTasks.length === 0) return alert(t.alertSelectFrame);
    setIsExporting(true);
    setExportProgress(0);
    const zip = new JSZip();
    
    for (let i = 0; i < completedTasks.length; i++) {
      const task = completedTasks[i];
      setExportProgress(((i + 0.1) / completedTasks.length) * 100);
      
      const spriteSheetBase64 = await generateSpriteSheet(task.frames, exportSettings);
      const spriteSheetData = spriteSheetBase64.split(',')[1];
      
      const pngFileName = `${getSafeBaseName(task.name, task.id)}.png`;
      zip.file(pngFileName, spriteSheetData, { base64: true });
      setExportProgress(((i + 1) / completedTasks.length) * 100);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `png_bundle_${Date.now()}.zip`;
    link.click();
    setIsExporting(false);
  };

  const getBgClass = () => {
    switch(previewBg) {
      case 'white': return 'bg-white';
      case 'black': return 'bg-black';
      case 'green': return 'bg-green-500';
      case 'blue': return 'bg-blue-600';
      default: return 'checkerboard bg-slate-900';
    }
  };

  const currentPreviewFrame = activeTask?.frames.filter(f => f.selected)[previewFrameIdx];

  const removeTask = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTasks(prev => {
      const filtered = prev.filter(t => t.id !== id);
      if (activeTaskId === id) {
        setActiveTaskId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
  };

  const clearAllTasks = () => {
    if (window.confirm(t.clearTasks + '?')) {
      setTasks([]);
      setActiveTaskId(null);
      setCurrentStep(1);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-blue-100">
      <input type="file" multiple ref={fileInputRef} onChange={handleUpload} className="hidden" accept="video/*" />

      <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-[60] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2.5 rounded-2xl text-white shadow-lg shadow-blue-100">
            <Layers size={22} />
          </div>
          <div>
            <h1 className="font-black text-xl tracking-tighter text-slate-900 leading-none">{t.title}</h1>
            <p className="text-[10px] text-blue-600 uppercase font-black tracking-[0.2em] mt-1">{t.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} className="bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2">
            <Languages size={14} /> {t.langSwitch}
          </button>
          <div className="h-6 w-[1px] bg-slate-200 mx-2" />
          <a href="https://space.bilibili.com/487432166" target="_blank" className="text-slate-400 hover:text-slate-900 transition-colors flex items-center justify-center">
            <img src="https://www.bilibili.com/favicon.ico" width="20" height="20" alt="Bilibili" className="rounded-full" />
          </a>
          <div className="h-6 w-[1px] bg-slate-200 mx-2" />
          <a href="https://github.com/zeemars" target="_blank" className="text-slate-400 hover:text-slate-900 transition-colors"><Github size={20} /></a>
        </div>
      </header>

      <div className="bg-white border-b px-6 py-4 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          {[1, 2, 3].map((s) => (
            <React.Fragment key={s}>
              <div onClick={() => tasks.length > 0 && setCurrentStep(s)} className={`flex items-center gap-3 transition-all cursor-pointer ${currentStep === s ? 'opacity-100 scale-105' : 'opacity-30 hover:opacity-50'}`}>
                <div className={`w-9 h-9 rounded-2xl flex items-center justify-center font-black text-sm transition-all ${currentStep >= s ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-slate-200 text-slate-500'}`}>
                  {s}
                </div>
                <span className={`text-xs font-black uppercase tracking-widest ${currentStep === s ? 'text-slate-900' : 'text-slate-500'}`}>{[t.step1, t.step2, t.step3][s-1]}</span>
              </div>
              {s < 3 && <div className={`flex-1 h-1 mx-6 rounded-full ${currentStep > s ? 'bg-blue-600' : 'bg-slate-200'}`} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-hidden relative">
        {currentStep === 1 && (
          <div className="h-full flex flex-col items-center justify-center p-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div 
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/30', 'shadow-xl', 'shadow-blue-50');
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/30', 'shadow-xl', 'shadow-blue-50');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/30', 'shadow-xl', 'shadow-blue-50');
                const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('video/'));
                if (files.length > 0) {
                  const newTasks: BatchTask[] = files.map((file: File) => ({
                    id: Math.random().toString(36).substr(2, 9),
                    file, 
                    name: file.name, 
                    status: 'pending', 
                    frames: [], 
                    progress: 0,
                    videoUrl: URL.createObjectURL(file),
                    settings: { targetColor: { r: 0, g: 0, b: 0 }, threshold: 30, smoothing: 10, edgeShrink: 0, pixelate: false, pixelSize: 4, canvasWidth: 512, canvasHeight: 512, crop: false, cropMode: 'max', fixedCropWidth: 512, fixedCropHeight: 512, cropMargin: { top: 0, bottom: 0, left: 0, right: 0 }, enabled: true }
                  }));
                  setTasks(prev => [...prev, ...newTasks]);
                  if (!activeTaskId && newTasks.length > 0) setActiveTaskId(newTasks[0].id);
                  setCurrentStep(2);
                }
              }}
              className="group relative w-full max-w-2xl aspect-[16/10] bg-white border-4 border-dashed border-slate-200 rounded-[3rem] flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/20 transition-all hover:shadow-2xl hover:shadow-blue-50"
            >
              <div className="bg-blue-50 text-blue-600 p-8 rounded-[2rem] mb-6 group-hover:scale-110 transition-transform shadow-inner">
                <Upload size={56} className="stroke-[2.5px]" />
              </div>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">{t.uploadTitle}</h2>
              <p className="text-slate-400 font-bold mt-2 text-lg">{t.uploadDesc}</p>
              <p className="text-slate-300 font-bold mt-1 text-sm">或直接拖放视频文件到此处</p>
              <div className="mt-8 flex gap-4">
                 <div className="flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-full text-xs font-black text-slate-500 uppercase tracking-widest">
                   <Check size={14} /> Spine Grid Atlas
                 </div>
                 <div className="flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-full text-xs font-black text-slate-500 uppercase tracking-widest">
                   <Check size={14} /> Single PNG Sheet
                 </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="h-full flex overflow-hidden">
            <aside className="w-80 bg-white border-r flex flex-col flex-shrink-0 animate-in slide-in-from-left-8 duration-500">
              <div className="p-4 border-b flex items-center justify-between bg-slate-50/50">
                 <h3 className="font-black text-xs uppercase tracking-widest text-slate-400">{t.sourceVideo} ({tasks.length})</h3>
                 <div className="flex items-center gap-1">
                   <button onClick={clearAllTasks} title={t.clearTasks} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors">
                     <Trash2 size={16} />
                   </button>
                   <button onClick={() => fileInputRef.current?.click()} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                     <Plus size={18} />
                   </button>
                 </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {tasks.map(task => (
                  <div 
                    key={task.id} 
                    onClick={() => setActiveTaskId(task.id)}
                    className={`group relative p-3 rounded-2xl border transition-all cursor-pointer ${activeTaskId === task.id ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-white border-slate-100 hover:border-slate-300 hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0 border border-black/5">
                        {task.thumbnail ? <img src={task.thumbnail} className="w-full h-full object-cover" /> : <FileVideo size={20} className="mx-auto mt-3 text-slate-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-black truncate leading-tight mb-1">{task.name}</div>
                        <div className="flex items-center gap-2">
                           <div className={`w-2 h-2 rounded-full ${task.status === 'done' ? (activeTaskId === task.id ? 'bg-white' : 'bg-green-500') : (activeTaskId === task.id ? 'bg-white/30' : 'bg-slate-200')}`} />
                           <span className={`text-[9px] font-black uppercase tracking-widest ${activeTaskId === task.id ? 'text-white/80' : 'text-slate-400'}`}>
                             {task.status === 'done' ? t.statusDone : task.status === 'processing' ? t.statusProcessing : t.statusPending}
                           </span>
                        </div>
                      </div>
                    </div>
                    {/* 删除任务按钮 */}
                    <button 
                      onClick={(e) => removeTask(task.id, e)}
                      className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all ${activeTaskId === task.id ? 'text-white/40 hover:text-white hover:bg-white/10' : 'opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 hover:bg-red-50'}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t space-y-3">
                 <button 
                   onClick={processAllTasks} 
                   disabled={globalProcessing || tasks.every(t => t.status === 'done')}
                   className="w-full bg-slate-900 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black disabled:opacity-30 transition-all"
                 >
                   {globalProcessing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                   {t.batchProcess}
                 </button>
              </div>
            </aside>

            <section className="flex-1 flex flex-col bg-slate-50 overflow-hidden relative">
               {/* 浮动预览窗口 */}
               {activeTask && (!previewWindow.isMinimized ? (
                 <div 
                   className="fixed z-50 bg-white rounded-[3rem] shadow-2xl shadow-black/10 border-2 border-slate-100 animate-in slide-in-from-bottom-8 duration-500"
                   style={{
                     left: previewWindow.position.x + 'px',
                     top: previewWindow.position.y + 'px',
                     width: 'auto',
                     minWidth: '320px',
                     maxWidth: '500px'
                   }}
                 >
                   {/* 标题栏 - 可拖动区域 */}
                   <div 
                     className="flex items-center justify-between p-4 border-b border-slate-100 cursor-move"
                     onMouseDown={handleMouseDown}
                     style={{ borderRadius: '2rem 2rem 0 0' }}
                   >
                     <h4 className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-400">{t.previewAnim}</h4>
                     <button
                       onClick={() => setPreviewWindow({ ...previewWindow, isMinimized: true })}
                       className="bg-slate-200 text-slate-600 p-1.5 rounded-full hover:bg-slate-300 transition-colors"
                     >
                       <Minimize2 size={16} />
                     </button>
                   </div>
                   
                   <div className="p-6 space-y-4">
                     {/* 预览区域 */}
                     <div className={`rounded-[2rem] flex items-center justify-center p-6 relative overflow-hidden shadow-inner border border-black/5 ${getBgClass()}`} style={{ minHeight: '200px', minWidth: '200px' }}>
                        {currentPreviewFrame ? (
                          <div className="relative w-full flex items-center justify-center">
                            {/* 上一帧按钮 */}
                            <button onClick={() => { if (previewFrameIdx > 0) setPreviewFrameIdx(previewFrameIdx - 1); }} className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors" style={{ zIndex: 10 }}>
                              <ChevronLeft size={24} />
                            </button>
                            
                            {/* 预览图片 */}
                            <img src={showProcessedInPreview ? (currentPreviewFrame.processedBlob || currentPreviewFrame.originalBlob) : currentPreviewFrame.originalBlob} className="max-w-full max-h-[300px] object-contain drop-shadow-2xl scale-100" />
                            
                            {/* 下一帧按钮 */}
                            <button onClick={() => { const selectedFrames = activeTask?.frames.filter(f => f.selected) || []; if (previewFrameIdx < selectedFrames.length - 1) setPreviewFrameIdx(previewFrameIdx + 1); }} className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors" style={{ zIndex: 10 }}>
                              <ChevronRight size={24} />
                            </button>
                          </div>
                        ) : (
                          <div className="text-white/10 flex flex-col items-center gap-2">
                            <Monitor size={48} />
                            <span className="text-[10px] font-black uppercase tracking-widest">{t.statusPending}</span>
                          </div>
                        )}
                     </div>
                     
                     {/* 帧选择横向滚动条 */}
                     <div className="flex items-center gap-2">
                       {/* 上一帧按钮 */}
                       <button onClick={() => { if (previewFrameIdx > 0) setPreviewFrameIdx(previewFrameIdx - 1); }} className="bg-slate-800 text-white p-2 rounded-full hover:bg-slate-700 transition-colors flex-shrink-0" disabled={previewFrameIdx === 0}>
                         <ChevronLeft size={16} />
                       </button>
                       
                       {/* 帧预览滚动条 */}
                       <div className="flex-1 overflow-x-auto pb-2">
                         <div className="flex gap-3 min-w-max">
                           {activeTask?.frames.filter(f => f.selected).map((frame, idx) => (
                             <div key={frame.id} onClick={() => setPreviewFrameIdx(idx)} className={`w-12 h-12 rounded-lg border-2 transition-all cursor-pointer ${previewFrameIdx === idx ? 'border-blue-600 shadow-lg' : 'border-slate-100'}`}>
                               <img src={frame.processedBlob || frame.originalBlob} className="w-full h-full object-cover rounded-md" />
                             </div>
                           ))}
                         </div>
                       </div>
                       
                       {/* 下一帧按钮 */}
                       <button onClick={() => { const selectedFrames = activeTask?.frames.filter(f => f.selected) || []; if (previewFrameIdx < selectedFrames.length - 1) setPreviewFrameIdx(previewFrameIdx + 1); }} className="bg-slate-800 text-white p-2 rounded-full hover:bg-slate-700 transition-colors flex-shrink-0" disabled={activeTask?.frames.filter(f => f.selected).length === 0 || previewFrameIdx >= (activeTask?.frames.filter(f => f.selected).length || 0) - 1}>
                         <ChevronRight size={16} />
                       </button>
                     </div>
                     
                     {/* 背景颜色选择 */}
                     <div className="flex gap-2">
                       {(['checker', 'white', 'black', 'green', 'blue'] as const).map(bg => (
                         <button key={bg} onClick={() => setPreviewBg(bg)} className={`flex-1 h-8 rounded-lg border-2 transition-all ${previewBg === bg ? 'border-blue-600' : 'border-slate-100'} ${bg === 'checker' ? 'bg-white' : bg === 'white' ? 'bg-white' : bg === 'black' ? 'bg-black' : bg === 'green' ? 'bg-green-500' : bg === 'blue' ? 'bg-blue-600' : ''}`} />
                       ))}
                     </div>
                     
                     {/* 视频播放器样式的控制按钮 */}
                     <div className="flex gap-2">
                       <button onClick={() => { setPreviewPaused(true); setPreviewFrameIdx(0); }} className="flex-1 py-2 px-4 rounded-xl bg-slate-800 text-white text-[10px] font-black hover:bg-slate-700 transition-colors flex items-center justify-center gap-2">
                         <Rewind size={16} />
                         {t.stopPreview}
                       </button>
                       <button onClick={() => setPreviewPaused(!previewPaused)} className="flex-1 py-2 px-4 rounded-xl bg-blue-600 text-white text-[10px] font-black hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                         {previewPaused ? (
                           <>
                             <Play size={16} />
                             {t.startPreview}
                           </>
                         ) : (
                           <>
                             <Pause size={16} />
                            {t.pausePreview}
                           </>
                         )}
                       </button>
                     </div>
                   </div>
                 </div>
               ) : (
                 /* 最小化状态 */
                 activeTask && (
                   <div 
                     className="fixed z-50 bg-white rounded-[2rem] shadow-xl shadow-black/10 border-2 border-slate-100 animate-in slide-in-from-bottom-8 duration-500"
                     style={{
                       left: previewWindow.position.x + 'px',
                       top: previewWindow.position.y + 'px',
                       width: '200px'
                     }}
                   >
                     <div className="flex items-center justify-between p-4 cursor-move" onMouseDown={handleMouseDown}>
                       <h4 className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-400">{t.previewAnim}</h4>
                       <button onClick={() => setPreviewWindow({ ...previewWindow, isMinimized: false })} className="bg-slate-200 text-slate-600 p-1.5 rounded-full hover:bg-slate-300 transition-colors">
                         <Maximize2 size={16} />
                       </button>
                     </div>
                   </div>
                 )
               ))}
               
               {activeTask ? (
                 <div className="flex-1 flex overflow-hidden">
                    <div className="flex-1 flex flex-col overflow-hidden">
                       <div className="p-4 bg-white border-b flex justify-between items-center px-8">
                          <div className="flex items-center gap-4">
                             <h2 className="font-black text-slate-900 flex items-center gap-2">
                               <ImageIcon size={18} className="text-blue-600" /> {t.sequenceFrames} 
                               <span className="bg-slate-100 text-slate-500 text-[10px] px-2 py-0.5 rounded-full">{activeTask.frames.length}</span>
                             </h2>
                             <div className="h-4 w-[1px] bg-slate-200" />
                             <button onClick={() => {
                               const allSelected = activeTask.frames.every(f => f.selected);
                               const updated = { 
                                 ...activeTask, 
                                 frames: activeTask.frames.map(f => ({ 
                                   ...f, 
                                   selected: !allSelected 
                                 })) 
                               };
                               updateTask(updated);
                             }} className="text-[10px] font-black text-slate-400 hover:text-blue-600 transition-colors">
                               {activeTask.frames.every(f => f.selected) ? t.none : t.all}
                             </button>
                          </div>
                          <div className="flex items-center gap-3">
                            {activeTask.status === 'done' ? (
                               <button 
                                 onClick={() => processSingleTask(activeTask.id, false)}
                                 className="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-1.5 rounded-full text-[10px] font-black uppercase hover:bg-blue-100 transition-all"
                               >
                                 <RefreshCcw size={12} /> {t.reProcess}
                               </button>
                            ) : (
                               <button 
                                 onClick={() => processSingleTask(activeTask.id, true)}
                                 className="flex items-center gap-2 bg-blue-600 text-white px-5 py-1.5 rounded-full text-[10px] font-black uppercase hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                               >
                                 <Play size={12} /> {t.applyChroma}
                               </button>
                            )}
                          </div>
                       </div>

                       <div className="flex-1 overflow-y-auto p-8">
                          {activeTask.frames.length > 0 ? (
                             <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                                {activeTask.frames.map(frame => (
                                  <div 
                                    key={frame.id}
                                    onClick={() => {
                                      const updatedFrames = activeTask.frames.map(f => f.id === frame.id ? { ...f, selected: !f.selected } : f);
                                      updateTask({ ...activeTask, frames: updatedFrames });
                                    }}
                                    className={`group relative bg-white border-2 rounded-[2rem] p-2 transition-all cursor-pointer ${frame.selected ? 'border-blue-600 shadow-xl shadow-blue-50 ring-1 ring-blue-600' : 'border-slate-100 hover:border-slate-300'}`}
                                  >
                                    <div className={`aspect-square rounded-[1.5rem] flex items-center justify-center overflow-hidden relative ${frame.processedBlob ? 'checkerboard bg-slate-900' : 'bg-slate-50'}`}>
                                       <img src={frame.processedBlob || frame.originalBlob} className="max-w-full max-h-full object-contain p-2" />
                                       <div className={`absolute top-3 left-3 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${frame.selected ? 'bg-blue-600 border-blue-600' : 'bg-white/80 border-slate-200'}`}>
                                          {frame.selected && <Check size={14} className="text-white stroke-[3px]" />}
                                       </div>
                                    </div>
                                    <div className="text-center py-2 text-[10px] font-black text-slate-300 font-mono">#{frame.id + 1}</div>
                                  </div>
                                ))}
                             </div>
                          ) : (
                             <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-4">
                               <div className="bg-white p-8 rounded-[3rem] border-2 border-dashed border-slate-200">
                                  <Eraser size={64} className="opacity-10" />
                               </div>
                               <p className="font-black text-xs uppercase tracking-widest">{t.clickToApply}</p>
                             </div>
                          )}
                       </div>
                    </div>
                    
                    {/* 右侧边栏 - 只保留抠图参数设置 */}
                    <div className="w-80 bg-white border-l flex flex-col overflow-y-auto p-6 space-y-8 animate-in slide-in-from-right-8 duration-500">
                       <div className="space-y-6">
                          <h4 className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-400">{t.chromaKey}</h4>
                          <div className="space-y-4">
                             <div>
                               <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">{t.bgColor}</label>
                               <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100 group">
                                  <div className="relative w-10 h-10 rounded-xl border-2 border-white shadow-md overflow-hidden shrink-0">
                                     <input 
                                       type="color" 
                                       value={`#${activeTask.settings.targetColor.r.toString(16).padStart(2,'0')}${activeTask.settings.targetColor.g.toString(16).padStart(2,'0')}${activeTask.settings.targetColor.b.toString(16).padStart(2,'0')}`}
                                       onChange={(e) => {
                                          const hex = e.target.value.replace('#', '');
                                          handleManualSettingsChange({ targetColor: { r: parseInt(hex.substr(0,2), 16), g: parseInt(hex.substr(2,4), 16), b: parseInt(hex.substr(4,6), 16) } });
                                       }}
                                       className="absolute inset-0 opacity-0 cursor-pointer w-full h-full scale-150"
                                     />
                                     <div className="w-full h-full" style={{ backgroundColor: `rgb(${activeTask.settings.targetColor.r},${activeTask.settings.targetColor.g},${activeTask.settings.targetColor.b})` }} />
                                  </div>
                                  <div className="flex-1">
                                     <div className="text-[10px] font-black text-slate-800 font-mono uppercase">#{activeTask.settings.targetColor.r.toString(16).padStart(2,'0')}${activeTask.settings.targetColor.g.toString(16).padStart(2,'0')}${activeTask.settings.targetColor.b.toString(16).padStart(2,'0')}</div>
                                     <button 
                                       onClick={async () => {
                                          if(activeTask.thumbnail) {
                                            const c = await getTopLeftColor(activeTask.thumbnail);
                                            handleManualSettingsChange({ targetColor: c });
                                          }
                                       }} 
                                       className="text-[9px] font-black text-blue-600 uppercase hover:underline"
                                      >
                                        {t.autoPickColor}
                                      </button>
                                  </div>
                               </div>
                             </div>

                             <div>
                               <div className="flex justify-between items-center mb-2">
                                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.threshold}</label>
                                  <span className="text-[10px] font-black font-mono text-blue-600">{activeTask.settings.threshold}</span>
                               </div>
                               <input 
                                 type="range" min="0" max="200" step="1" 
                                 value={activeTask.settings.threshold} 
                                 onChange={(e) => handleManualSettingsChange({ threshold: +e.target.value })}
                                 className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                               />
                             </div>

                             <div>
                               <div className="flex justify-between items-center mb-2">
                                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.edgeShrink}</label>
                                  <span className="text-[10px] font-black font-mono text-blue-600">{activeTask.settings.edgeShrink}</span>
                               </div>
                               <input 
                                 type="range" min="0" max="10" step="1" 
                                 value={activeTask.settings.edgeShrink} 
                                 onChange={(e) => handleManualSettingsChange({ edgeShrink: +e.target.value })}
                                 className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                               />
                             </div>

                             <div className="pt-4 border-t border-slate-100">
                               <div className="flex justify-between items-center mb-4">
                                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.pixelate}</label>
                                  <button 
                                    onClick={() => handleManualSettingsChange({ pixelate: !activeTask.settings.pixelate })}
                                    className={`w-10 h-5 rounded-full relative transition-all ${activeTask.settings.pixelate ? 'bg-blue-600' : 'bg-slate-200'}`}
                                  >
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${activeTask.settings.pixelate ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                  </button>
                               </div>
                                
                               {activeTask.settings.pixelate && (
                                 <div className="space-y-6">
                                   {/* Canvas Size Selection */}
                                   <div>
                                     <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-3">{t.canvasSize}</label>
                                     <div className="grid grid-cols-3 gap-2">
                                       {[16, 32, 64, 128, 512].map(size => (
                                         <button
                                           key={size}
                                           onClick={() => handleManualSettingsChange({ canvasWidth: size, canvasHeight: size })}
                                           className={`py-2 px-3 rounded-xl text-[10px] font-black transition-all ${activeTask.settings.canvasWidth === size && activeTask.settings.canvasHeight === size ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                                         >
                                           {size}x{size}
                                         </button>
                                       ))}
                                     </div>
                                   </div>
                                   
                                   {/* Pixel Size */}
                                   <div>
                                     <div className="flex justify-between items-center mb-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.pixelSize}</label>
                                        <span className="text-[10px] font-black font-mono text-blue-600">{activeTask.settings.pixelSize}</span>
                                     </div>
                                     <input 
                                       type="range" min="1" max="10" step="1" 
                                       value={activeTask.settings.pixelSize} 
                                       onChange={(e) => handleManualSettingsChange({ pixelSize: +e.target.value })}
                                       className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                     />
                                   </div>
                                 </div>
                               )}
                             </div>
                              
                             {/* 应用设置按钮 */}
                             <div className="pt-6 border-t border-slate-100">
                               <button
                                 onClick={handleApplySettings}
                                 className="w-full py-3 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                               >
                                 <RefreshCcw size={14} />
                                 应用设置
                               </button>
                             </div>
                              
                             {/* 空白裁剪设置 */}
                             <div className="pt-4 border-t border-slate-100">
                               <div className="flex justify-between items-center mb-4">
                                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.crop}</label>
                                  <button 
                                    onClick={() => handleManualSettingsChange({ crop: !activeTask.settings.crop })}
                                    className={`w-10 h-5 rounded-full relative transition-all ${activeTask.settings.crop ? 'bg-blue-600' : 'bg-slate-200'}`}
                                  >
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${activeTask.settings.crop ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                  </button>
                               </div>
                               
                               {activeTask.settings.crop && (
                                 <div className="space-y-6">
                                   <p className="text-[9px] text-slate-400">{t.cropDesc}</p>
                                   
                                   {/* 裁剪模式 */}
                                   <div>
                                     <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-3">{t.cropMode}</label>
                                     <div className="flex gap-2">
                                       <button
                                         onClick={() => handleManualSettingsChange({ cropMode: 'max' })}
                                         className={`flex-1 py-2 px-3 rounded-xl text-[10px] font-black transition-all ${activeTask.settings.cropMode === 'max' ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                                       >
                                         {t.maxSize}
                                       </button>
                                       <button
                                         onClick={() => handleManualSettingsChange({ cropMode: 'fixed' })}
                                         className={`flex-1 py-2 px-3 rounded-xl text-[10px] font-black transition-all ${activeTask.settings.cropMode === 'fixed' ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                                       >
                                         {t.fixedSize}
                                       </button>
                                     </div>
                                   </div>
                                   
                                   {/* 固定尺寸设置 */}
                                   {activeTask.settings.cropMode === 'fixed' && (
                                     <div className="space-y-4">
                                       <div className="grid grid-cols-2 gap-3">
                                         <div>
                                           <label className="text-sm">宽:</label>
                                           <input
                                             type="number"
                                             value={activeTask.settings.fixedCropWidth}
                                             onChange={(e) => handleManualSettingsChange({ fixedCropWidth: parseInt(e.target.value) || 0 })}
                                             className="w-full p-2 rounded-xl border border-slate-200 text-sm"
                                           />
                                         </div>
                                         <div>
                                           <label className="text-sm">高:</label>
                                           <input
                                             type="number"
                                             value={activeTask.settings.fixedCropHeight}
                                             onChange={(e) => handleManualSettingsChange({ fixedCropHeight: parseInt(e.target.value) || 0 })}
                                             className="w-full p-2 rounded-xl border border-slate-200 text-sm"
                                           />
                                         </div>
                                       </div>
                                     </div>
                                   )}
                                   
                                   {/* 裁剪边距 */}
                                   <div>
                                     <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-3">{t.cropMargin}</label>
                                     <div className="grid grid-cols-2 gap-3">
                                       <div>
                                         <label className="text-xs text-slate-400 block mb-1">上</label>
                                         <input
                                           type="number"
                                           value={activeTask.settings.cropMargin.top}
                                           onChange={(e) => handleManualSettingsChange({ cropMargin: { ...activeTask.settings.cropMargin, top: parseInt(e.target.value) || 0 } })}
                                           className="w-full p-2 rounded-xl border border-slate-200 text-sm"
                                         />
                                       </div>
                                       <div>
                                         <label className="text-xs text-slate-400 block mb-1">下</label>
                                         <input
                                           type="number"
                                           value={activeTask.settings.cropMargin.bottom}
                                           onChange={(e) => handleManualSettingsChange({ cropMargin: { ...activeTask.settings.cropMargin, bottom: parseInt(e.target.value) || 0 } })}
                                           className="w-full p-2 rounded-xl border border-slate-200 text-sm"
                                         />
                                       </div>
                                       <div>
                                         <label className="text-xs text-slate-400 block mb-1">左</label>
                                         <input
                                           type="number"
                                           value={activeTask.settings.cropMargin.left}
                                           onChange={(e) => handleManualSettingsChange({ cropMargin: { ...activeTask.settings.cropMargin, left: parseInt(e.target.value) || 0 } })}
                                           className="w-full p-2 rounded-xl border border-slate-200 text-sm"
                                         />
                                       </div>
                                       <div>
                                         <label className="text-xs text-slate-400 block mb-1">右</label>
                                         <input
                                           type="number"
                                           value={activeTask.settings.cropMargin.right}
                                           onChange={(e) => handleManualSettingsChange({ cropMargin: { ...activeTask.settings.cropMargin, right: parseInt(e.target.value) || 0 } })}
                                           className="w-full p-2 rounded-xl border border-slate-200 text-sm"
                                         />
                                       </div>
                                     </div>
                                   </div>
                                   
                                   {/* 开始裁剪按钮 */}
                                   <button
                                     onClick={handleCrop}
                                     className="w-full py-3 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                                   >
                                     <Scissors size={14} />
                                     {t.startCrop}
                                   </button>
                                 </div>
                               )}
                             </div>
                          </div>
                       </div>
                    </div>
                 </div>
               ) : (
                 <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-4">
                   <div className="bg-white p-8 rounded-[3rem] border-2 border-dashed border-slate-200">
                      <FileVideo size={64} className="opacity-10" />
                   </div>
                   <p className="font-black text-xs uppercase tracking-widest">{t.selectTaskPrompt}</p>
                 </div>
               )}
            </section>
          </div>
        )}

        {currentStep === 3 && (
          <div className="h-full flex flex-col p-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="max-w-4xl mx-auto w-full">
              <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-8">{t.exportSettings}</h2>
              
              <div className="bg-white rounded-[3rem] shadow-lg p-8 space-y-8">
                {/* 导出设置选项卡 */}
                <div className="space-y-6">
                  {/* 基本设置 - 移除宽度和高度 */}
                  <div>
                    <h3 className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-4">{t.basicSettings}</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">{t.fps}</label>
                        <input
                          type="number"
                          value={exportSettings.fps}
                          onChange={(e) => setExportSettings({ ...exportSettings, fps: parseInt(e.target.value) || 0 })}
                          className="w-full p-3 rounded-xl border border-slate-200 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">{t.prefix}</label>
                        <input
                          type="text"
                          value={exportSettings.prefix}
                          onChange={(e) => setExportSettings({ ...exportSettings, prefix: e.target.value })}
                          className="w-full p-3 rounded-xl border border-slate-200 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* 精灵图设置 */}
                  <div>
                    <h3 className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-4">{t.spriteSheet}</h3>
                    
                    {/* 布局 */}
                    <div className="mb-6">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-3">{t.layout}</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setExportSettings({ ...exportSettings, layout: 'grid' })}
                          className={`flex-1 py-2 px-3 rounded-xl text-[10px] font-black transition-all ${exportSettings.layout === 'grid' ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                        >
                          {t.gridLayout}
                        </button>
                        <button
                          onClick={() => setExportSettings({ ...exportSettings, layout: 'horizontal' })}
                          className={`flex-1 py-2 px-3 rounded-xl text-[10px] font-black transition-all ${exportSettings.layout === 'horizontal' ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                        >
                          {t.horizontalLayout}
                        </button>
                        <button
                          onClick={() => setExportSettings({ ...exportSettings, layout: 'vertical' })}
                          className={`flex-1 py-2 px-3 rounded-xl text-[10px] font-black transition-all ${exportSettings.layout === 'vertical' ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                        >
                          {t.verticalLayout}
                        </button>
                      </div>
                    </div>
                    
                    {/* 列数 */}
                    {exportSettings.layout === 'grid' && (
                      <div className="mb-6">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">{t.columns}</label>
                        <input
                          type="number"
                          value={exportSettings.columns}
                          onChange={(e) => setExportSettings({ ...exportSettings, columns: parseInt(e.target.value) || 1 })}
                          className="w-full p-3 rounded-xl border border-slate-200 text-sm"
                          min="1"
                        />
                      </div>
                    )}
                    
                    {/* 帧尺寸 */}
                    <div className="mb-6">
                      <h4 className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-3">{t.frameSize}</h4>
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t.useCurrentSize}</label>
                        <button
                          onClick={() => setExportSettings({ ...exportSettings, useCurrentSize: !exportSettings.useCurrentSize })}
                          className={`w-10 h-5 rounded-full relative transition-all ${exportSettings.useCurrentSize ? 'bg-blue-600' : 'bg-slate-200'}`}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${exportSettings.useCurrentSize ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                      
                      {!exportSettings.useCurrentSize && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-sm">宽:</label>
                            <input
                              type="number"
                              value={exportSettings.frameWidth}
                              onChange={(e) => setExportSettings({ ...exportSettings, frameWidth: parseInt(e.target.value) || 0 })}
                              className="w-full p-3 rounded-xl border border-slate-200 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-sm">高:</label>
                            <input
                              type="number"
                              value={exportSettings.frameHeight}
                              onChange={(e) => setExportSettings({ ...exportSettings, frameHeight: parseInt(e.target.value) || 0 })}
                              className="w-full p-3 rounded-xl border border-slate-200 text-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* 缩放算法 */}
                    <div className="mb-6">
                      <h4 className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-3">{t.scalingAlgorithm}</h4>
                      <div className="grid grid-cols-2 gap-2">
                        {['Lanczos', 'Bicubic', 'Bilinear', 'Nearest Neighbor'].map(algorithm => (
                          <button
                            key={algorithm}
                            onClick={() => setExportSettings({ ...exportSettings, scalingAlgorithm: algorithm })}
                            className={`py-2 px-3 rounded-xl text-[10px] font-black transition-all ${exportSettings.scalingAlgorithm === algorithm ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                          >
                            {algorithm}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    {/* 间距 */}
                    <div className="mb-6">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">{t.spacing}</label>
                      <input
                        type="number"
                        value={exportSettings.spacing}
                        onChange={(e) => setExportSettings({ ...exportSettings, spacing: parseInt(e.target.value) || 0 })}
                        className="w-full p-3 rounded-xl border border-slate-200 text-sm"
                        min="0"
                      />
                    </div>
                  </div>
                </div>
                
                {/* 导出按钮 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={batchExportSpine}
                    disabled={isExporting}
                    className="py-4 px-6 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-30 flex flex-col items-center justify-center gap-3"
                  >
                    {isExporting ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={20} />
                    )}
                    {t.exportPackage}
                  </button>
                  <button
                    onClick={batchExportPngs}
                    disabled={isExporting}
                    className="py-4 px-6 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-30 flex flex-col items-center justify-center gap-3"
                  >
                    {isExporting ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <ImageIcon size={20} />
                    )}
                    导出PNG精灵图
                  </button>
                  <button
                    onClick={batchExportGifs}
                    disabled={isExporting}
                    className="py-4 px-6 rounded-xl bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 transition-all disabled:opacity-30 flex flex-col items-center justify-center gap-3"
                  >
                    {isExporting ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <FileVideo size={20} />
                    )}
                    {t.exportGif}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      
      {/* 全局处理状态 */}
      {globalProcessing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]">
          <div className="bg-white rounded-[3rem] p-8 max-w-md w-full text-center">
            <div className="bg-blue-50 p-6 rounded-[2rem] mb-6 inline-block">
              <Loader2 size={48} className="animate-spin text-blue-600" />
            </div>
            <h3 className="font-black text-xl text-slate-900 mb-2">{t.processing}</h3>
            <p className="text-slate-400 font-bold">{t.procDesc}</p>
            <div className="mt-6 bg-slate-100 rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 h-full transition-all" style={{ width: `${overallProgress}%` }} />
            </div>
            <p className="text-[10px] text-slate-400 uppercase font-black mt-3">{Math.round(overallProgress)}%</p>
          </div>
        </div>
      )}
      
      {/* 导出状态 */}
      {isExporting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]">
          <div className="bg-white rounded-[3rem] p-8 max-w-md w-full text-center">
            <div className="bg-blue-50 p-6 rounded-[2rem] mb-6 inline-block">
              <Loader2 size={48} className="animate-spin text-blue-600" />
            </div>
            <h3 className="font-black text-xl text-slate-900 mb-2">{t.gifProcessing}</h3>
            <p className="text-slate-400 font-bold">{t.gifProcDesc}</p>
            <div className="mt-6 bg-slate-100 rounded-full h-2 overflow-hidden">
              <div className="bg-blue-600 h-full transition-all" style={{ width: `${exportProgress}%` }} />
            </div>
            <p className="text-[10px] text-slate-400 uppercase font-black mt-3">{Math.round(exportProgress)}%</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
