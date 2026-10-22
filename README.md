# Yoinker

私人共享歌库：搜歌 → 服务器下载音频 → 大家在网页里听。邀请制，歌库所有人共用、不公开。
和 K 歌站（karaoke.sunnygong.com）共用同一个歌库：K 歌站下过的歌这里直接能听，这里有的歌拿去唱不用再下载。

老的 yoinker（桌面版、Postgres 后端、client-web）都在 `legacy/`，不再维护。

## 结构
```
songstore/   共享歌库（Python 包，K 歌站也装它）：songs.db 目录 + library/<歌曲id>/ 文件夹
             keys.py（同一首歌的识别）、identify.py（从网易云 / LRCLIB 找真名和歌词）
server/      FastAPI：app.py（接口）、library.py（下载 / 收编 K 歌站的歌）、auth.py（邀请制账号）、search.py
web/         React + Vite + TypeScript 网页
```

### 共享歌库怎么分工
- 每首歌一条记录（JSON），字段两边都能读；Yoinker 自己的字段都带 `music_` 前缀，`status/stage/progress` 归 K 歌站。
- 文件：Yoinker 用 `audio.m4a`（AAC，iPhone 也能放）；K 歌站用 `video.mp4`、伴奏、人声；`lyrics.json` 两边共用。
- K 歌站下好的歌：Yoinker 每 5 分钟扫一次，用 ffmpeg 从视频里抽音频（直接拷贝音轨，一秒钟）。
- Yoinker 有音频的歌被点唱：K 歌站直接拿音频去人声，不下载（没有 MV）。
- 应用会 "hold" 自己要用的歌；K 歌站清理 30 天没人唱的歌时，Yoinker 在用的只删视频和伴奏。

## 本地运行
```bash
python -m venv server/.venv
server/.venv/Scripts/pip install -r server/requirements.txt     # Linux: server/.venv/bin/pip
cd web && npm install && npm run build && cd ..
cd server && SONGSTORE_ROOT=<歌库目录> .venv/Scripts/python -m uvicorn app:app --port 8100
```
打开 http://127.0.0.1:8100 。第一个注册的人是管理员，不需要邀请码；之后在页面右上角"邀请"生成一次性邀请链接。
改前端时可以 `cd web && npm run dev`（5174 端口，`/api` 代理到 8100）。

需要 ffmpeg / ffprobe 在 PATH 里。

## 线上（sunnyserver3）
https://music.sunnygong.com → K 歌站的 Cloudflare 隧道（`~/karaoke/tunnel.yml` 里的第二条 ingress）→ 127.0.0.1:8100

| 路径 | 作用 |
|---|---|
| `~/yoink/` | 代码：`songstore/`、`server/`（venv 在 `server/.venv`，Python 3.11，uv 装的）、`web/dist/` |
| `~/songstore/` | 共享歌库：`songs.db` + `library/`（原来的 `~/karaoke/library` 搬过来的）。K 歌站也用它 |
| `~/yoinker-data/` | 账号、邀请码、登录状态（`yoinker.db`） |
| `~/yoink/logs/` | `server.log`、`supervisor.log` |

- `server/supervise.sh`：cron 每分钟 + 开机各跑一次，挂了就拉起来（crontab 里带 `# yoinker-supervisor` 标记）。
- K 歌站的 `supervise.sh` 里设了 `SONGSTORE_ROOT=~/songstore`，它的 venv 里装了 `~/yoink/songstore`（可编辑安装，部署 Yoinker 时一起更新）。
- 第一次迁移前的备份：`~/karaoke-backup-20261021-2042/`（旧 meta.json、rooms、旧后端代码）。

### 改了代码之后
```bash
./deploy.sh --build     # 构建网页、上传 songstore/server/web，装依赖，重启（只改后端可以不加 --build）
```
songstore 改了的话，K 歌站也要重启才会用上：`ssh sunnyserver3 '~/karaoke/supervise.sh restart'`。

### 常用命令
```bash
ssh sunnyserver3 'tail -f ~/yoink/logs/server.log'                     # 看日志
ssh sunnyserver3 '~/yoink/server/.venv/bin/python -m songstore ~/songstore | head'   # 看歌库
```

以后 `yoinker.sunnygong.com` 可以做成 exe / iOS app 用的 API（同一个 server，加 token 登录就行）。
