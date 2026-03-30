# Electron 白屏问题排查与解决

## 问题原因

Electron打包后使用 `file://` 协议加载页面，**BrowserRouter无法正常工作**。

## 解决方案

已将 `BrowserRouter` 改为 `HashRouter`。

### 修改内容

**frontend/src/App.jsx**
```jsx
// 改前
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

// 改后
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
```

## 重新打包

```bash
cd frontend

# 重新打包
npm run electron:build
```

## 调试方法

如果重新打包后仍然白屏，可以临时打开开发者工具查看错误：

### 方法一：修改 Electron 主进程

编辑 `frontend/electron/main.cjs` 第66行：

```javascript
} else {
  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  mainWindow.webContents.openDevTools()  // 添加这行，打开开发者工具
}
```

重新打包后运行，可以看到控制台错误信息。

### 方法二：查看日志文件

Electron应用会在用户数据目录生成日志：

- **Windows**: `C:\Users\<用户名>\AppData\Roaming\mt-coupon-frontend\logs\`
- **macOS**: `~/Library/Application Support/mt-coupon-frontend/logs/`
- **Linux**: `~/.config/mt-coupon-frontend/logs/`

打开最新的日志文件查看错误信息。

## 验证步骤

1. 重新打包应用
2. 安装运行
3. 地址栏应该显示 `file:///.../index.html#/login`（注意 `#/` 哈希路由）
4. 如果正常，删除调试代码重新打包
