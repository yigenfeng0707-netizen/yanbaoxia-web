FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-fund --no-audit

COPY . .
# 引擎脚本入镜像（魔搭持久目录优先由 config.js 在运行时选择）
COPY engine/collect_stock.py /opt/workbench/scripts/collect_stock.py
COPY engine/deep_report.py /opt/workbench/scripts/deep_report.py
COPY engine/watchlist.json /opt/workbench/config/watchlist.json
COPY engine/prebuilt/ /opt/workbench/output/

ENV PORT=7860 \
    NODE_ENV=production \
    ENGINE_WORKBENCH=/opt/workbench \
    COLLECT_SNAPSHOT_DIR=/mnt/workspace/yanbaoxia-workbench-data/snapshots

EXPOSE 7860
RUN mkdir -p /mnt/workspace/yanbaoxia-workbench-data/snapshots || true
CMD ["node", "server.js"]
