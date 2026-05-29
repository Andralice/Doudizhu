# 斗地主服务器 部署脚本 (PowerShell)
# 用法: .\deploy.ps1
$ErrorActionPreference = "Continue"

$SSH_KEY = "$env:USERPROFILE\.ssh\id_ed25519"
$SERVER = "alice@154.8.213.134"
$REMOTE_DIR = "~/dld-server"
$PORT = 8088

# DeepSeek AI 配置
$DEEPSEEK_API_KEY = "sk-96def72c5c264af98e3057581f5352dc"
$DEEPSEEK_MODEL = "deepseek-v4-pro"

function ssh-exec {
    param([string]$cmd)
    $arg = "-i `"$SSH_KEY`" -o StrictHostKeyChecking=no $SERVER `"$cmd`""
    $result = cmd /c "ssh $arg 2>&1"
    return $result
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  斗地主服务器 部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Build
Write-Host "[1/5] TypeScript 构建..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\dld-server"
npm install --production 2>&1 | Out-Null
npx tsc
if (-not (Test-Path "dist/main.js")) {
    Write-Host "构建失败!" -ForegroundColor Red
    exit 1
}
Write-Host "构建完成" -ForegroundColor Green

# 2. Upload
Write-Host "[2/5] 上传文件..." -ForegroundColor Yellow
# Create remote dir
ssh-exec "mkdir -p $REMOTE_DIR/dist $REMOTE_DIR/public $REMOTE_DIR/node_modules"

# Write .env file on server
ssh-exec "cat > $REMOTE_DIR/.env << 'ENVEOF'
DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY
DEEPSEEK_MODEL=$DEEPSEEK_MODEL
PORT=$PORT
ENVEOF"

# Upload dist and public
scp -r -i $SSH_KEY -o StrictHostKeyChecking=no "dist\*" "${SERVER}:${REMOTE_DIR}/dist/"
scp -r -i $SSH_KEY -o StrictHostKeyChecking=no "public\*" "${SERVER}:${REMOTE_DIR}/public/"
scp -r -i $SSH_KEY -o StrictHostKeyChecking=no "node_modules" "${SERVER}:${REMOTE_DIR}/"
scp -i $SSH_KEY -o StrictHostKeyChecking=no "package.json" "${SERVER}:${REMOTE_DIR}/"

Write-Host "上传完成" -ForegroundColor Green

# 3. Stop old process
Write-Host "[3/5] 停止旧进程..." -ForegroundColor Yellow
ssh-exec "screen -S dld-server -X quit 2>/dev/null; pkill -f 'node dist/main.js' 2>/dev/null; sleep 2; echo stopped"
Write-Host "已停止" -ForegroundColor Green

# 4. Start server
Write-Host "[4/5] 启动斗地主服务器..." -ForegroundColor Yellow
ssh-exec "cd $REMOTE_DIR; screen -dmS dld-server bash -c 'source $REMOTE_DIR/.env; node dist/main.js > dld-server.log 2>&1'; sleep 3; screen -list | grep dld-server && echo 'Server OK' || (echo 'Server FAILED'; tail -20 $REMOTE_DIR/dld-server.log)"
Write-Host "启动完成" -ForegroundColor Green

# 5. Verify
Write-Host "[5/5] 验证服务..." -ForegroundColor Yellow
ssh-exec "curl -s http://localhost:${PORT}/health"
Write-Host ""

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  部署完成" -ForegroundColor Green
Write-Host "  游戏地址: http://154.8.213.134:8088" -ForegroundColor Cyan
Write-Host "  WebSocket: ws://154.8.213.134:8088" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
