# 七牛云 × XEngineer 暑期实训营

语音输入法项目

## 技术栈

采用了原生的前端技术栈 html + css + js 构建了简单的语音识别输入 demo 项目。
后端用nodejs搭建了一个简单的服务器，提供了一个接口来接收前端发送的语音数据，并调用本地部署的语音转文本服务进行处理。
语音转文本服务使用了开源的 Vosk 模型，部署在本地。

## 注意事项

1. 语音输入需要麦克风录制权限，只能在 localhost 下使用。
2. 需要 node python3 环境

## 项目结构

这里只列出一些比较关键的文件，目的是展示基本的项目架构。

```
├── README.md
├── server
│   ├── models
│   │   └── vosk 相关组件
│   ├── index.js 服务器入口
│   └── transcribe.py 语音转文本脚本
├── client
│   ├── index.html 前端页面
│   ├── style.css 样式文件
│   └── app.mjs 前端逻辑
```

## 运行项目

根目录下有启动脚本 `start.sh`，运行它会同时启动前后端服务器和本地的语音转文本服务（一个本地部署的小模型-精度有限）。

```bash
chmod +x start.sh
./start.sh
```

浏览器访问 `http://localhost:9000`，即可开始使用。