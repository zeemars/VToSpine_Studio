# VToSpine Studio

![VToSpine Studio](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=modern%20web%20application%20interface%20for%20video%20to%20spine%20animation%20converter%2C%20blue%20theme%2C%20clean%20design%2C%20professional%20UI&image_size=landscape_16_9)

一个专业的视频转 Spine 动画转换工具，支持视频解析、背景抠图、帧处理和 Spine 格式导出。

## 功能特性

### 🎥 视频处理
- 支持批量视频文件上传
- 拖放功能，方便快速导入视频
- 自动提取视频帧
- 智能背景色检测

### 🎨 图像处理
- 专业色度键抠图算法
- 可调节阈值和平滑度参数
- 实时预览抠图效果
- 多背景预览模式（棋盘格、白色、黑色、绿色、蓝色）

### 📤 导出功能
- Spine 格式导出（JSON + Atlas + PNG）
- 单独 PNG 精灵表导出
- 透明 GIF 动画导出
- 按视频文件名命名导出文件
- 批量导出为 ZIP 包

### 🌐 其他特性
- 中英文双语界面
- 现代化响应式设计
- 流畅的动画效果
- 纯客户端实现，无需服务器

## 技术栈

- **前端框架**：React 19.2.4
- **构建工具**：Vite 6.2.0
- **类型系统**：TypeScript 5.8.2
- **图标库**：Lucide React
- **图像处理**：Canvas API
- **视频处理**：HTML5 Video API
- **文件处理**：JSZip (CDN)
- **GIF 生成**：GIF.js (CDN)

## 安装和运行

### 前置要求
- Node.js 16.0 或更高版本
- npm 7.0 或更高版本

### 安装步骤

1. 克隆项目
```bash
git clone <repository-url>
cd VToSpine_Studio
```

2. 安装依赖
```bash
npm install
```

3. 启动开发服务器
```bash
npm run dev
```

4. 构建生产版本
```bash
npm run build
```

5. 预览生产构建
```bash
npm run preview
```

## 使用指南

### 1. 导入视频
- 点击上传区域或直接拖放视频文件到上传区域
- 支持同时导入多个视频文件

### 2. 处理帧
- 选择要处理的视频任务
- 点击「Process Current」按钮开始处理
- 系统会自动提取帧并应用抠图
- 可手动调整抠图参数（背景色、阈值、平滑度）
- 可选择/取消选择要包含的帧

### 3. 导出设置
- 调整导出参数（宽度、高度、帧率、前缀）
- 选择导出格式：
  - **Download Spine ZIP**：导出完整的 Spine 项目文件
  - **Export PNG**：导出精灵表 PNG 文件
  - **Download GIF ZIP**：导出透明 GIF 动画
- 点击对应按钮开始导出
- 导出完成后会自动下载 ZIP 包

## 项目结构

```
VToSpine_Studio/
├── App.tsx               # 主应用组件
├── index.tsx             # 应用入口
├── types.ts              # TypeScript 类型定义
├── translations.ts       # 多语言支持
├── utils/
│   ├── imageProcessing.ts  # 图像处理（帧提取、抠图）
│   └── spineExporter.ts    # Spine 导出功能
├── dist/                 # 构建输出
├── package.json          # 项目配置
└── vite.config.ts        # Vite 配置
```

## 核心功能实现

### 视频帧提取
使用 HTML5 Video API 和 Canvas API 提取视频帧：
- 加载视频并获取元数据
- 按指定间隔提取帧
- 将帧绘制到 Canvas 并转换为 Base64 编码

### 色度键抠图
实现了专业的色度键算法：
- 计算像素与目标颜色的欧氏距离
- 根据阈值和平滑度参数处理透明度
- 支持边缘平滑，获得更自然的抠图效果

### Spine 导出
生成符合 Spine 格式的文件：
- 网格布局精灵表生成
- Spine JSON 动画数据创建
- Atlas 文件生成
- 批量文件打包为 ZIP

## 浏览器兼容性

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目！

### 开发流程
1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

## 许可证

本项目采用 MIT 许可证 - 详情请参阅 [LICENSE](LICENSE) 文件

## 致谢

- [React](https://react.dev/) - 用于构建用户界面的 JavaScript 库
- [Vite](https://vitejs.dev/) - 现代前端构建工具
- [Lucide React](https://lucide.dev/) - 精美开源图标库
- [JSZip](https://stuk.github.io/jszip/) - JavaScript ZIP 库
- [GIF.js](https://jnordberg.github.io/gif.js/) - JavaScript GIF 生成库

## 联系方式

- 项目链接：[VToSpine Studio](https://github.com/zee-mars/vtospine-studio)
- Bilibili 空间：[https://space.bilibili.com/487432166](https://space.bilibili.com/487432166)

---

**享受视频转 Spine 动画的乐趣！** 🎉