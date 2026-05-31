import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agentx', {
  pty: {
    spawn: () => ipcRenderer.invoke('pty:spawn'),
    write: (data: string) => ipcRenderer.send('pty:write', data),
    resize: (cols: number, rows: number) => ipcRenderer.send('pty:resize', { cols, rows }),
    onData: (cb: (data: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: string) => cb(data);
      ipcRenderer.on('pty:data', handler);
      return () => ipcRenderer.removeListener('pty:data', handler);
    },
    onExit: (cb: (info: { exitCode: number; signal: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: { exitCode: number; signal: number }) => cb(info);
      ipcRenderer.on('pty:exit', handler);
      return () => ipcRenderer.removeListener('pty:exit', handler);
    },
  },
});
