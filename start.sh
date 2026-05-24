#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
FRONTEND_DIR="$ROOT_DIR/client"
CN_MODEL_DIR="$SERVER_DIR/models/vosk-model-cn-0.22"
CN_MODEL_URL="https://alphacephei.com/vosk/models/vosk-model-cn-0.22.zip"
EN_MODEL_DIR="$SERVER_DIR/models/vosk-model-small-en-us-0.15"
EN_MODEL_URL="https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
FE_PORT=9000
BE_PORT=9001
TSC_PORT=9002

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERR]${NC}   $1"; }
step()  { echo -e "\n${CYAN}▶ $1${NC}"; }

cleanup() {
    info "正在停止服务..."
    kill $TSC_PID 2>/dev/null || true
    kill $BE_PID 2>/dev/null || true
    kill $FE_PID 2>/dev/null || true
    wait $TSC_PID 2>/dev/null || true
    wait $BE_PID 2>/dev/null || true
    wait $FE_PID 2>/dev/null || true
    info "已停止所有服务"
}
trap cleanup EXIT INT TERM

# ========== 1. 环境检查 ==========
step "检查运行环境"
missing=()
command -v node    >/dev/null 2>&1 || missing+=("node")
command -v python3 >/dev/null 2>&1 || missing+=("python3")
command -v ffmpeg  >/dev/null 2>&1 || missing+=("ffmpeg")
command -v unzip   >/dev/null 2>&1 || missing+=("unzip")
command -v curl    >/dev/null 2>&1 || missing+=("curl")

if [ ${#missing[@]} -gt 0 ]; then
    err "缺少依赖: ${missing[*]}"
    err "请先安装: sudo apt install ${missing[*]}"
    exit 1
fi
info "环境检查通过: node $(node -v), python $(python3 --version | awk '{print $2}'), ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"

# ========== 2. 安装后端依赖 ==========
step "安装后端 npm 依赖"
cd "$SERVER_DIR"
if [ ! -d "node_modules" ]; then
    npm install --no-audit --no-fund 2>&1 | tail -3
    info "npm 依赖安装完成"
else
    info "npm 依赖已存在，跳过"
fi

# ========== 3. 安装 Python 依赖 ==========
step "检查 Python 依赖"
pip3 install vosk flask -q 2>&1 | tail -2
info "Python 依赖已就绪 (vosk + flask)"

# ========== 4. 下载 Vosk 中文模型 (完整版, 约 1.4GB) ==========
step "检查 Vosk 中文模型"
if [ ! -f "$CN_MODEL_DIR/conf/model.conf" ]; then
    info "中文模型未找到，开始下载 (约 1.4GB，请耐心等待)..."
    mkdir -p "$SERVER_DIR/models"
    CN_ZIP="/tmp/vosk-model-cn-0.22.zip"

    if [ ! -f "$CN_ZIP" ]; then
        curl -L -o "$CN_ZIP" "$CN_MODEL_URL" --connect-timeout 10 --max-time 600 -#
        echo ""
    else
        info "使用缓存的中文模型压缩包"
    fi

    info "解压中文模型..."
    unzip -o "$CN_ZIP" -d "$SERVER_DIR/models/" 2>&1 | tail -2
    info "中文模型就绪: $CN_MODEL_DIR"
else
    info "中文模型已存在: $CN_MODEL_DIR"
fi

# ========== 5. 下载 Vosk 英文模型 (小版, 约 40MB) ==========
step "检查 Vosk 英文模型"
if [ ! -f "$EN_MODEL_DIR/conf/model.conf" ]; then
    info "英文模型未找到，开始下载 (约 40MB)..."
    EN_ZIP="/tmp/vosk-model-small-en-us-0.15.zip"

    if [ ! -f "$EN_ZIP" ]; then
        curl -L -o "$EN_ZIP" "$EN_MODEL_URL" --connect-timeout 10 --max-time 120 -#
        echo ""
    else
        info "使用缓存的英文模型压缩包"
    fi

    info "解压英文模型..."
    unzip -o "$EN_ZIP" -d "$SERVER_DIR/models/" 2>&1 | tail -2
    info "英文模型就绪: $EN_MODEL_DIR"
else
    info "英文模型已存在: $EN_MODEL_DIR"
fi

# ========== 6. 检查端口占用 ==========
step "检查端口占用"
for port in $FE_PORT $BE_PORT $TSC_PORT; do
    if lsof -ti :$port >/dev/null 2>&1; then
        warn "端口 $port 已被占用，尝试释放..."
        kill $(lsof -ti :$port) 2>/dev/null || true
        sleep 1
    fi
done
info "端口 $FE_PORT / $BE_PORT / $TSC_PORT 可用"

# ========== 7. 启动转录服务 (Flask, 端口 $TSC_PORT) ==========
step "启动转录服务 (端口 $TSC_PORT)"
cd "$SERVER_DIR"
python3 transcribe_server.py &
TSC_PID=$!
sleep 3

if ! kill -0 $TSC_PID 2>/dev/null; then
    err "转录服务启动失败"
    exit 1
fi

if curl -s http://localhost:$TSC_PORT/health >/dev/null 2>&1; then
    info "转录服务启动成功 → http://localhost:$TSC_PORT"
    curl -s http://localhost:$TSC_PORT/health | python3 -m json.tool
else
    warn "转录服务健康检查未响应，继续..."
fi

# ========== 8. 启动后端 ==========
step "启动后端服务 (端口 $BE_PORT)"
cd "$SERVER_DIR"
node index.js &
BE_PID=$!
sleep 2

if ! kill -0 $BE_PID 2>/dev/null; then
    err "后端启动失败，查看日志: /tmp/voice-server.log"
    exit 1
fi

if curl -s http://localhost:$BE_PORT/api/health >/dev/null 2>&1; then
    info "后端启动成功 → http://localhost:$BE_PORT"
    curl -s http://localhost:$BE_PORT/api/health
else
    warn "后端健康检查未响应，继续启动前端..."
fi

# ========== 9. 启动前端 ==========
step "启动前端服务 (端口 $FE_PORT)"
cd "$FRONTEND_DIR"
python3 -m http.server $FE_PORT &
FE_PID=$!
sleep 1

if ! kill -0 $FE_PID 2>/dev/null; then
    err "前端启动失败"
    exit 1
fi
info "前端启动成功 → http://localhost:$FE_PORT"

# ========== 10. 启动完成 ==========
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       语音输入法 启动完成           ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  前端页面:    ${CYAN}http://localhost:$FE_PORT${NC}      ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  后端转写:    ${CYAN}http://localhost:$BE_PORT${NC}      ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  转录引擎:    ${CYAN}http://localhost:$TSC_PORT${NC}      ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  转写引擎:    ${YELLOW}Vosk (CN + EN)${NC}         ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  按 ${RED}Ctrl+C${NC} 停止所有服务            ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# 保持前台运行
wait
