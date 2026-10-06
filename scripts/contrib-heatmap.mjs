name: 生成 GitHub 数据卡片

on:
  schedule:
    - cron: '23 1 * * *'        # 每天 09:23（北京时间）
  push:
    branches: [main]
    paths:
      - '.github/workflows/contrib-heatmap.yml'
      - 'scripts/contrib-heatmap.mjs'
      - 'scripts/github-stats.mjs'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: github-cards
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: 生成贡献热力图
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/contrib-heatmap.mjs

      - name: 生成数据卡片
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/github-stats.mjs

      - name: 提交回 main
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add assets/contrib-heatmap.svg assets/contrib-data.json assets/github-stats.svg
          if git diff --cached --quiet; then
            echo "没有变化，跳过提交"
          else
            git commit -m "chore: 更新 GitHub 数据卡片 [skip ci]"
            git push
          fi
