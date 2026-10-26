const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  state: () => ipcRenderer.invoke('state'),
  register: (name) => ipcRenderer.invoke('register', name),
  switchTo: (name) => ipcRenderer.invoke('switch', name),
  add: (name) => ipcRenderer.invoke('add', name),
  rename: (oldName, newName) => ipcRenderer.invoke('rename', oldName, newName),
  remove: (name) => ipcRenderer.invoke('remove', name),
  launch: () => ipcRenderer.invoke('launch'),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, step) => cb(step)),
  windowControl: (action) => ipcRenderer.send('window', action),
});
