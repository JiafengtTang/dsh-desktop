'use strict'

const { Tray, Menu, nativeImage } = require('electron')

function createTray({ iconPath, onShow, onNewWindow, onQuit }) {
  try {
    let image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) {
      image = nativeImage.createEmpty()
    }
    if (process.platform === 'darwin') {
      image.setTemplateImage(true)
    }

    const tray = new Tray(image)
    tray.setToolTip('DeepSeek Harness')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show DeepSeek Harness', click: onShow },
      { label: 'New Window', click: onNewWindow },
      { type: 'separator' },
      { label: 'Quit', click: onQuit }
    ]))
    tray.on('click', onShow)
    return tray
  } catch (err) {
    console.error('[dsh-desktop] tray setup failed:', err)
    return null
  }
}

module.exports = { createTray }
