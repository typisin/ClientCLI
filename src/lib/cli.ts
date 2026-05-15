import { Command } from '@tauri-apps/plugin-shell';

// 尝试获取常见的 Node/npm 路径，包含 macOS 和 Windows 的常见路径
const COMMON_PATHS = [
  // macOS 路径
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/Users/youpengtu/.nvm/versions/node/v20.14.0/bin',
  '/usr/bin',
  // Windows 路径
  'C:\\Program Files\\nodejs',
  'C:\\Program Files (x86)\\nodejs',
  '%APPDATA%\\npm'
];

// 一个辅助函数，用来在未配置全局 PATH 时，尝试用绝对路径运行
const runCommandWithFallbacks = async (cmdName: string, args: string[]) => {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  
  try {
    if (isWindows) {
      // Windows 下通过 cmd /c 或者 powershell -c 来执行，这样可以继承系统环境变量
      const cmd = await Command.create('cmd', ['/c', cmdName, ...args]).execute();
      if (cmd.code === 0) return true;
    } else {
      // 先尝试直接运行（如果系统 PATH 有配置）
      const cmd = await Command.create(cmdName, args).execute();
      if (cmd.code === 0) return true;
    }
  } catch (e) {
    // 忽略直接运行失败
  }

  // 尝试加上常见路径前缀
  for (const p of COMMON_PATHS) {
    try {
      const fullCmd = isWindows ? `${p}\\${cmdName}.cmd` : `${p}/${cmdName}`;
      const cmd = isWindows 
        ? await Command.create('cmd', ['/c', fullCmd, ...args]).execute()
        : await Command.create(fullCmd, args).execute();
        
      if (cmd.code === 0) return true;
    } catch (e) {
      continue;
    }
  }
  return false;
};

export const checkNpm = async (): Promise<boolean> => {
  return await runCommandWithFallbacks('node', ['-v']) && await runCommandWithFallbacks('npm', ['-v']);
};

export const checkMeituCli = async (): Promise<boolean> => {
  return await runCommandWithFallbacks('meitu', ['--version']);
};

export const installMeituCli = async (onLog?: (log: string) => void): Promise<{success: boolean, output?: string, error?: string}> => {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  try {
    // npm install -g meitu-cli
    let cmd = isWindows 
      ? Command.create('cmd', ['/c', 'npm', 'install', '-g', 'meitu-cli'])
      : Command.create('npm', ['install', '-g', 'meitu-cli']);
    
    // 如果直接 npm 找不到，尝试找绝对路径
    try {
       await (isWindows ? Command.create('cmd', ['/c', 'npm', '-v']) : Command.create('npm', ['-v'])).execute();
    } catch (e) {
       for (const p of COMMON_PATHS) {
         try {
           const fullNpm = isWindows ? `${p}\\npm.cmd` : `${p}/npm`;
           await (isWindows ? Command.create('cmd', ['/c', fullNpm, '-v']) : Command.create(fullNpm, ['-v'])).execute();
           cmd = isWindows 
             ? Command.create('cmd', ['/c', fullNpm, 'install', '-g', 'meitu-cli'])
             : Command.create(fullNpm, ['install', '-g', 'meitu-cli']);
           break;
         } catch (err) {}
       }
    }

    if (onLog) {
      // 获取输出流
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

export const configAkSk = async (ak: string, sk: string): Promise<{success: boolean, error?: string}> => {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  try {
    let cmdAk = isWindows ? Command.create('cmd', ['/c', 'meitu', 'config', 'set-ak', '--value', ak]) : Command.create('meitu', ['config', 'set-ak', '--value', ak]);
    let cmdSk = isWindows ? Command.create('cmd', ['/c', 'meitu', 'config', 'set-sk', '--value', sk]) : Command.create('meitu', ['config', 'set-sk', '--value', sk]);

    // 路径回退处理
    try {
      await (isWindows ? Command.create('cmd', ['/c', 'meitu', '--version']) : Command.create('meitu', ['--version'])).execute();
    } catch (e) {
       for (const p of COMMON_PATHS) {
         try {
           const fullMeitu = isWindows ? `${p}\\meitu.cmd` : `${p}/meitu`;
           await (isWindows ? Command.create('cmd', ['/c', fullMeitu, '--version']) : Command.create(fullMeitu, ['--version'])).execute();
           cmdAk = isWindows ? Command.create('cmd', ['/c', fullMeitu, 'config', 'set-ak', '--value', ak]) : Command.create(fullMeitu, ['config', 'set-ak', '--value', ak]);
           cmdSk = isWindows ? Command.create('cmd', ['/c', fullMeitu, 'config', 'set-sk', '--value', sk]) : Command.create(fullMeitu, ['config', 'set-sk', '--value', sk]);
           break;
         } catch (err) {}
       }
    }

    const outAk = await cmdAk.execute();
    if (outAk.code !== 0) return { success: false, error: outAk.stderr };
    
    const outSk = await cmdSk.execute();
    return { success: outSk.code === 0, error: outSk.stderr };
  } catch (e: any) {
    return { success: false, error: e.toString() };
  }
};

export const runMeituCommand = async (args: string[], onLog?: (log: string) => void): Promise<{success: boolean, output: string, error?: string}> => {
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  try {
    let cmd = isWindows ? Command.create('cmd', ['/c', 'meitu', ...args]) : Command.create('meitu', args);

    // 路径回退处理
    try {
      await (isWindows ? Command.create('cmd', ['/c', 'meitu', '--version']) : Command.create('meitu', ['--version'])).execute();
    } catch (e) {
       for (const p of COMMON_PATHS) {
         try {
           const fullMeitu = isWindows ? `${p}\\meitu.cmd` : `${p}/meitu`;
           await (isWindows ? Command.create('cmd', ['/c', fullMeitu, '--version']) : Command.create(fullMeitu, ['--version'])).execute();
           cmd = isWindows ? Command.create('cmd', ['/c', fullMeitu, ...args]) : Command.create(fullMeitu, args);
           break;
         } catch (err) {}
       }
    }

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
