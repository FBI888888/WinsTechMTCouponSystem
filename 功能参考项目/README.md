# 美团CK券码制作工具 (Electron版)

基于 Electron + React + TailwindCSS 重构的美团CK券码制作工具。

## 功能特性

- **美团账号管理**: 添加、删除、导入/导出账号，检查账号状态
- **CK券码制作**: 使用CK方式获取订单券码并生成券码图片
- **Web券码制作**: Web方式制作券码 (维护中)
- **订单查询**: 查询美团订单列表，支持状态筛选
- **券码查询**: 批量查询券码信息，支持导出Excel
- **礼物领取监控**: 抓包监控礼物领取，自动捕获券码

## 技术栈

- **Electron**: 桌面应用框架
- **React 18**: 前端UI框架
- **TailwindCSS**: CSS框架
- **Vite**: 构建工具
- **Lucide Icons**: 图标库

## 开发环境

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
# 仅构建前端
npm run build

# 打包Windows安装程序
npm run package:win

# 打包便携版
npm run package:portable
```

## 目录结构

```
electronMtQrcodeTools/
├── main.js              # Electron主进程
├── preload.js           # 预加载脚本
├── AuthClient.js        # 鉴权客户端
├── services/            # 服务模块
│   ├── meituanAPI.js    # 美团API
│   ├── proxyService.js  # 代理服务(抓包)
│   └── qrcodeGenerator.js # 券码图片生成
├── src/
│   └── renderer/        # React前端
│       ├── App.jsx      # 主应用
│       ├── components/  # 组件
│       │   └── Sidebar.jsx
│       ├── pages/       # 页面
│       │   ├── AuthPage.jsx
│       │   ├── AccountPage.jsx
│       │   ├── CKQrcodePage.jsx
│       │   ├── WebQrcodePage.jsx
│       │   ├── OrdersPage.jsx
│       │   ├── CouponsPage.jsx
│       │   └── GiftMonitorPage.jsx
│       └── styles/
│           └── global.css
├── assets/              # 资源文件
├── package.json
├── vite.config.js
├── tailwind.config.js
└── electron-builder.yml # 打包配置
```

## 鉴权说明

本软件使用授权码激活方式，与 electronGetMtShops 使用相同的 AuthClient.js 鉴权机制。

## 版权声明

Copyright © 2025 聚合云 & 问世科技
