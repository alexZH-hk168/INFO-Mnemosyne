#!/usr/bin/env bash
# 下载示例论文 PDF 到 web/public/samples/（不入 git，见下方许可说明），并校验 sha256。
#
# 来源：Vaswani et al., "Attention Is All You Need", arXiv:1706.03762v7（2023-08-02 版，15 页）
#       https://arxiv.org/abs/1706.03762
# 许可（2026-11-23 在 arXiv 摘要页实际核对）：arXiv.org perpetual, non-exclusive license 1.0
#       http://arxiv.org/licenses/nonexclusive-distrib/1.0/
#       该许可只授权 arXiv 分发，没有授权第三方再分发；论文首页另有 Google 声明，仅允许在注明出处的前提下
#       于新闻或学术作品中复制其中的表格与图。因此本仓库不提交 PDF 本体，开发与测试前用本脚本从 arXiv 取。
#
# 用法：bash web/scripts/fetch-samples.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="$here/../public/samples/attention-is-all-you-need.pdf"
want="bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697"
mkdir -p "$(dirname "$dest")"
if [ -f "$dest" ] && echo "$want  $dest" | sha256sum -c --status; then
  echo "已存在且校验通过：$dest"
  exit 0
fi
curl -fsSL -A "Mozilla/5.0" "https://arxiv.org/pdf/1706.03762v7" -o "$dest.part"
echo "$want  $dest.part" | sha256sum -c --status || { echo "sha256 不符，已删除下载文件" >&2; rm -f "$dest.part"; exit 1; }
mv "$dest.part" "$dest"
echo "已下载并校验：$dest"
