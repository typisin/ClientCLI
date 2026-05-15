import { useState, useEffect, useRef } from 'react';
import { checkNpm, checkMeituCli, installMeituCli, runMeituCommand, runMeituCommandNativeBatch, installNodeJs } from './lib/cli';
import { AlertCircle, CheckCircle2, Settings, Terminal, TerminalSquare, Loader2, Play, Image as ImageIcon, Folder, FolderOpen, Download } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir, mkdir, exists } from '@tauri-apps/plugin-fs';

type Page = 'home' | 'config';

interface TaskState {
  total: number;
  current: number;
  outputDir: string | null;
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [envStatus, setEnvStatus] = useState({ npm: false, meitu: false, checking: true });
  
  // Ak/Sk state
  const [ak, setAk] = useState('');
  const [sk, setSk] = useState('');
  const [configStatus, setConfigStatus] = useState<{loading: boolean, error?: string, success?: string}>({ loading: false });

  // Execution state
  const [imageUrl, setImageUrl] = useState('');
  const [isFolder, setIsFolder] = useState(false);
  const [prompt, setPrompt] = useState('高清');
  const [outputDir, setOutputDir] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [taskState, setTaskState] = useState<TaskState | null>(null);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkEnvironment();
    // 检查本地是否保存了配置状态
    const saved = localStorage.getItem('meitu_configured');
    if (saved !== 'true') {
      setPage('config');
    } else {
      const savedAk = localStorage.getItem('meitu_ak');
      const savedSk = localStorage.getItem('meitu_sk');
      if (savedAk) setAk(savedAk);
      if (savedSk) setSk(savedSk);
    }
  }, []);

  const checkEnvironment = async () => {
    setEnvStatus(prev => ({ ...prev, checking: true }));
    const hasNpm = await checkNpm();
    const hasMeitu = await checkMeituCli();
    setEnvStatus({ npm: hasNpm, meitu: hasMeitu, checking: false });
  };

  const handleInstallNode = async () => {
    setEnvStatus(prev => ({ ...prev, checking: true }));
    setInstallLogs(['> 准备安装 Node.js...']);
    const res = await installNodeJs((log) => {
      setInstallLogs(prev => [...prev, log]);
    });
    
    if (!res.success) {
      setInstallLogs(prev => [...prev, `❌ 安装启动失败:\n${res.error}`]);
      setEnvStatus(prev => ({ ...prev, checking: false }));
    } else {
      // 成功启动安装程序后，保持 checking 状态或者让用户重启
      setEnvStatus(prev => ({ ...prev, checking: false }));
    }
  };

  const handleInstallCli = async () => {
    if (!envStatus.npm) {
      setInstallLogs(['❌ 请先在电脑上安装 Node.js (https://nodejs.org/)']);
      return;
    }
    
    setEnvStatus(prev => ({ ...prev, checking: true }));
    setInstallLogs(['> 开始安装 meitu-cli，这可能需要几十秒时间，请耐心等待...']);
    const res = await installMeituCli((log) => {
      setInstallLogs(prev => [...prev, log]);
    });
    
    if (res.success) {
      setInstallLogs(prev => [...prev, '✅ 安装成功！']);
      await checkEnvironment();
    } else {
      setInstallLogs(prev => [...prev, `❌ 安装失败，请检查网络或权限:\n${res.error || res.output}`]);
      setEnvStatus(prev => ({ ...prev, checking: false }));
    }
  };

  const handleSaveConfig = async () => {
    if (!ak || !sk) {
      setConfigStatus({ loading: false, error: 'AK 和 SK 不能为空' });
      return;
    }
    setConfigStatus({ loading: true });
    
    // 不再调用 configAkSk，因为我们直接通过环境变量传给 CLI
    setConfigStatus({ loading: false, success: '配置已成功保存到本地' });
    localStorage.setItem('meitu_ak', ak);
    localStorage.setItem('meitu_sk', sk);
    localStorage.setItem('meitu_configured', 'true');
    setTimeout(() => setPage('home'), 1500);
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleSelectImage = async (directory = false) => {
    try {
      const selected = await open({
        multiple: false,
        directory: directory,
        filters: directory ? undefined : [{
          name: 'Image',
          extensions: ['png', 'jpeg', 'jpg', 'webp']
        }]
      });
      if (selected && typeof selected === 'string') {
        setImageUrl(selected);
        setIsFolder(directory);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectOutputDir = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });
      if (selected && typeof selected === 'string') {
        setOutputDir(selected);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const parseOutputPath = (output: string): string | null => {
    try {
      // 提取被 stdout 中的非 JSON 内容污染的部分，找到 JSON 字符串
      const jsonStart = output.indexOf('{');
      const jsonEnd = output.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = output.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr);
        // 如果有 downloaded_files，优先取 saved_path
        if (parsed?.downloaded_files?.[0]?.saved_path) {
          return parsed.downloaded_files[0].saved_path;
        } else if (parsed?.local_paths?.[0]) {
          return parsed.local_paths[0];
        } else if (parsed?.media_urls?.[0]) {
           // 如果没有指定下载目录，它可能只返回了云端 url
          return parsed.media_urls[0];
        }
      }
    } catch (e) {
      console.error('JSON 解析失败:', e, output);
    }
    return null;
  };

  const handleOpenFolder = async (path: string) => {
    try {
      // 去掉文件名，获取所在目录
      const dirPath = path.substring(0, path.lastIndexOf('/')) || path.substring(0, path.lastIndexOf('\\'));
      // Tauri 2 的 plugin-shell 可以通过 open 命令打开目录
      const command = await import('@tauri-apps/plugin-shell').then(m => m.Command);
      
      // 对于跨平台，更好的方式是利用系统的默认应用打开
      // Windows: explorer, macOS: open, Linux: xdg-open
      const isWindows = navigator.userAgent.toLowerCase().includes('windows');
      const openCmd = isWindows ? 'explorer' : 'open';
      await command.create(openCmd, [dirPath]).execute();
    } catch (err) {
      console.error('打开目录失败:', err);
    }
  };

  const handleExecute = async () => {
    if (!imageUrl.trim()) {
      setLogs(prev => [...prev, '❌ 请先选择路径']);
      return;
    }
    if (!outputDir.trim()) {
      setLogs(prev => [...prev, '❌ 请先选择输出保存目录']);
      return;
    }
    if (!prompt.trim()) {
      setLogs(prev => [...prev, '❌ 请输入效果描述']);
      return;
    }
    
    setIsExecuting(true);
    setTaskState(null);
    
    try {
        let imagePaths: string[] = [];
      
      // 我们统一把文件输出到用户指定的 outputDir 目录里
      try {
        const dirExists = await exists(outputDir);
        if (!dirExists) {
          await mkdir(outputDir, { recursive: true });
        }
      } catch (e) {
        console.error('检测或创建输出目录失败:', e);
        setLogs(prev => [...prev, '❌ 输出目录异常，请检查权限或重新选择']);
        setIsExecuting(false);
        return;
      }

      if (isFolder) {
        setLogs([`> 正在读取文件夹: ${imageUrl}`]);
        const entries = await readDir(imageUrl);
        imagePaths = entries
          .filter(e => e.isFile && /\.(png|jpe?g|webp)$/i.test(e.name))
          .map(e => `${imageUrl}/${e.name}`); // 简单拼接，考虑跨平台可能需要更严谨的路径处理
          
        if (imagePaths.length === 0) {
          setLogs(prev => [...prev, '❌ 文件夹中未找到支持的图片文件 (png, jpg, jpeg, webp)']);
          setIsExecuting(false);
          return;
        }
        setLogs(prev => [...prev, `✅ 找到 ${imagePaths.length} 张图片，即将打开系统终端进行处理...`]);
        setTaskState({ total: imagePaths.length, current: 0, outputDir: null });
      } else {
        imagePaths = [imageUrl];
        setLogs([`> 准备处理单张图片，即将打开系统终端...`]);
      }

      setLogs(prev => [...prev, '\n🚀 已在独立的终端窗口中启动处理任务！\n请查看弹出的终端窗口以了解实时进度。处理完成后，终端会提示"All tasks completed!"。']);
      
      const res = await runMeituCommandNativeBatch(imagePaths, prompt, outputDir);
      
      if (res.success) {
        setTaskState({ total: imagePaths.length, current: imagePaths.length, outputDir: outputDir });
      } else {
        setLogs(prev => [...prev, `\n❌ 启动终端失败:\n${res.error}`]);
      }

    } catch (e: any) {
      setLogs(prev => [...prev, `❌ 发生异常: ${e.message || String(e)}`]);
    }

    setIsExecuting(false);
  };

  const renderConfig = () => (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2 text-gray-800 dark:text-gray-100">
        <Settings className="w-6 h-6 text-indigo-500" />
        系统配置
      </h2>

      {/* Environment Check */}
      <div className="mb-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">环境检测</h3>
        {envStatus.checking ? (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Loader2 className="w-4 h-4 animate-spin" /> 检测中...
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {envStatus.npm ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertCircle className="w-5 h-5 text-amber-500" />}
                <span className="text-sm text-gray-700 dark:text-gray-200">Node.js / npm</span>
              </div>
              {envStatus.npm ? (
                <span className="text-xs text-gray-500">已安装</span>
              ) : (
                <button 
                  onClick={handleInstallNode}
                  className="px-3 py-1 text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-md transition-colors flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  一键下载安装
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {envStatus.meitu ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertCircle className="w-5 h-5 text-amber-500" />}
                <span className="text-sm text-gray-700 dark:text-gray-200">Meitu CLI</span>
              </div>
              {envStatus.meitu ? (
                <span className="text-xs text-gray-500">已安装</span>
              ) : (
                <button 
                  onClick={handleInstallCli}
                  className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors"
                >
                  一键安装
                </button>
              )}
            </div>
          </div>
        )}
        
        {/* 安装日志展示区域 */}
        {installLogs.length > 0 && !envStatus.meitu && (
          <div className="mt-4 p-3 bg-gray-900 rounded-md border border-gray-800 h-[150px] overflow-y-auto">
            <div className="text-xs font-mono text-gray-300 space-y-1 whitespace-pre-wrap">
              {installLogs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      {/* AK/SK Config */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">凭证配置</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Access Key (AK)</label>
          <input 
            type="password"
            value={ak}
            onChange={e => setAk(e.target.value)}
            placeholder="请输入 AK"
            className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-gray-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Secret Key (SK)</label>
          <input 
            type="password"
            value={sk}
            onChange={e => setSk(e.target.value)}
            placeholder="请输入 SK"
            className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-gray-100"
          />
        </div>

        {configStatus.error && <p className="text-sm text-red-500 mt-2">{configStatus.error}</p>}
        {configStatus.success && <p className="text-sm text-emerald-500 mt-2">{configStatus.success}</p>}

        <button 
          onClick={handleSaveConfig}
          disabled={configStatus.loading || !envStatus.meitu}
          className="w-full mt-6 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
        >
          {configStatus.loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '保存配置'}
        </button>
        {!envStatus.meitu && <p className="text-xs text-center text-amber-500 mt-2">请先安装 Meitu CLI 再保存配置</p>}
      </div>
    </div>
  );

  const renderHome = () => (
    <div className="max-w-3xl mx-auto mt-10 p-6">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-semibold flex items-center gap-2 text-gray-800 dark:text-gray-100">
          <TerminalSquare className="w-6 h-6 text-indigo-500" />
          任务执行
        </h2>
        <button 
          onClick={() => setPage('config')}
          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          title="配置"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">本地图片路径</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <ImageIcon className="w-4 h-4" />
              </span>
              <input 
                type="text"
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
                placeholder="请选择或输入需要变高清的图片路径"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-gray-100 text-sm"
              />
            </div>
            <button
              onClick={() => handleSelectImage(false)}
              className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium border border-gray-300 dark:border-gray-600"
            >
              <ImageIcon className="w-4 h-4" />
              单张图片
            </button>
            <button
              onClick={() => handleSelectImage(true)}
              className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-800/50 text-indigo-700 dark:text-indigo-300 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium border border-indigo-200 dark:border-indigo-800"
            >
              <FolderOpen className="w-4 h-4" />
              整个文件夹
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">输出保存目录</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <Folder className="w-4 h-4" />
              </span>
              <input 
                type="text"
                value={outputDir}
                onChange={e => setOutputDir(e.target.value)}
                placeholder="请选择高清图片保存的目录"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-gray-100 text-sm"
              />
            </div>
            <button
              onClick={handleSelectOutputDir}
              className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium border border-gray-300 dark:border-gray-600"
            >
              <FolderOpen className="w-4 h-4" />
              选择目录
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">效果描述 (Prompt)</label>
          <input 
            type="text"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="例如: 高清"
            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all dark:text-gray-100 text-sm"
          />
        </div>

        <div className="pt-2">
          <button 
            onClick={handleExecute}
            disabled={isExecuting || !imageUrl.trim()}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
          >
            {isExecuting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
            {isExecuting ? '处理中...' : '开始一键变高清'}
          </button>
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 shadow-sm flex flex-col h-[350px]">
        <div className="bg-gray-950 px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-gray-400" />
            <span className="text-xs font-mono text-gray-400">输出日志</span>
          </div>
          
          {taskState && (
            <div className="flex items-center gap-4">
              {taskState.total > 1 && (
                <span className="text-xs font-mono text-indigo-400 bg-indigo-900/30 px-2 py-1 rounded">
                  进度: {taskState.current} / {taskState.total}
                </span>
              )}
              {taskState.outputDir && (
                <button 
                  onClick={() => handleOpenFolder(taskState.outputDir!)}
                  className="flex items-center gap-1.5 text-xs font-mono text-emerald-400 hover:text-emerald-300 bg-emerald-900/30 hover:bg-emerald-900/50 px-2 py-1 rounded transition-colors"
                >
                  <Folder className="w-3.5 h-3.5" />
                  打开输出目录
                </button>
              )}
            </div>
          )}
        </div>
        <div className="p-4 overflow-y-auto flex-1 font-mono text-sm text-gray-300 space-y-1">
          {logs.length === 0 ? (
            <div className="text-gray-600 italic">暂无执行日志...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">{log}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 w-full text-gray-900 dark:text-gray-100 font-sans">
      {page === 'config' ? renderConfig() : renderHome()}
    </div>
  );
}

export default App;