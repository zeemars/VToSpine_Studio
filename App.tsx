
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Settings, Trash2, Play, Download, CheckCircle2, Eraser, Monitor,
  Image as ImageIcon, Loader2, Languages, ChevronRight, ChevronLeft, Eye, 
  Palette, Github, Check, FileVideo, AlertTriangle, Plus, RefreshCcw, X, Edit3, Layers
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

  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    width: 720, height: 1280, fps: 15, prefix: 'anim'
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

  useEffect(() => {
    if (activeTask && activeTask.frames.length > 0) {
      const selectedFrames = activeTask.frames.filter(f => f.selected);
      if (selectedFrames.length === 0) return;
      const interval = setInterval(() => {
        setPreviewFrameIdx(prev => (prev + 1) % selectedFrames.length);
      }, 1000 / exportSettings.fps);
      return () => clearInterval(interval);
    }
  }, [activeTaskId, activeTask?.frames, exportSettings.fps]);

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
        settings: { targetColor: { r: 0, g: 0, b: 0 }, threshold: 30, smoothing: 10, enabled: true }
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

  const handleManualSettingsChange = async (newSettings: Partial<ChromaSettings>) => {
    if (!activeTask) return;
    const task = { ...activeTask, settings: { ...activeTask.settings, ...newSettings } };
    updateTask(task);
    
    if (task.frames.length > 0) {
      const newFrames = [...task.frames];
      for (let i = 0; i < newFrames.length; i++) {
        newFrames[i].processedBlob = await applyChromaKey(newFrames[i].originalBlob, task.settings);
      }
      task.frames = newFrames;
      updateTask(task);
    }
  };

  const getSafeBaseName = (filename: string, id: string) => {
    const parts = filename.split('.');
    if (parts.length > 1) parts.pop();
    const base = parts.join('.') || 'animation';
    return `${base}_${id.slice(-4)}`;
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
        width: exportSettings.width, 
        height: exportSettings.height, 
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
          <a href="https://github.com/zee-mars" target="_blank" className="text-slate-400 hover:text-slate-900 transition-colors"><Github size={20} /></a>
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
              className="group relative w-full max-w-2xl aspect-[16/10] bg-white border-4 border-dashed border-slate-200 rounded-[3rem] flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/20 transition-all hover:shadow-2xl hover:shadow-blue-50"
            >
              <div className="bg-blue-50 text-blue-600 p-8 rounded-[2rem] mb-6 group-hover:scale-110 transition-transform shadow-inner">
                <Upload size={56} className="stroke-[2.5px]" />
              </div>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">{t.uploadTitle}</h2>
              <p className="text-slate-400 font-bold mt-2 text-lg">{t.uploadDesc}</p>
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

            <section className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
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
                               const updated = { ...activeTask, frames: activeTask.frames.map(f => ({ ...f, selected: true })) };
                               updateTask(updated);
                             }} className="text-[10px] font-black text-slate-400 hover:text-blue-600 transition-colors">{t.all}</button>
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

                    <div className="w-80 bg-white border-l flex flex-col overflow-y-auto p-6 space-y-8 animate-in slide-in-from-right-8 duration-500">
                       <div className="space-y-4">
                          <h4 className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-400">{t.previewAnim}</h4>
                          <div className={`aspect-[9/16] rounded-[2.5rem] flex items-center justify-center p-8 relative overflow-hidden shadow-inner border border-black/5 ${getBgClass()}`}>
                             {currentPreviewFrame ? (
                               <img 
                                 src={showProcessedInPreview ? (currentPreviewFrame.processedBlob || currentPreviewFrame.originalBlob) : currentPreviewFrame.originalBlob} 
                                 className="max-w-full max-h-full object-contain drop-shadow-2xl scale-110" 
                               />
                             ) : (
                               <div className="text-white/10 flex flex-col items-center gap-2">
                                 <Monitor size={48} />
                                 <span className="text-[10px] font-black uppercase tracking-widest">{t.statusPending}</span>
                               </div>
                             )}
                          </div>
                          <div className="flex gap-2">
                             {(['checker', 'white', 'black', 'green', 'blue'] as const).map(bg => (
                               <button 
                                 key={bg} 
                                 onClick={() => setPreviewBg(bg)}
                                 className={`flex-1 h-8 rounded-lg border-2 transition-all ${previewBg === bg ? 'border-blue-600' : 'border-slate-100'} ${
                                   bg === 'checker' ? 'checkerboard-sm bg-white' : 
                                   bg === 'white' ? 'bg-white' : 
                                   bg === 'black' ? 'bg-black' : 
                                   bg === 'green' ? 'bg-green-500' : 
                                   bg === 'blue' ? 'bg-blue-600' : ''
                                 }`}
                               />
                             ))}
                          </div>
                       </div>

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
                                     <div className="text-[10px] font-black text-slate-800 font-mono uppercase">#{activeTask.settings.targetColor.r.toString(16).padStart(2,'0')}{activeTask.settings.targetColor.g.toString(16).padStart(2,'0')}{activeTask.settings.targetColor.b.toString(16).padStart(2,'0')}</div>
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
                          </div>
                       </div>

                       <div className="pt-4 border-t border-slate-100">
                          <button 
                            onClick={() => setCurrentStep(3)}
                            className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black transition-all shadow-xl shadow-slate-100"
                          >
                             {t.next} <ChevronRight size={16} />
                          </button>
                       </div>
                    </div>
                 </div>
               ) : (
                 <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-6">
                    <div className="p-12 bg-white rounded-[4rem] border-2 border-dashed border-slate-200">
                       <Edit3 size={80} className="opacity-10 stroke-[1.5px]" />
                    </div>
                    <p className="font-black text-sm uppercase tracking-[0.2em]">{t.selectTaskPrompt}</p>
                 </div>
               )}
            </section>
          </div>
        )}

        {currentStep === 3 && (
          <div className="h-full flex items-center justify-center p-8 overflow-y-auto animate-in zoom-in-95 duration-500">
             <div className="bg-white border rounded-[3rem] p-12 max-w-4xl w-full shadow-2xl space-y-12">
                <div className="text-center space-y-4">
                   <div className="bg-green-100 text-green-600 w-20 h-20 rounded-[2rem] flex items-center justify-center mx-auto shadow-lg shadow-green-50">
                     <CheckCircle2 size={40} />
                   </div>
                   <div>
                      <h2 className="text-4xl font-black text-slate-900 tracking-tight">Export Workspace</h2>
                      <p className="text-slate-400 font-bold mt-2">Ready to pack {tasks.filter(t => t.status === 'done').length} successful animations.</p>
                      <p className="text-[10px] text-blue-600 font-black uppercase mt-2 tracking-widest bg-blue-50 py-1 px-4 rounded-full inline-block">Combined Grid Atlas Mode</p>
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                   <div className="bg-slate-50 rounded-[2.5rem] p-8 space-y-6">
                      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
                         <Settings size={20} className="text-slate-400" />
                         <h3 className="font-black text-xs uppercase tracking-widest text-slate-900">{t.exportSettings}</h3>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Width</label>
                            <input type="number" value={exportSettings.width} onChange={e => setExportSettings({...exportSettings, width: +e.target.value})} className="w-full bg-white border border-slate-100 rounded-xl px-4 py-2 font-mono text-sm focus:border-blue-400 outline-none" />
                         </div>
                         <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Height</label>
                            <input type="number" value={exportSettings.height} onChange={e => setExportSettings({...exportSettings, height: +e.target.value})} className="w-full bg-white border border-slate-100 rounded-xl px-4 py-2 font-mono text-sm focus:border-blue-400 outline-none" />
                         </div>
                         <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">FPS</label>
                            <input type="number" value={exportSettings.fps} onChange={e => setExportSettings({...exportSettings, fps: +e.target.value})} className="w-full bg-white border border-slate-100 rounded-xl px-4 py-2 font-mono text-sm focus:border-blue-400 outline-none" />
                         </div>
                         <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Prefix</label>
                            <input type="text" value={exportSettings.prefix} onChange={e => setExportSettings({...exportSettings, prefix: e.target.value})} className="w-full bg-white border border-slate-100 rounded-xl px-4 py-2 font-mono text-sm focus:border-blue-400 outline-none" />
                         </div>
                      </div>
                   </div>

                   <div className="flex flex-col gap-5">
                      <button 
                        onClick={batchExportSpine}
                        className="flex-1 bg-slate-900 text-white rounded-[2rem] p-8 font-black flex flex-col items-center justify-center gap-3 hover:bg-black transition-all hover:shadow-2xl hover:shadow-slate-200 group active:scale-[0.98]"
                      >
                         <div className="bg-white/10 p-4 rounded-2xl group-hover:scale-110 transition-transform"><Download size={32} /></div>
                         <span className="text-sm uppercase tracking-widest">{t.exportPackage}</span>
                         <span className="text-[9px] opacity-40">(Combined Grid PNG)</span>
                      </button>
                      
                      <button 
                        onClick={batchExportGifs}
                        disabled={!isLibLoaded}
                        className="flex-1 bg-blue-600 text-white rounded-[2rem] p-8 font-black flex flex-col items-center justify-center gap-3 hover:bg-blue-700 transition-all hover:shadow-2xl hover:shadow-blue-100 group disabled:opacity-30 active:scale-[0.98]"
                      >
                         <div className="bg-white/10 p-4 rounded-2xl group-hover:scale-110 transition-transform"><FileVideo size={32} /></div>
                         <span className="text-sm uppercase tracking-widest">{t.exportGif}</span>
                         <span className="text-[9px] opacity-40">(Transparent GIF ZIP)</span>
                      </button>
                   </div>
                </div>
             </div>
          </div>
        )}
      </main>

      <footer className="bg-white border-t px-8 py-3 flex items-center justify-between z-50">
        <button 
          disabled={currentStep === 1} 
          onClick={() => setCurrentStep(prev => prev - 1)}
          className="flex items-center gap-2 font-black text-[10px] uppercase tracking-widest text-slate-400 hover:text-slate-900 disabled:opacity-10 transition-colors"
        >
          <ChevronLeft size={16} /> {t.back}
        </button>

        <button 
          disabled={currentStep === 3 || tasks.length === 0} 
          onClick={() => setCurrentStep(prev => prev + 1)}
          className="flex items-center gap-2 bg-slate-900 text-white px-8 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] hover:bg-black transition-all active:scale-95 disabled:opacity-20 shadow-lg shadow-slate-100"
        >
          {t.next} <ChevronRight size={16} />
        </button>
      </footer>

      {isExporting && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-2xl z-[200] flex items-center justify-center p-12">
          <div className="bg-white shadow-2xl rounded-[4rem] p-16 max-w-md w-full border text-center space-y-8 animate-in zoom-in-95 duration-300">
            <Loader2 size={64} className="text-blue-600 animate-spin mx-auto mb-4" />
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Generating Assets...</h3>
            <p className="text-slate-400 font-bold">Please wait while we process the files.</p>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
               <div className="bg-blue-600 h-full transition-all" style={{ width: `${exportProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      <style>{`
        .checkerboard {
          background-image: linear-gradient(45deg, #111 25%, transparent 25%), 
                            linear-gradient(-45deg, #111 25%, transparent 25%), 
                            linear-gradient(45deg, transparent 75%, #111 75%), 
                            linear-gradient(-45deg, transparent 75%, #111 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
        }
        .checkerboard-sm {
          background-image: linear-gradient(45deg, #eee 25%, transparent 25%), 
                            linear-gradient(-45deg, #eee 25%, transparent 25%), 
                            linear-gradient(45deg, transparent 75%, #eee 75%), 
                            linear-gradient(-45deg, transparent 75%, #eee 75%);
          background-size: 8px 8px;
          background-position: 0 0, 0 4px, 4px -4px, -4px 0px;
        }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slide-in-from-bottom-8 { from { transform: translateY(2rem); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes slide-in-from-left-8 { from { transform: translateX(-2rem); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes slide-in-from-right-8 { from { transform: translateX(2rem); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes zoom-in-95 { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-in { animation-duration: 400ms; animation-fill-mode: both; }
        .fade-in { animation-name: fade-in; }
        .slide-in-from-bottom-8 { animation-name: slide-in-from-bottom-8; }
        .slide-in-from-left-8 { animation-name: slide-in-from-left-8; }
        .slide-in-from-right-8 { animation-name: slide-in-from-right-8; }
        .zoom-in-95 { animation-name: zoom-in-95; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </div>
  );
};

export default App;
