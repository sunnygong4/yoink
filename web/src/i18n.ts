// UI text in English (the default) and Chinese. The language follows the device unless picked in the header.

const en = {
  login: 'Log in',
  register: 'Sign up',
  name: 'Name',
  password: 'Password',
  inviteCode: 'Invite code',
  firstUser: 'Nobody has signed up yet: the first account is the admin and needs no invite code.',
  haveInvite: 'Have an invite code? Sign up',
  haveAccount: 'Already have an account? Log in',
  library: 'Library',
  find: 'Find songs',
  invite: 'Invite',
  logout: 'Log out',
  inviteLink: 'Invite link (works once):',
  close: 'Close',
  filterLibrary: 'Filter the library…',
  playAll: '▶ Play all',
  shuffle: '🔀 Shuffle',
  songCount: '{n} songs',
  emptyLibrary: 'The library is empty: add a few songs under “Find songs”.',
  addedBy: 'added by {name}',
  playNext: 'Play next',
  addToQueue: 'Add to queue',
  download: 'Download to this device',
  failed: 'Download failed: {error}',
  retry: 'Retry',
  downloading: 'Downloading {p}%',
  queued: 'Waiting…',
  searchPlaceholder: 'Song or artist',
  search: 'Search',
  searching: 'Searching…',
  play: 'Play',
  quickDownload: 'Quick add',
  quickHint: 'Picks the best source automatically',
  instant: 'Add now',
  instantHint: 'Already on the server (from karaoke): ready in a second',
  findingSource: 'Finding a source…',
  pickSource: 'Choose source',
  bilibili: 'Bilibili',
  findingSources: 'Looking for sources…',
  official: 'official audio',
  sameLength: 'same length',
  openSource: 'Open on the original site',
  useThis: 'Use this',
  notPlaying: 'Nothing playing',
  noLyrics: 'No lyrics for this song yet',
  emptyQueue: 'The queue is empty',
  removeFromQueue: 'Remove from queue',
  lyrics: 'Lyrics',
  queue: 'Queue',
  lyricsShort: 'Lyrics',
  importBtn: '⤒ Import',
  chooseFiles: '+ Choose music files',
  coverField: '🖼 Cover image (optional, for all)',
  importHint: 'Blank fields use the file’s own tags, then its file name.',
  titleField: 'Title',
  artistField: 'Artist',
  albumField: 'Album',
  importN: 'Import {n}',
  uploading: 'uploading {p}%',
  imported: 'added ✓',
  importTitle: 'Import',
  fromFile: 'Upload files',
  fromLink: 'From a link',
  linkPlaceholder: 'YouTube or Bilibili link',
  linkHint: 'Leave the details blank to have the song worked out from the video.',
  add: 'Add',
  adding: 'Adding…',
  addedSong: 'Added: {title}',
  // download errors the server reports by code
  err_age: 'Age-restricted on YouTube (needs a login): try another source',
  err_bot: 'YouTube is blocking the server for now: retry later',
  err_unavailable: 'The video is unavailable: try another source',
  err_bili: 'Bilibili is blocking downloads right now: try a YouTube source',
}

type Dict = typeof en
type Key = keyof Dict

const zh: Dict = {
  login: '登录',
  register: '注册',
  name: '名字',
  password: '密码',
  inviteCode: '邀请码',
  firstUser: '还没有人注册：第一个账号就是管理员，不需要邀请码。',
  haveInvite: '有邀请码？注册',
  haveAccount: '已有账号？登录',
  library: '歌库',
  find: '找歌',
  invite: '邀请',
  logout: '退出',
  inviteLink: '邀请链接（只能用一次）：',
  close: '关闭',
  filterLibrary: '在歌库里找…',
  playAll: '▶ 全部',
  shuffle: '🔀 随机',
  songCount: '{n} 首歌',
  emptyLibrary: '歌库还是空的：去「找歌」加几首吧。',
  addedBy: '{name} 加的',
  playNext: '下一首播放',
  addToQueue: '加入队列',
  download: '下载到本机',
  failed: '下载失败：{error}',
  retry: '重试',
  downloading: '下载中 {p}%',
  queued: '排队中…',
  searchPlaceholder: '歌名 / 歌手',
  search: '搜索',
  searching: '搜索中…',
  play: '播放',
  quickDownload: '快速下载',
  quickHint: '自动挑最合适的来源下载',
  instant: '秒加',
  instantHint: '卡拉OK已经下过，马上就好',
  findingSource: '找来源…',
  pickSource: '单独选取',
  bilibili: 'B站',
  findingSources: '找来源中…',
  official: '官方音源',
  sameLength: '时长一致',
  openSource: '去原网站看看',
  useThis: '用这个',
  notPlaying: '还没有在播放',
  noLyrics: '这首歌还没有歌词',
  emptyQueue: '队列是空的',
  removeFromQueue: '移出队列',
  lyrics: '歌词',
  queue: '播放队列',
  lyricsShort: '词',
  importBtn: '⤒ 导入',
  chooseFiles: '+ 选择音乐文件',
  coverField: '🖼 封面图（可选，所有文件共用）',
  importHint: '没填的会用文件自带的信息，再没有就用文件名。',
  titleField: '歌名',
  artistField: '歌手',
  albumField: '专辑',
  importN: '导入 {n} 首',
  uploading: '上传中 {p}%',
  imported: '已加入 ✓',
  importTitle: '导入',
  fromFile: '上传文件',
  fromLink: '用链接',
  linkPlaceholder: 'YouTube 或 B站链接',
  linkHint: '信息不填的话，会根据视频自动识别。',
  add: '添加',
  adding: '添加中…',
  addedSong: '已添加：{title}',
  err_age: '年龄限制：YouTube 要求登录，换一个来源吧',
  err_bot: 'YouTube 暂时拦截了服务器，稍后重试',
  err_unavailable: '视频不可用，换一个来源吧',
  err_bili: 'B站暂时不让下载，换个 YouTube 来源吧',
}

export type Lang = 'en' | 'zh'
const SAVED = 'yoinker.lang'

function detect(): Lang {
  try {
    const saved = localStorage.getItem(SAVED)
    if (saved === 'en' || saved === 'zh') return saved
  } catch { /* private mode */ }
  return navigator.languages.some(l => l.toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

let lang: Lang = detect()
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'

export const getLang = () => lang

/** Switch language (remembered on this device). The caller re-renders the app. */
export function setLang(l: Lang) {
  lang = l
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
  try { localStorage.setItem(SAVED, l) } catch { /* private mode */ }
}

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return (lang === 'zh' ? zh : en)[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}

/** A download error from the server: a known code is translated, anything else is shown as it came. */
export function errorText(code: string | null, raw: string | null): string {
  const key = `err_${code}` as Key
  return code && key in en ? t(key) : raw || ''
}
