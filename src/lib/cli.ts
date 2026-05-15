import { Command } from '@tauri-apps/plugin-shell';

let globalNpmPrefix: string | null = null;

const getGlobalPrefix = async (): Promise<string> => {
  if (globalNpmPrefix) return globalNpmPrefix;
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  try {
    const cmd = isWindows ? Command.create('cmd', ['/c', 'npm', 'prefix', '-g']) : Command.create('npm', ['prefix', '-g']);
    const out = await cmd.execute();
    if (out.code === 0) {
      globalNpmPrefix = out.stdout.trim();
      return globalNpmPrefix;
    }
  } catch (e) {}
  return isWindows ? '%APPDATA%\\npm' : '/usr/local';
};

const resolveCmd = async (cmdName: string): Promise<{ base: string, args: string[] }> => {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  
  // 1. Try if it's in PATH
  try {
    const checkCmd = isWindows ? Command.create('cmd', ['/c', 'where', cmdName]) : Command.create('which', [cmdName]);
    const out = await checkCmd.execute();
    if (out.code === 0) {
      return isWindows ? { base: 'cmd', args: ['/c', cmdName] } : { base: cmdName, args: [] };
    }
  } catch (e) {}

  // 2. Fallback to npm global prefix
  const prefix = await getGlobalPrefix();
  if (isWindows) {
    const fullCmd = `${prefix}\\${cmdName}.cmd`;
    return { base: 'cmd', args: ['/c', fullCmd] };
  } else {
    const fullCmd = `${prefix}/bin/${cmdName}`;
    return { base: fullCmd, args: [] };
  }
};

export const checkNpm = async (): Promise<boolean> => {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  try {
    const cmdNode = isWindows ? Command.create('cmd', ['/c', 'node', '-v']) : Command.create('node', ['-v']);
    const cmdNpm = isWindows ? Command.create('cmd', ['/c', 'npm', '-v']) : Command.create('npm', ['-v']);
    const outNode = await cmdNode.execute();
    const outNpm = await cmdNpm.execute();
    return outNode.code === 0 && outNpm.code === 0;
  } catch (e) {
    return false;
  }
};

export const installNodeJs = async (onLog?: (log: string) => void): Promise<{success: boolean, error?: string}> => {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  try {
    if (isWindows) {
      if (onLog) onLog('> 正在下载 Node.js 安装包...');
      const downloadCmd = Command.create('powershell', [
        '-Command',
        "$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri https://nodejs.org/dist/v20.14.0/node-v20.14.0-x64.msi -OutFile $env:TEMP\\node_installer.msi"
      ]);
      const dlRes = await downloadCmd.execute();
      if (dlRes.code !== 0) {
        return { success: false, error: '下载 Node.js 失败: ' + dlRes.stderr };
      }

      if (onLog) onLog('> 下载完成，正在启动安装程序，请在弹出的窗口中允许安装...');
      const installCmd = Command.create('cmd', ['/c', 'start', '', '%TEMP%\\node_installer.msi']);
      await installCmd.execute();
      if (onLog) onLog('> 安装程序已启动！安装完成后请重启本软件。');
      return { success: true };
    } else {
      if (onLog) onLog('> 正在下载 Node.js 安装包...');
      const downloadCmd = Command.create('curl', [
        '-L',
        '-o',
        '/tmp/node_installer.pkg',
        'https://nodejs.org/dist/v20.14.0/node-v20.14.0.pkg'
      ]);
      const dlRes = await downloadCmd.execute();
      if (dlRes.code !== 0) {
        return { success: false, error: '下载 Node.js 失败: ' + dlRes.stderr };
      }

      if (onLog) onLog('> 下载完成，正在启动安装程序...');
      const installCmd = Command.create('open', ['/tmp/node_installer.pkg']);
      await installCmd.execute();
      if (onLog) onLog('> 安装程序已启动！安装完成后请重启本软件。');
      return { success: true };
    }
  } catch (e: any) {
    return { success: false, error: e.toString() };
  }
};

export const checkMeituCli = async (): Promise<boolean> => {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  try {
    const cmd = isWindows ? Command.create('cmd', ['/c', 'npm', 'ls', '-g', 'meitu-cli']) : Command.create('npm', ['ls', '-g', 'meitu-cli']);
    const out = await cmd.execute();
    return out.code === 0;
  } catch (e) {
    return false;
  }
};

export const installMeituCli = async (onLog?: (log: string) => void): Promise<{success: boolean, output?: string, error?: string}> => {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  try {
    const cmd = isWindows 
      ? Command.create('cmd', ['/c', 'npm', 'install', '-g', 'meitu-cli'])
      : Command.create('npm', ['install', '-g', 'meitu-cli']);
    
    if (onLog) {
      cmd.stdout.on('data', line => onLog(line));
      cmd.stderr.on('data', line => onLog(line));
      
      const output = await cmd.execute();
      if (output.code !== 0 && output.stderr) {
         onLog(output.stderr);
      }
      return { success: output.code === 0, output: output.stdout, error: output.stderr };
    } else {
      const output = await cmd.execute();
      return { success: output.code === 0, output: output.stdout, error: output.stderr };
    }
  } catch (e: any) {
    return { success: false, error: e.toString() };
  }
};

export const getMeituEnv = () => {
  const ak = localStorage.getItem('meitu_ak') || '';
  const sk = localStorage.getItem('meitu_sk') || '';
  return {
    MEITU_OPENAPI_BASE_URL: 'https://openapi.meitu.com',
    MEITU_OPENAPI_STRATEGY_BASE_URL: 'https://openapi.meitu.com',
    MEITU_OPENAPI_ACCESS_KEY: ak,
    MEITU_OPENAPI_SECRET_KEY: sk
  };
};

export const configAkSk = async (ak: string, sk: string): Promise<{success: boolean, error?: string}> => {
  try {
    const resolved = await resolveCmd('meitu');
    const env = getMeituEnv();
    const cmdAk = Command.create(resolved.base, [...resolved.args, 'config', 'set-ak', '--value', ak], { env });
    const cmdSk = Command.create(resolved.base, [...resolved.args, 'config', 'set-sk', '--value', sk], { env });

    const outAk = await cmdAk.execute();
    if (outAk.code !== 0) return { success: false, error: outAk.stderr };
    
    const outSk = await cmdSk.execute();
    return { success: outSk.code === 0, error: outSk.stderr };
  } catch (e: any) {
    return { success: false, error: e.toString() };
  }
};

export const runMeituCommand = async (args: string[], onLog?: (log: string) => void): Promise<{success: boolean, output: string, error?: string}> => {
  try {
    const resolved = await resolveCmd('meitu');
    const env = getMeituEnv();
    const cmd = Command.create(resolved.base, [...resolved.args, ...args], { env });

    if (onLog) {
      cmd.stdout.on('data', line => onLog(`> ${line}`));
      cmd.stderr.on('data', line => onLog(`[stderr] ${line}`));
    }
    
    const output = await cmd.execute();
    return { 
      success: output.code === 0, 
      output: output.stdout,
      error: output.stderr 
    };
  } catch (e: any) {
    return { success: false, output: '', error: e.toString() };
  }
};
