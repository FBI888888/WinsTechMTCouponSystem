#!/bin/bash

# MT Coupon System 快速部署脚本
# 使用方法: bash deploy.sh

set -e

PROJECT_DIR="/www/wwwroot/winscoupons.winstech.top"
SERVICE_NAME="mtcoupon"

echo "=========================================="
echo "  MT Coupon System 部署脚本"
echo "=========================================="

# 检查是否在项目目录
if [ ! -d "$PROJECT_DIR" ]; then
    echo "错误: 项目目录不存在: $PROJECT_DIR"
    exit 1
fi

cd "$PROJECT_DIR"

# 更新后端
echo ""
echo ">>> 1. 更新后端代码..."
if [ -d ".git" ]; then
    git pull
else
    echo "    (非Git项目，跳过代码拉取)"
fi

# 激活虚拟环境
echo ""
echo ">>> 2. 激活虚拟环境..."
source venv/bin/activate

# 更新依赖
echo ""
echo ">>> 3. 更新Python依赖..."
pip install -r requirements.txt -q

# 重启服务
echo ""
echo ">>> 4. 重启后端服务..."
sudo systemctl restart $SERVICE_NAME

# 等待服务启动
sleep 3

# 检查服务状态
echo ""
echo ">>> 5. 检查服务状态..."
sudo systemctl status $SERVICE_NAME --no-pager -l

# 显示最近日志
echo ""
echo ">>> 6. 最近日志:"
sudo journalctl -u $SERVICE_NAME -n 10 --no-pager

echo ""
echo "=========================================="
echo "  部署完成!"
echo "=========================================="
echo ""
echo "访问地址: http://winscoupons.winstech.top"
echo "查看日志: journalctl -u $SERVICE_NAME -f"
echo ""
