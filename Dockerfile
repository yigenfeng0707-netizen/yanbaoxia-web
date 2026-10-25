FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-fund --no-audit

COPY . .
# 引擎脚本入镜像（魔搭持久目录优先由 config.js 在运行时选择）
COPY engine/collect_stock.py /opt/workbench/scripts/collect_stock.py
COPY engine/watchlist.json /opt/workbench/config/watchlist.json
COPY engine/prebuilt/ /opt/workbench/output/

ENV PORT=7860 \
    NODE_ENV=production \
    ENGINE_WORKBENCH=/opt/workbench

EXPOSE 7860
CMD ["node", "server.js"]
