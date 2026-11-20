/**
 * 网页面板：直接沿用 dsh-connect-workbuddy 卡片自己的 DOM 结构与样式系统。
 *
 * 上一版只搬了样式表、结构仍是我自己排的，结果与原版差得远（原版是一个折叠
 * 卡片 + 双区域供应商格 + 账号/模型/能力/诊断四个标签页 + 逐模型三行式布局）。
 * 本文件按 dsh-connect-workbuddy 的 `src/client/WorkBuddyCard.tsx` 结构逐块对齐：
 *
 *   .dsm-plugin-card                折叠卡片外壳（标题 + 描述 + chevron）
 *   .dsm-workbuddy-tabs             国内版 / 国际版两个供应商格（状态点 + 开关）
 *   .dsm-workbuddy-panels           账号 / 模型 / 能力 / 诊断
 *   .dsm-workbuddy-model            模型三行：名称倍率徽章 / 开关与窗口 / 事实与动作
 *
 * 为什么不直接跑那边的 React 组件：它依赖六个 DSH 宿主包与 21 处槽位注册，
 * 脱离宿主无法实例化。跨宿主移植的通行做法就是保留样式系统与类名、用同构
 * DOM 重建；`card.css`（从 styles.ts 逐字导出）负责外观，本文件负责结构。
 */

import { CARD_CSS } from './card-css.ts'

export function renderPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>接入使用 WorkBuddy 积分与模型</title>
<style>
${CARD_CSS}
/* 宿主外壳：原版卡片跑在 DSH 的浅色页面里，这里补上它本该提供的底色、容器
   宽度与主题变量。变量值取的是 DSH 浅色主题的取值，卡片自身的深色回退不再
   生效——不补这一段，整页会变成深色，与截图对不上。 */
:root{
  --dsw-alias-label-primary:#1f2329;--dsw-alias-label-secondary:#4e5969;
  --dsw-alias-label-tertiary:#6b7280;--dsw-alias-label-dimmed:#9aa0a8;
  --dsw-alias-border-l1:#eceef1;--dsw-alias-border-l2:#e3e6ea;
  --dsw-alias-bg-base:#ffffff;--dsw-alias-bg-l1:#ffffff;--dsw-alias-bg-layer-1:#ffffff;
  --dsw-alias-bg-layer-2:#ffffff;--dsw-alias-bg-layer-3:#ffffff;
  --dsw-alias-bg-secondary:#f7f8fa;--dsw-alias-brand-primary:#111827;
  --dsw-alias-interactive-bg-hover:#f2f3f5;--dsw-alias-bg-mask-1:rgba(0,0,0,.04);
  --dsw-alias-state-success-primary:#00a870;--dsw-alias-state-warn-primary:#d97706;
  --dsw-alias-state-error-primary:#e34d59;--dsw-alias-label-success:#00a870;
  --dsw-alias-label-warning:#d97706;--dsw-alias-label-error:#e34d59;
  --dsw-alias-label-caution:#b45309;--dsw-alias-label-caution-background:#fef3c7;
}
body{margin:0;background:#ffffff;color:var(--dsw-alias-label-primary);
  font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
.wbx-shell{max-width:1180px;margin:0 auto;padding:24px clamp(16px,3vw,40px) 56px}
.wbx-list{list-style:none;margin:0;padding:0}
/* 折叠卡片外壳里的图标：原版用插件自己的 logo，这里画同一个「饼图 + 缺口」。 */
.dsm-plugin-card-icon{width:32px;height:32px;border-radius:8px;background:#0b5cff;
  display:flex;align-items:center;justify-content:center;flex:none}
.dsm-plugin-card-head{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.dsm-plugin-card-description{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.dsm-plugin-card-chevron{margin-left:auto;flex:none;color:var(--dsw-alias-label-dimmed)}
/* 窗口档位：原版这一处是三个 radio，样式表里只有 select 的规则，补一小段。 */
.wbx-budget{display:inline-flex;align-items:center;gap:10px;font-size:12px;
  color:var(--dsw-alias-label-secondary);white-space:nowrap}
.wbx-budget label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.wbx-budget input{margin:0;accent-color:var(--dsw-alias-brand-primary)}
.wbx-budget label.is-off{opacity:.45;cursor:default}
.wbx-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.wbx-mono{font-family:ui-monospace,Consolas,monospace;font-size:12px}
.wbx-err{padding:10px 12px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:13px}
.wbx-note{padding:10px 12px;border-radius:8px;background:#fffbeb;color:#92400e;font-size:13px;line-height:1.6}
.wbx-login-link{word-break:break-all;color:#0b5cff}
.dsm-workbuddy-model-probe-result{margin:2px 0 0;font-size:12px}
/* 端口顺延提示：卡片本体复用原版的 device-dialog，这里只补一层遮罩与文字排版。 */
.wbx-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(9,10,14,.55)}
.wbx-modal[hidden]{display:none}
.wbx-modal h3{margin:0 0 10px;font-size:16px}
.wbx-modal p{margin:0 0 10px;font-size:13px;line-height:1.75;color:var(--dsw-alias-label-secondary)}
.wbx-modal-addr{display:block;margin:2px 0 12px;padding:9px 11px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);
  font-family:ui-monospace,Consolas,monospace;font-size:12.5px;word-break:break-all;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.10))}
</style>
</head>
<body>
<div class="wbx-shell">
<ul class="wbx-list">
  <li class="dsm-plugin-card dsm-plugin-card-open">
    <div class="dsm-plugin-card-header" style="cursor:default">
      <span class="dsm-plugin-card-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 3a9 9 0 1 0 9 9h-9V3Z" fill="#ffffff"/>
          <path d="M14 3.6A9 9 0 0 1 20.4 10H14V3.6Z" fill="#ffffff" opacity=".55"/>
        </svg>
      </span>
      <span class="dsm-plugin-card-head">
        <span class="dsm-plugin-card-title">接入使用 WorkBuddy 积分与模型（dsh-connect-workbuddy）</span>
        <span class="dsm-plugin-card-description">在 Codex 中使用 WorkBuddy 模型：每次刷新都按上游目录读取每个模型的积分倍率，图片输入可逐模型开关，多个账号可切换或由账号池自动换号，每日签到与剩余积分一键可查。国内版与国际版是两个独立供应商，各有自己的账号，可同时使用。</span>
      </span>
      <span style="display:flex;align-items:center;gap:6px;flex:0 0 auto">
        <button type="button" class="dsm-btn dsm-btn-outline" id="stop-proxy" title="关闭代理及其派生的全部辅助进程；不会动 Codex 与 Codex++">关闭</button>
      </span>
      <span class="dsm-plugin-card-chevron dsm-plugin-card-chevron-open" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </div>
    <div class="dsm-plugin-card-body">
      <div class="dsm-workbuddy-usage">
        <div class="dsm-workbuddy-tabs" id="region-tabs" role="tablist" aria-label="区域"></div>
        <p class="dsm-workbuddy-models-summary" id="account-summary">—</p>
        <p class="dsm-workbuddy-models-summary dsm-workbuddy-tab-hint">每个 tab 是一个独立供应商（国内版 / 国际版），各有自己的账号、积分与模型。取消勾选即关闭该供应商：它的模型不再出现在 Codex 的模型选择器里，账号与设置都会保留。</p>
        <div id="region-notice"></div>
        <div class="dsm-workbuddy-panels" id="panels" role="tablist" aria-label="面板"></div>

        <div class="dsm-workbuddy-panel" id="panel-accounts">
          <div class="dsm-workbuddy-usage-select-wrap">
            <select class="dsm-workbuddy-usage-select" id="account-select" aria-label="账号"></select>
          </div>
          <div class="dsm-workbuddy-usage-account-actions">
            <button type="button" class="dsm-btn dsm-btn-outline" data-add="cn">添加账号（国内版）</button>
            <button type="button" class="dsm-btn dsm-btn-outline" data-add="global">添加账号（国际版）</button>
            <button type="button" class="dsm-btn dsm-btn-outline" id="remove-account">移除当前</button>
          </div>
          <p class="dsm-workbuddy-models-summary dsm-workbuddy-tab-hint" id="account-policy">自动换号：当前账号剩余积分 ≤ 20 时切到余额最高的账号；所有账号都低于 50 时停止发送请求（HTTP 402 insufficient_quota）。</p>
          <div id="login"></div>
          <div class="dsm-workbuddy-model-list" id="checkin-card"></div>
          <div class="dsm-workbuddy-bar">
            <span class="dsm-workbuddy-bar-status" id="bar-status">—</span>
            <span class="dsm-workbuddy-bar-hint" id="bar-hint"></span>
            <span class="dsm-workbuddy-bar-actions"></span>
          </div>
          <div class="dsm-workbuddy-model-list" id="account-cards"></div>
        </div>

        <div class="dsm-workbuddy-panel" id="panel-models" style="display:none">
          <section class="dsm-workbuddy-models" aria-label="模型">
            <div class="dsm-workbuddy-models-fold">
              <div class="dsm-workbuddy-models-head">
                <div>
                  <div class="dsm-workbuddy-models-title-row">
                    <h3 class="dsm-workbuddy-models-title">模型</h3>
                  </div>
                  <p class="dsm-workbuddy-models-summary" id="models-count">已启用 0 个</p>
                </div>
                <div class="dsm-workbuddy-models-head-actions">
                  <button type="button" class="dsm-btn dsm-btn-outline" id="refresh-models">从 WorkBuddy 刷新</button>
                  <button type="button" class="dsm-btn dsm-btn-outline" id="sweep-enabled">一键测试启用模型</button>
                  <button type="button" class="dsm-btn dsm-btn-outline" id="sweep-all">一键测试所有模型</button>
                  <button type="button" class="dsm-btn dsm-btn-outline" id="sweep-tps">一键测速启用模型</button>
                </div>
              </div>
              <p class="dsm-workbuddy-models-sweep-summary" id="sweep-summary" style="display:none"></p>
              <div class="dsm-workbuddy-model-list" id="models"></div>
            </div>
          </section>
        </div>

        <div class="dsm-workbuddy-panel" id="panel-logs" style="display:none">
          <section class="dsm-workbuddy-models">
            <div class="dsm-workbuddy-models-fold">
              <div class="dsm-workbuddy-models-head">
                <div>
                  <div class="dsm-workbuddy-models-title-row"><h3 class="dsm-workbuddy-models-title">请求日志</h3></div>
                  <p class="dsm-workbuddy-models-summary" id="log-stats">—</p>
                </div>
                <div class="dsm-workbuddy-models-head-actions">
                  <button type="button" class="dsm-btn dsm-btn-outline" data-log-failed="0" id="log-failed">只看失败</button>
                  <button type="button" class="dsm-btn dsm-btn-outline" id="reload-logs">刷新</button>
                  <button type="button" class="dsm-btn dsm-btn-outline" id="clear-logs">清空</button>
                </div>
              </div>
              <div class="wbx-row" style="margin:0 0 10px">
                <select class="dsm-workbuddy-usage-select" id="log-model" style="max-width:260px">
                  <option value="">全部模型</option>
                </select>
                <input id="log-q" placeholder="搜索模型 / 路径 / 错误 / 账号"
                  style="flex:1;min-width:200px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);
                  border-radius:8px;background:transparent;color:inherit;font:inherit">
              </div>
              <div class="dsm-workbuddy-model-list" id="logs"></div>
            </div>
          </section>
        </div>

        <div class="dsm-workbuddy-panel" id="panel-setup" style="display:none">
          <section class="dsm-workbuddy-models">
            <div class="dsm-workbuddy-models-fold">
              <div class="dsm-workbuddy-models-head">
                <div>
                  <div class="dsm-workbuddy-models-title-row"><h3 class="dsm-workbuddy-models-title">接入 Codex++</h3></div>
                  <p class="dsm-workbuddy-models-summary" id="setup-hint">Codex++ 面板 → 供应商 → 添加 → 自定义（纯 API），按下表逐项填写。每行右侧可单独复制。</p>
                </div>
                <div class="dsm-workbuddy-models-head-actions">
                  <button type="button" class="dsm-btn dsm-btn-outline" id="copy-setup-all">复制全部参数</button>
                  <button type="button" class="dsm-btn dsm-btn-outline" id="reload-setup">刷新</button>
                </div>
              </div>
              <div id="setup-warn"></div>
              <div class="dsm-workbuddy-model-list" id="setup-fields"></div>
              <p class="dsm-workbuddy-models-summary" style="margin:16px 0 6px">模型列表（粘到 Codex++ 的「模型列表」，或直接点上方「从上游获取」）</p>
              <div class="dsm-workbuddy-model-list" id="setup-models"></div>
              <p class="dsm-workbuddy-models-summary" style="margin:16px 0 6px">连通性检查</p>
              <div class="dsm-workbuddy-model-list" id="setup-endpoints"></div>
              <p class="dsm-workbuddy-models-summary" style="margin:16px 0 6px">没有 Codex++ 时的退路：改用 Codex 原生 provider（写 ~/.codex/config.toml）</p>
              <div class="dsm-workbuddy-model-list" id="setup-native"></div>
            </div>
          </section>
        </div>

        <div class="dsm-workbuddy-panel" id="panel-capabilities" style="display:none">
          <section class="dsm-workbuddy-models">
            <div class="dsm-workbuddy-models-fold">
              <div class="dsm-workbuddy-models-head">
                <div>
                  <div class="dsm-workbuddy-models-title-row"><h3 class="dsm-workbuddy-models-title">图片与视频模型</h3></div>
                  <p class="dsm-workbuddy-models-summary">上游目录里登记的媒体模型；与对话模型分开计量</p>
                </div>
                <div class="dsm-workbuddy-models-head-actions">
                  <button type="button" class="dsm-btn dsm-btn-outline" id="reload-media">重新读取</button>
                </div>
              </div>
              <div class="dsm-workbuddy-model-list" id="media"></div>
            </div>
          </section>
          <section class="dsm-workbuddy-models" style="margin-top:18px">
            <div class="dsm-workbuddy-models-fold">
              <div class="dsm-workbuddy-models-head">
                <div>
                  <div class="dsm-workbuddy-models-title-row"><h3 class="dsm-workbuddy-models-title">福利与活动</h3></div>
                  <p class="dsm-workbuddy-models-summary">礼包与补偿；领取会写入上游账号</p>
                </div>
                <div class="dsm-workbuddy-models-head-actions">
                  <button type="button" class="dsm-btn dsm-btn-outline" id="reload-benefits">重新读取</button>
                </div>
              </div>
              <div class="dsm-workbuddy-model-list" id="benefits"></div>
            </div>
          </section>
        </div>

        <div class="dsm-workbuddy-panel" id="panel-diag" style="display:none">
          <section class="dsm-workbuddy-models">
            <div class="dsm-workbuddy-models-fold">
              <div class="dsm-workbuddy-models-head">
                <div>
                  <div class="dsm-workbuddy-models-title-row"><h3 class="dsm-workbuddy-models-title">设备身份</h3></div>
                  <p class="dsm-workbuddy-models-summary">出站请求声称的设备档；真实档需要桌面端 SDK 可用</p>
                </div>
                <div class="dsm-workbuddy-models-head-actions">
                  <button type="button" class="dsm-btn dsm-btn-outline" data-devmode="virtual">虚拟档</button>
                  <button type="button" class="dsm-btn dsm-btn-outline" data-devmode="real">真实档</button>
                </div>
              </div>
              <div class="dsm-workbuddy-model-list" id="device"></div>
            </div>
          </section>
          <section class="dsm-workbuddy-models" style="margin-top:18px">
            <div class="dsm-workbuddy-models-fold">
              <div class="dsm-workbuddy-models-head">
                <div>
                  <div class="dsm-workbuddy-models-title-row"><h3 class="dsm-workbuddy-models-title">最近请求</h3></div>
                  <p class="dsm-workbuddy-models-summary" id="counters">—</p>
                </div>
                <div class="dsm-workbuddy-models-head-actions">
                  <button type="button" class="dsm-btn dsm-btn-outline" id="reload-all">刷新</button>
                </div>
              </div>
              <div class="dsm-workbuddy-model-list" id="reqs"></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </li>
</ul>
</div>
<div class="wbx-modal" id="port-modal" hidden>
  <div class="dsm-workbuddy-device-dialog" role="dialog" aria-modal="true" aria-labelledby="port-modal-title">
    <h3 id="port-modal-title">代理端口已顺延</h3>
    <p id="port-modal-lead"></p>
    <p>Codex++ 里若已保存过指向旧端口的供应商，请把它的上游地址改成：</p>
    <span class="wbx-modal-addr" id="port-modal-addr"></span>
    <p id="port-modal-tail"></p>
    <div class="dsm-workbuddy-device-dialog-actions">
      <button type="button" class="dsm-btn dsm-btn-outline" id="port-modal-copy">复制新地址</button>
      <button type="button" class="dsm-btn" id="port-modal-ok">我知道了</button>
    </div>
  </div>
</div>

<script>
var $ = function (id) { return document.getElementById(id); };
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}
function fmtCap(n) {
  if (!n) return '—';
  if (n >= 1000000) return Math.round(n / 1000000) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}
function api(path, body) {
  var opt = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  };
  return fetch(path, opt).then(function (r) { return r.json(); });
}
var S = { data: null, accounts: [], current: null, region: 'cn', panel: 'models', selected: true, minUsable: 50, switchFloor: 20,
  probing: {}, tps: {}, sweeping: false, results: {}, logs: [], logFailed: false, logModel: '', logQ: '' };

var PANELS = [['accounts', '账号'], ['models', '模型'], ['setup', '接入'], ['capabilities', '能力'], ['logs', '日志'], ['diag', '诊断']];

function renderRegions() {
  var signedIn = {};
  S.accounts.forEach(function (a) {
    if (!a.expired) signedIn[a.region === 'global' ? 'global' : 'cn'] = true;
  });
  var on = (S.data && S.data.settings && S.data.settings.regionOn) || { cn: true, global: true };
  $('region-tabs').innerHTML = ['cn', 'global'].map(function (r) {
    var label = r === 'cn' ? '国内版' : '国际版';
    var active = S.region === r;
    var dot = signedIn[r] ? '#00a870' : '#c9cdd4';
    return '<div class="dsm-workbuddy-tab-cell">'
      + '<button type="button" role="tab" aria-selected="' + active + '" data-region="' + r + '"'
      + ' class="dsm-workbuddy-tab' + (active ? ' dsm-workbuddy-tab-active' : '') + (on[r] === false ? ' dsm-workbuddy-tab-off' : '') + '">'
      + '<span aria-hidden="true" class="dsm-workbuddy-tab-dot" style="background:' + dot + '"></span>'
      + esc(label) + '</button>'
      + '<label class="dsm-workbuddy-tab-switch" title="取消勾选即关闭该供应商：它的模型不再出现在 Codex 里">'
      + '<input type="checkbox" data-region-switch="' + r + '"' + (on[r] === false ? '' : ' checked') + ' aria-label="启用' + esc(label) + '">'
      + '</label></div>';
  }).join('');
}

function renderPanels() {
  $('panels').innerHTML = PANELS.map(function (p) {
    var active = S.panel === p[0];
    return '<button type="button" role="tab" aria-selected="' + active + '" data-panel="' + p[0] + '"'
      + ' class="dsm-workbuddy-panel-tab' + (active ? ' dsm-workbuddy-panel-tab-active' : '') + '">' + esc(p[1]) + '</button>';
  }).join('');
  ['accounts', 'models', 'setup', 'capabilities', 'logs', 'diag'].forEach(function (k) {
    $('panel-' + k).style.display = S.panel === k ? '' : 'none';
  });
}

function budgetRadios(m) {
  var tiers = [];
  if (m.nativeContextWindow > 200000) tiers.push(200000);
  if (m.nativeContextWindow > 500000) tiers.push(500000);
  tiers.push(m.nativeContextWindow);
  var cur = m.budget || m.nativeContextWindow;
  var name = 'bd-' + String(m.id).replace(/[^a-zA-Z0-9]/g, '_');
  var single = tiers.length === 1;
  return '<span class="wbx-budget">' + tiers.map(function (t) {
    return '<label' + (single ? ' class="is-off"' : '') + '><input type="radio" name="' + name + '"'
      + ' data-budget="' + esc(m.id) + '" value="' + t + '"' + (t === cur ? ' checked' : '')
      + (single ? ' disabled' : '') + '>' + fmtCap(t) + '</label>';
  }).join('') + '</span>';
}

function effortControl(m) {
  var efforts = m.efforts || [];
  if (!efforts.length) return '';
  var follow = m.defaultEffort ? ('跟随默认(' + m.defaultEffort + ')') : '跟随默认';
  return '<label class="dsm-workbuddy-model-effort" title="这个模型在会话未指定推理强度时使用的档位">'
    + '<span>推理强度</span><select class="dsm-workbuddy-model-effort-select" data-effort="' + esc(m.id) + '">'
    + '<option value="">' + esc(follow) + '</option>'
    + efforts.map(function (e) {
      return '<option value="' + esc(e) + '"' + (m.effort === e ? ' selected' : '') + '>' + esc(e) + '</option>';
    }).join('')
    + '</select></label>';
}

function modelRow(m) {
  var rate = m.rate == null ? '' : '<span class="dsm-workbuddy-model-name-rate">x' + Number(m.rate).toFixed(2) + '</span>';
  var badge = m.badge
    ? '<span class="dsm-workbuddy-model-promo"' + (m.badge.color ? ' style="color:' + esc(m.badge.color) + '"' : '') + '>'
      + esc(m.badge.label) + '</span>'
    : '';
  var offFlag = m.offBlocked ? '<span class="dsm-workbuddy-model-off-flag">拒绝:off</span>' : '';
  var res = S.results[m.id];
  var resHtml = '';
  if (res) {
    resHtml = '<p class="dsm-workbuddy-model-probe-result dsm-workbuddy-model-probe-result-' + res.tone + '">' + esc(res.text) + '</p>';
  }
  return '<div class="dsm-workbuddy-model' + (m.enabled ? '' : ' dsm-workbuddy-model-disabled') + '">'
    + '<div class="dsm-workbuddy-model-head">'
    + '<label class="dsm-workbuddy-model-enabled"><input type="checkbox" data-enabled="' + esc(m.id) + '"'
    + (m.enabled ? ' checked' : '') + '><span class="dsm-workbuddy-model-copy">'
    + '<span class="dsm-workbuddy-model-name">' + esc(m.name) + rate + '</span></span></label>'
    + badge
    + '<div class="dsm-workbuddy-model-controls">'
    + '<label class="dsm-workbuddy-model-image" title="允许这个模型接收图片输入"><input type="checkbox" data-image="' + esc(m.id) + '"'
    + (m.imageOn ? ' checked' : '') + '><span>图片</span></label>'
    + '<label class="dsm-workbuddy-model-off' + (m.offBlocked ? ' dsm-workbuddy-model-off-blocked' : '') + '" title="允许这个模型关闭思考">'
    + '<input type="checkbox" data-off="' + esc(m.id) + '"' + (m.offOn ? ' checked' : '') + (m.offBlocked ? ' disabled' : '') + '>'
    + '<span>可关闭思考</span>' + offFlag + '</label>'
    + budgetRadios(m)
    + '<button type="button" class="dsm-btn dsm-btn-outline dsm-workbuddy-model-probe" data-probe="' + esc(m.id) + '"'
    + (S.probing[m.id] ? ' disabled' : '') + '>' + (S.probing[m.id] ? '测试中…' : '测试') + '</button>'
    + '<button type="button" class="dsm-btn dsm-btn-outline dsm-workbuddy-model-probe" data-tps="' + esc(m.id) + '"'
    + (S.tps[m.id] ? ' disabled' : '') + '>' + (S.tps[m.id] ? '测速中…' : '测速') + '</button>'
    + '</div></div>'
    + '<div class="dsm-workbuddy-model-details"><div class="dsm-workbuddy-model-meta">'
    + '<span>最大上下文 ' + fmtCap(m.nativeContextWindow) + '</span>'
    + '<span>最大输出 ' + fmtCap(m.maxTokens) + '</span>'
    + effortControl(m)
    + '</div></div>'
    + resHtml
    + '</div>';
}

function renderModels() {
  var models = (S.data && S.data.models) || [];
  var enabled = models.filter(function (m) { return m.enabled; }).length;
  $('models-count').textContent = '已启用 ' + enabled + ' 个';
  $('models').innerHTML = models.map(modelRow).join('')
    || '<div class="dsm-workbuddy-model-disabled">没有读到模型：先在上方「账号」里确认已登录，再点「从 WorkBuddy 刷新」</div>';
}

function accountRows() {
  if (!S.accounts.length) {
    return '<div class="dsm-workbuddy-model-disabled">本机没有读到 WorkBuddy 登录态：先在桌面端登录一次，或点上方「添加账号」</div>';
  }
  return S.accounts.map(function (a) {
    var isCurrent = a.id === S.current;
    var bits = [a.region === 'global' ? '国际版' : '国内版', a.expired ? '已过期' : '可用'];
    if (typeof a.total === 'number') bits.push('剩余积分 ' + a.total.toFixed(2));
    else bits.push(a.balanceError ? '余额读取失败' : '余额未知');
    // 令牌到期时间逐账号显示：它决定「这个号还能用多久」，与余额是两个独立的
    // 失效条件——余额够但令牌过期，一样发不出请求。
    if (a.expiresAt) {
      bits.push('令牌至 ' + new Date(a.expiresAt).toLocaleDateString('zh-CN'));
    }
    var flags = '';
    if (isCurrent) flags += '<span class="dsm-workbuddy-model-meta-tag">当前</span>';
    if (typeof a.total === 'number' && a.total < S.minUsable) {
      flags += '<span class="dsm-workbuddy-model-off-flag">低于 ' + S.minUsable + '</span>';
    }
    return '<div class="dsm-workbuddy-model' + (isCurrent ? '' : ' dsm-workbuddy-model-disabled') + '">'
      + '<div class="dsm-workbuddy-model-head"><span class="dsm-workbuddy-model-copy">'
      + '<span class="dsm-workbuddy-model-name">' + esc(a.name || a.id) + flags + '</span></span>'
      + '<div class="dsm-workbuddy-model-controls">'
      + (isCurrent ? '' : '<button type="button" class="dsm-btn dsm-btn-outline"'
          + (a.expired ? ' disabled' : ' data-select-account="' + esc(a.id) + '"') + '>切换</button>')
      + '<span class="dsm-workbuddy-models-summary">' + esc(bits.join(' · ')) + '</span>'
      + '</div></div></div>';
  }).join('');
}

function render() {
  var d = S.data || {};
  var notices = [];
  if (d.ok === false) {
    notices.push('<div class="wbx-err">' + esc(d.reason || '未读到登录态') + '</div>');
  } else if (!S.selected) {
    notices.push('<div class="wbx-note">这一侧（' + (S.region === 'cn' ? '国内版' : '国际版')
      + '）还没有账号：面板上的开关会写到这一侧，但实际转发的模型来自当前已登录的那一侧。点「添加账号」登录一次即可。</div>');
  }
  var known = S.accounts.filter(function (a) { return typeof a.total === 'number'; });
  if (S.accounts.length > 0 && known.length === S.accounts.length
      && known.every(function (a) { return a.total < S.minUsable; })) {
    notices.push('<div class="wbx-err">无额度：所有账号剩余积分均低于 ' + S.minUsable
      + '，代理已停止发送请求，返回 402 insufficient_quota。充值或添加新账号后自动恢复。</div>');
  }
  $('region-notice').innerHTML = notices.join('');
  $('account-select').innerHTML = S.accounts.length
    ? S.accounts.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (a.id === S.current ? ' selected' : '') + '>'
          + esc((a.name || a.id) + ' · ' + (a.region === 'global' ? '国际版' : '国内版') + (a.expired ? ' · 已过期' : ''))
          + '</option>';
      }).join('')
    : '<option>没有可用账号</option>';
  $('account-cards').innerHTML = accountRows();
  renderModels();

  var c = d.checkin;
  // 常驻摘要：令牌到期时间不该只在「账号」页看得到——它在模型页同样决定
  // 「现在还能不能用」，所以放在区域格下面，任何标签页都看得见。
  var summary = $('account-summary');
  if (summary) {
    if (d.ok && d.account) {
      var parts = [d.account.name || d.account.uid, d.account.region === 'global' ? '国际版' : '国内版'];
      if (d.credits) parts.push('剩余积分 ' + Number(d.credits.total).toFixed(2));
      if (d.account.expiresAt) {
        var exp = new Date(d.account.expiresAt);
        var days = Math.ceil((exp.getTime() - Date.now()) / 86400000);
        parts.push('令牌至 ' + exp.toLocaleString('zh-CN', { hour12: false })
          + (days >= 0 ? '（剩 ' + days + ' 天）' : '（已过期）'));
      }
      summary.textContent = parts.join(' · ');
    } else {
      summary.textContent = '未登录：先在 WorkBuddy 桌面端登录，或点「账号」页的添加账号';
    }
  }

  var bar = $('bar-status');
  if (d.ok) {
    bar.textContent = '已登录 · ' + (d.account && d.account.region === 'global' ? '国际版' : '国内版')
      + (d.account && d.account.name ? ' · ' + d.account.name : '');
    bar.className = 'dsm-workbuddy-bar-status dsm-workbuddy-bar-ok';
    $('bar-hint').textContent = (d.credits ? ('剩余积分 ' + Number(d.credits.total).toFixed(2)) : '')
      + (d.source ? ' · 目录来源 ' + d.source : '');
  } else {
    bar.textContent = '未登录';
    bar.className = 'dsm-workbuddy-bar-status dsm-workbuddy-bar-error';
    $('bar-hint').textContent = '先在 WorkBuddy 桌面端登录，或点上方「添加账号」';
  }
  renderCheckin(c);
  var checkinBtn = document.querySelector('[data-checkin]');
  if (checkinBtn) {
    if (c && c.active) {
      checkinBtn.disabled = c.todayCheckedIn;
      checkinBtn.textContent = c.todayCheckedIn ? '今天已签到' : (c.claimButtonText || '签到');
    } else {
      checkinBtn.disabled = true;
      checkinBtn.textContent = '无签到活动';
    }
  }

  var cnt = d.counters || { total: 0, failures: 0 };
  $('counters').textContent = '共 ' + cnt.total + ' 次请求 · 失败 ' + cnt.failures + ' 次 · 每 5 秒刷新';
  $('reqs').innerHTML = (d.requests || []).map(function (r) {
    var ok = r.status >= 200 && r.status < 300;
    return '<div class="dsm-workbuddy-model">'
      + '<div class="dsm-workbuddy-model-head"><span class="dsm-workbuddy-model-copy"><span class="dsm-workbuddy-model-name">'
      + esc(r.model || '—') + '<span class="dsm-workbuddy-model-name-rate">' + r.status + '</span></span></span>'
      + '<div class="dsm-workbuddy-model-controls"><span class="dsm-workbuddy-models-summary">'
      + new Date(r.at).toLocaleTimeString('zh-CN') + ' · ' + (r.stream ? '流式' : '非流式') + ' · ' + r.ms + ' ms'
      + (r.error ? ' · ' + esc(r.error) : '')
      + '</span></div></div>'
      + '<div class="dsm-workbuddy-model-details"><div class="dsm-workbuddy-model-meta">'
      + '<span class="' + (ok ? 'dsm-workbuddy-model-meta-tag' : 'dsm-workbuddy-model-off-flag') + '">' + (ok ? 'ok' : 'failed') + '</span>'
      + '</div></div></div>';
  }).join('') || '<div class="dsm-workbuddy-model-disabled">还没有请求进来</div>';
}

function loadAll(options) {
  var force = options && options.refresh ? '?refresh=1' : '';
  return Promise.all([
    api('/wb/overview').catch(function () { return {}; }),
    api('/wb/accounts' + force).catch(function () { return {}; })
  ]).then(function (r) {
    S.data = r[0] || {};
    var acc = r[1] || {};
    S.accounts = acc.accounts || [];
    S.current = acc.current || null;
    if (acc.policy) { S.minUsable = acc.policy.minUsable; S.switchFloor = acc.policy.switchFloor; }
    if (S.data.settings && S.data.settings.activeRegion) S.region = S.data.settings.activeRegion;
    var hit = S.accounts.filter(function (a) { return a.id === S.current; })[0];
    if (!S.data.settings) S.region = hit ? (hit.region === 'global' ? 'global' : 'cn') : 'cn';
    S.selected = hit ? (hit.region === 'global' ? 'global' : 'cn') === S.region : false;
    renderRegions();
    renderPanels();
    render();
  });
}

function setPanel(p) { S.panel = p; if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p); renderPanels(); if (p === 'capabilities') { loadMedia(); loadBenefits(); } if (p === 'logs') loadLogs(); if (p === 'setup') loadSetup(); if (p === 'diag') loadDevice(); }

function fmtTok(n) {
  if (!n) return '0';
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function copyWith(btn, text) {
  var flash = function () {
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(function () { btn.textContent = old; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash, flash);
    return;
  }
  var ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* 粘贴板不可用时至少不抛错 */ }
  document.body.removeChild(ta);
  flash();
}

function nativeSnippet(d) {
  return 'model_provider = "workbuddy"\\n'
    + 'model = "' + d.defaultModel + '"\\n\\n'
    + '[model_providers.workbuddy]\\n'
    + 'name = "WorkBuddy"\\n'
    + 'base_url = "' + d.baseUrl + '"\\n'
    + 'wire_api = "chat"\\n'
    + 'requires_openai_auth = false\\n'
    + 'experimental_bearer_token = "' + d.apiKey + '"';
}

function setupValue(key) {
  var d = S.setup || {};
  if (key === 'modelList') return d.modelList || '';
  if (key === 'native') return nativeSnippet(d);
  if (key === 'epHealth') return (d.endpoints || {}).health || '';
  if (key === 'epModels') return (d.endpoints || {}).models || '';
  if (key === 'epChat') return (d.endpoints || {}).chat || '';
  return d[key] === undefined || d[key] === null ? '' : String(d[key]);
}

function setupAllText() {
  var d = S.setup;
  if (!d) return '';
  return ['名称: ' + d.name,
    '供应商 ID: ' + d.providerId,
    '上游地址: ' + d.baseUrl,
    '协议: ' + d.protocol,
    '模式: ' + d.relayMode,
    'API Key: ' + d.apiKey,
    '配置模型: ' + d.defaultModel,
    '',
    '模型列表:',
    d.modelList].join('\\n');
}

function copyRow(label, value, key, mono) {
  return '<div class="dsm-workbuddy-model"><div class="dsm-workbuddy-model-head">'
    + '<span class="dsm-workbuddy-model-copy"><span class="dsm-workbuddy-model-name">' + esc(label) + '</span></span>'
    + '<div class="dsm-workbuddy-model-controls">'
    + '<span class="dsm-workbuddy-models-summary' + (mono ? ' wbx-mono' : '') + '">' + esc(value) + '</span>'
    + '<button type="button" class="dsm-btn dsm-btn-outline" data-copy-key="' + key + '">复制</button>'
    + '</div></div></div>';
}

function loadSetup() {
  return api('/wb/install').then(function (d) {
    if (!d.ok) return;
    S.setup = d;
    $('setup-hint').textContent = d.gateway.installed
      ? 'Codex++ 已安装（网关端口 ' + (d.gateway.port === null ? '未接管' : d.gateway.port)
        + '）：面板 → 供应商 → 添加 → 自定义（纯 API），按下表逐项填写。'
      : '没有发现 Codex++：可以先用下面的原生 provider 方式接入 Codex，或先安装 Codex++。';
    $('setup-fields').innerHTML = [
      copyRow('供应商名称', d.name, 'name'),
      copyRow('供应商 ID', d.providerId, 'providerId', true),
      copyRow('Base URL / 上游地址', d.baseUrl, 'baseUrl', true),
      copyRow('上游协议', d.protocol, 'protocol', true),
      copyRow('模式', d.relayMode, 'relayMode', true),
      copyRow('API Key', d.apiKey, 'apiKey', true),
      copyRow('配置模型（默认启动模型，勿带后缀）', d.defaultModel, 'defaultModel', true)
    ].join('');
    $('setup-models').innerHTML = '<div class="dsm-workbuddy-model">'
      + '<div class="dsm-workbuddy-model-head"><span class="dsm-workbuddy-model-copy">'
      + '<span class="dsm-workbuddy-model-name">模型列表<span class="dsm-workbuddy-model-name-rate">'
      + (d.models || []).length + '</span></span></span>'
      + '<div class="dsm-workbuddy-model-controls">'
      + '<span class="dsm-workbuddy-models-summary">模型名[窗口]，每行一个</span>'
      + '<button type="button" class="dsm-btn dsm-btn-outline" data-copy-key="modelList">复制</button>'
      + '</div></div>'
      + '<div class="dsm-workbuddy-model-details"><div class="dsm-workbuddy-model-meta" style="display:block;white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.7">'
      + esc(d.modelList) + '</div></div></div>';
    $('setup-endpoints').innerHTML = [
      copyRow('健康检查', d.endpoints.health, 'epHealth', true),
      copyRow('模型清单（Codex++ 的「从上游获取」就是打这个）', d.endpoints.models, 'epModels', true),
      copyRow('对话接口', d.endpoints.chat, 'epChat', true)
    ].join('');
    $('setup-warn').innerHTML = (d.warnings || []).map(function (w) {
      return '<div class="wbx-note" style="margin:0 0 10px">' + esc(w) + '</div>';
    }).join('');
    $('setup-native').innerHTML = '<div class="dsm-workbuddy-model">'
      + '<div class="dsm-workbuddy-model-head"><span class="dsm-workbuddy-model-copy">'
      + '<span class="dsm-workbuddy-model-name">~/.codex/config.toml</span></span>'
      + '<div class="dsm-workbuddy-model-controls">'
      + '<button type="button" class="dsm-btn dsm-btn-outline" data-copy-key="native">复制</button>'
      + '</div></div>'
      + '<div class="dsm-workbuddy-model-details"><div class="dsm-workbuddy-model-meta" style="display:block;white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.7">'
      + esc(nativeSnippet(d)) + '</div></div></div>';
  }).catch(function () {});
}

function renderCheckin(c) {
  var card = $('checkin-card');
  if (!card) return;
  var head = '<span class="dsm-workbuddy-model-copy"><span class="dsm-workbuddy-model-name">每日签到';
  if (c && c.active && c.dailyCredit) {
    head += '<span class="dsm-workbuddy-model-name-rate">+' + c.dailyCredit + '</span>';
  }
  head += '</span></span>';
  if (!c || !c.active) {
    card.innerHTML = '<div class="dsm-workbuddy-model"><div class="dsm-workbuddy-model-head">' + head
      + '<div class="dsm-workbuddy-model-controls"><span class="dsm-workbuddy-models-summary">该账号当前没有签到活动</span></div>'
      + '</div></div>';
    return;
  }
  var bits = ['连续 ' + (c.streakDays || 0) + ' 天'];
  bits.push(c.todayCheckedIn ? '今天已领取' : ('今天可领 ' + (c.todayCredit || c.dailyCredit || 0) + ' 积分'));
  if (c.streakBonusDays > 0) bits.push('连签 ' + c.streakBonusDays + ' 天额外 +' + c.streakBonusCredit);
  var action = c.todayCheckedIn
    ? '<span class="dsm-workbuddy-model-meta-tag">今天已签到</span>'
    : '<button type="button" class="dsm-btn dsm-btn-outline" data-checkin>' + esc(c.claimButtonText || '立即签到') + '</button>';
  card.innerHTML = '<div class="dsm-workbuddy-model"><div class="dsm-workbuddy-model-head">' + head
    + '<div class="dsm-workbuddy-model-controls">' + action
    + '<span class="dsm-workbuddy-models-summary">' + esc(bits.join(' · ')) + '</span></div></div></div>';
}

function showPortModal(info) {
  var modal = $('port-modal');
  if (!modal) return;
  var url = 'http://127.0.0.1:' + info.port + '/v1';
  $('port-modal-lead').textContent = '端口 ' + info.preferredPort + ' 被其他程序占用，本次自动顺延到 '
    + info.port + '。面板与下列地址都已按新端口生成，功能不受影响。';
  $('port-modal-addr').textContent = url;
  $('port-modal-tail').textContent = '看这里就知道：模型接口是 127.0.0.1:' + info.port + '/v1。'
    + '新端口已记入配置，下次启动仍用它；想固定端口可以用 wbx serve --port 指定。';
  modal.hidden = false;
  $('port-modal-copy').onclick = function () { copyWith(this, url); };
  $('port-modal-ok').onclick = function () { modal.hidden = true; };
  modal.onclick = function (event) { if (event.target === modal) modal.hidden = true; };
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') modal.hidden = true;
  });
}

/**
 * 端口被占用而顺延时弹一次。
 *
 * 为什么要弹：页面自己会跟到新端口，用户看不出来换过；但 Codex++ 里那条
 * 供应商存的仍是旧地址，它不会跟着改——于是「地址看着对，就是连不上」。
 * 同一标签页里同一端口只弹一次（sessionStorage），避免每 15 秒刷新都打断人。
 */
function checkPortShift() {
  return api('/wb/health').then(function (h) {
    if (!h || h.shifted !== true) return;
    var key = 'wbx-port-shift-' + h.port;
    try {
      if (sessionStorage.getItem(key) === '1') return;
      sessionStorage.setItem(key, '1');
    } catch (e) {
      // 隐私模式下 sessionStorage 可能不可写，此时每次都弹也不算错。
    }
    showPortModal(h);
  }).catch(function () {});
}

function renderLogs() {
  var list = S.logs || [];
  $('logs').innerHTML = list.map(function (e) {
    var hhmmss = new Date(e.startedAtMs).toLocaleTimeString('zh-CN', { hour12: false });
    var bits = [hhmmss, e.stream ? '流式' : '非流式', e.durationMs + ' ms'];
    if (typeof e.firstTokenMs === 'number') bits.push('首字 ' + e.firstTokenMs + ' ms');
    var usage = e.usage
      ? 'in ' + fmtTok(e.usage.inputTokens) + ' / out ' + fmtTok(e.usage.outputTokens)
        + (e.usage.cachedTokens ? ' · 缓存 ' + Math.round((e.cacheHitRatio || 0) * 100) + '%' : '')
      : '无用量';
    var meta = [e.wireApi, e.account ? '账号 ' + e.account : '',
      e.attempts > 1 ? '尝试 ' + e.attempts + ' 次' : ''].filter(Boolean).join(' · ');
    return '<div class="dsm-workbuddy-model' + (e.success ? '' : ' dsm-workbuddy-model-disabled') + '">'
      + '<div class="dsm-workbuddy-model-head"><span class="dsm-workbuddy-model-copy">'
      + '<span class="dsm-workbuddy-model-name">' + esc(e.model || '—')
      + '<span class="dsm-workbuddy-model-name-rate">' + e.statusCode + '</span></span></span>'
      + '<div class="dsm-workbuddy-model-controls">'
      + '<span class="dsm-workbuddy-models-summary">' + esc(bits.join(' · ')) + '</span>'
      + '<span class="dsm-workbuddy-model-meta-tag">' + esc(usage) + '</span>'
      + '<button type="button" class="dsm-btn dsm-btn-outline" data-copy-log="' + esc(e.id) + '">复制</button>'
      + '</div></div>'
      + '<div class="dsm-workbuddy-model-details"><div class="dsm-workbuddy-model-meta">'
      + '<span>' + esc(meta) + '</span><span>' + esc(e.path) + '</span></div></div>'
      + (e.error ? '<p class="dsm-workbuddy-model-probe-result dsm-workbuddy-model-probe-result-bad">'
        + esc(e.error) + '</p>' : '')
      + '</div>';
  }).join('') || '<div class="dsm-workbuddy-model-disabled">还没有请求：这里会记录每次转发的模型、状态、耗时、首字、token 与错误原文。</div>';
}

function loadLogs() {
  var qs = '/wb/logs?limit=100';
  if (S.logFailed) qs += '&failed=1';
  if (S.logModel) qs += '&model=' + encodeURIComponent(S.logModel);
  if (S.logQ) qs += '&q=' + encodeURIComponent(S.logQ);
  return api(qs).then(function (d) {
    if (!d.ok) return;
    S.logs = d.entries || [];
    $('log-stats').textContent = '共 ' + d.total + ' 次 · 成功 ' + d.success + ' · 失败 ' + d.failed
      + ' · 平均 ' + d.avgMs + ' ms · p95 ' + d.p95Ms + ' ms · 平均首字 ' + d.avgFirstTokenMs + ' ms'
      + ' · 输入 ' + fmtTok(d.inputTokens) + ' / 输出 ' + fmtTok(d.outputTokens);
    var sel = $('log-model');
    if (sel.options.length <= 1 && d.models) {
      sel.innerHTML = '<option value="">全部模型</option>' + d.models.map(function (m) {
        return '<option value="' + esc(m) + '">' + esc(m) + '</option>';
      }).join('');
      sel.value = S.logModel;
    }
    renderLogs();
  }).catch(function () {});
}

function loadMedia() {
  return api('/wb/media-models').then(function (d) {
    if (!d.ok) { $('media').innerHTML = '<div class="dsm-workbuddy-model-disabled">' + esc(d.reason || '读取失败') + '</div>'; return; }
    $('media').innerHTML = (d.models || []).map(function (m) {
      return '<div class="dsm-workbuddy-model"><div class="dsm-workbuddy-model-head"><span class="dsm-workbuddy-model-copy">'
        + '<span class="dsm-workbuddy-model-name">' + esc(m.id) + '</span></span>'
        + '<div class="dsm-workbuddy-model-controls"><span class="dsm-workbuddy-models-summary">'
        + esc((m.tags || []).join(' / ')) + '</span></div></div></div>';
    }).join('') || '<div class="dsm-workbuddy-model-disabled">没有登记媒体模型</div>';
  }).catch(function () {});
}

function loadBenefits() {
  return api('/wb/benefits').then(function (d) {
    if (!d.ok) { $('benefits').innerHTML = '<div class="dsm-workbuddy-model-disabled">' + esc(d.reason || '读取失败') + '</div>'; return; }
    var items = d.benefits || [];
    $('benefits').innerHTML = items.map(function (b) {
      var action = b.claimed ? '<span class="dsm-workbuddy-model-meta-tag">已领取</span>'
        : b.active ? '<button type="button" class="dsm-btn dsm-btn-outline" data-claim="' + esc(b.kind) + '">领取</button>'
        : '<span class="dsm-workbuddy-model-meta-tag">未开放</span>';
      var end = b.endsAtMs ? (' · 至 ' + new Date(b.endsAtMs).toLocaleDateString('zh-CN')) : '';
      return '<div class="dsm-workbuddy-model"><div class="dsm-workbuddy-model-head"><span class="dsm-workbuddy-model-copy">'
        + '<span class="dsm-workbuddy-model-name">' + (b.kind === 'gift' ? '礼包' : '补偿') + ' · ' + b.creditNum + ' 积分</span>'
        + '</span><div class="dsm-workbuddy-model-controls">' + action
        + '<span class="dsm-workbuddy-models-summary">' + esc(end.replace(' · ', '')) + '</span></div></div></div>';
    }).join('') || '<div class="dsm-workbuddy-model-disabled">当前没有活动</div>';
  }).catch(function () {});
}

function loadDevice() {
  return api('/wb/device').then(function (d) {
    if (!d.ok) { $('device').innerHTML = '<div class="dsm-workbuddy-model-disabled">' + esc(d.reason || '读取失败') + '</div>'; return; }
    var sdk = d.sdk || {};
    $('device').innerHTML = '<div class="dsm-workbuddy-model"><div class="dsm-workbuddy-model-head">'
      + '<span class="dsm-workbuddy-model-copy"><span class="dsm-workbuddy-model-name">'
      + (d.mode === 'real' ? '真实设备档' : '虚拟设备档') + '</span></span>'
      + '<div class="dsm-workbuddy-model-controls"><span class="dsm-workbuddy-models-summary">'
      + '桌面端 SDK ' + esc(sdk.state || 'unknown') + (sdk.path ? ' · ' + esc(sdk.path) : '')
      + '</span></div></div>'
      + '<div class="dsm-workbuddy-model-details"><div class="dsm-workbuddy-model-meta">'
      + '<span>' + esc(sdk.reason || '真实档取不到值时自动回退虚拟档') + '</span>'
      + '</div></div></div>';
  }).catch(function () {});
}

function startLogin(region) {
  var box = $('login');
  box.innerHTML = '<div class="wbx-note">正在向 WorkBuddy 申请授权…</div>';
  api('/wb/oauth/start', { region: region }).then(function (d) {
    if (!d.ok) { box.innerHTML = '<div class="wbx-err">' + esc(d.reason || '发起登录失败') + '</div>'; return; }
    box.innerHTML = '<div class="wbx-note">在浏览器打开下面的链接完成登录，完成后本页自动刷新：<br>'
      + '<a class="wbx-login-link" href="' + esc(d.url) + '" target="_blank" rel="noreferrer">' + esc(d.url) + '</a>'
      + '<br><span id="login-status">等待登录…</span></div>';
    var timer = setInterval(function () {
      api('/wb/oauth/poll?loginId=' + encodeURIComponent(d.loginId) + '&region=' + region).then(function (pd) {
        if (!pd.done) return;
        clearInterval(timer);
        var st = $('login-status');
        if (!st) return;
        if (pd.error) { st.textContent = pd.error; return; }
        st.textContent = '已添加并切换到：' + (pd.account ? pd.account.name : '新账号');
        loadAll();
        setTimeout(function () { box.innerHTML = ''; }, 3000);
      }).catch(function () {});
    }, 2000);
  }).catch(function (e) { box.innerHTML = '<div class="wbx-err">发起登录失败：' + esc(e.message) + '</div>'; });
}

function patchModel(id, patch) {
  var body = { region: S.region, patch: {} };
  body.patch[id] = patch;
  return api('/wb/settings', body).then(function () { return loadAll(); });
}

function probe(id) {
  S.probing[id] = true; renderModels();
  return api('/wb/probe?model=' + encodeURIComponent(id)).then(function (d) {
    S.probing[id] = false;
    S.results[id] = d.ok
      ? { tone: 'ok', text: '可用' + (d.credit !== undefined ? ' · 本次消耗 ' + d.credit + ' 积分' : '') }
      : { tone: 'bad', text: '失败 ' + d.status + (d.retryAfter ? ' · 冷却 ' + d.retryAfter : '') + (d.message ? ' · ' + d.message : '') };
    renderModels();
  }).catch(function () { S.probing[id] = false; S.results[id] = { tone: 'bad', text: '请求出错' }; renderModels(); });
}

function measureTps(id) {
  S.tps[id] = true; renderModels();
  return api('/wb/tps?model=' + encodeURIComponent(id)).then(function (d) {
    S.tps[id] = false;
    S.results[id] = d.ok
      ? { tone: 'ok', text: d.sample.tokensPerSecond + ' tok/s · 首字 ' + d.sample.timeToFirstTokenMs + ' ms · ' + d.sample.samples + ' 样本' }
      : { tone: 'bad', text: '测速失败' + (d.reason ? ' · ' + d.reason : '') };
    renderModels();
  }).catch(function () { S.tps[id] = false; S.results[id] = { tone: 'bad', text: '测速出错' }; renderModels(); });
}

function sweep(kind) {
  if (S.sweeping) return;
  var models = (S.data && S.data.models) || [];
  var list = kind === 'all' ? models : models.filter(function (m) { return m.enabled; });
  if (!list.length) { alert('没有可测试的模型'); return; }
  S.sweeping = true;
  var done = 0, ok = 0;
  var summary = $('sweep-summary');
  summary.style.display = '';
  function step(i) {
    if (i >= list.length) {
      S.sweeping = false;
      summary.textContent = '完成：' + ok + ' / ' + list.length + ' 个可用';
      return;
    }
    var m = list[i];
    summary.textContent = (kind === 'tps' ? '测速中 ' : '测试中 ') + (i + 1) + ' / ' + list.length + ' · ' + m.name;
    var run = kind === 'tps' ? measureTps(m.id) : probe(m.id);
    run.then(function () {
      done++;
      if (S.results[m.id] && S.results[m.id].tone === 'ok') ok++;
      step(i + 1);
    });
  }
  step(0);
}

document.addEventListener('change', function (event) {
  var t = event.target;
  if (t.dataset && t.dataset.regionSwitch) {
    return api('/wb/region', { region: t.dataset.regionSwitch, on: t.checked }).then(loadAll);
  }
  if (t.dataset && t.dataset.enabled) return patchModel(t.dataset.enabled, { enabled: t.checked });
  if (t.dataset && t.dataset.image) return patchModel(t.dataset.image, { image: t.checked });
  if (t.dataset && t.dataset.off) return patchModel(t.dataset.off, { off: t.checked });
  if (t.dataset && t.dataset.budget) {
    var v = Number(t.value);
    var m = ((S.data && S.data.models) || []).filter(function (x) { return x.id === t.dataset.budget; })[0];
    var native = m ? m.nativeContextWindow : 0;
    return patchModel(t.dataset.budget, { budget: v === native ? null : v });
  }
  if (t.dataset && t.dataset.effort) return patchModel(t.dataset.effort, { effort: t.value });
  if (t.id === 'account-select') {
    return api('/wb/accounts/select', { id: t.value }).then(function () { return loadAll({ refresh: true }); });
  }
  if (t.id === 'log-model') {
    S.logModel = t.value;
    return loadLogs();
  }
});

var logTimer;
document.addEventListener('input', function (event) {
  if (event.target.id !== 'log-q') return;
  S.logQ = event.target.value;
  clearTimeout(logTimer);
  logTimer = setTimeout(loadLogs, 300);
});

document.addEventListener('click', function (event) {
  var t = event.target;
  var regionBtn = t.closest('[data-region]');
  if (regionBtn) {
    var r = regionBtn.dataset.region;
    return api('/wb/region', { region: r }).then(loadAll);
  }
  var panelBtn = t.closest('[data-panel]');
  if (panelBtn) return setPanel(panelBtn.dataset.panel);
  var addBtn = t.closest('[data-add]');
  if (addBtn) return startLogin(addBtn.dataset.add);
  var selBtn = t.closest('[data-select-account]');
  if (selBtn) {
    selBtn.disabled = true;
    // refresh:true 强制重读余额：刚切过去的账号必须立刻显示它自己的数字，
    // 而不是缓存里上一个账号的。
    return api('/wb/accounts/select', { id: selBtn.dataset.selectAccount }).then(function () {
      return loadAll({ refresh: true });
    });
  }
  var probeBtn = t.closest('[data-probe]');
  if (probeBtn) return probe(probeBtn.dataset.probe);
  var tpsBtn = t.closest('[data-tps]');
  if (tpsBtn) return measureTps(tpsBtn.dataset.tps);
  var checkinBtn = t.closest('[data-checkin]');
  if (checkinBtn) {
    checkinBtn.disabled = true;
    return api('/wb/checkin', {}).then(function (d) {
      if (!d.ok) alert(d.reason || '签到失败');
      loadAll();
    });
  }
  var claimBtn = t.closest('[data-claim]');
  if (claimBtn) {
    claimBtn.disabled = true;
    return api('/wb/benefits/claim', { kind: claimBtn.dataset.claim }).then(function (d) {
      if (!d.ok) alert(d.reason || '领取失败');
      loadBenefits(); loadAll();
    });
  }
  var setupCopy = t.closest('[data-copy-key]');
  if (setupCopy) {
    copyWith(setupCopy, setupValue(setupCopy.dataset.copyKey));
    return;
  }
  var copyBtn = t.closest('[data-copy-log]');
  if (copyBtn) {
    var entry = (S.logs || []).filter(function (e) { return e.id === copyBtn.dataset.copyLog; })[0];
    if (entry) {
      var text = JSON.stringify(entry, null, 2);
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      copyBtn.textContent = '已复制';
      setTimeout(function () { copyBtn.textContent = '复制'; }, 1500);
    }
    return;
  }
  var failedBtn = t.closest('[data-log-failed]');
  if (failedBtn) {
    S.logFailed = !S.logFailed;
    failedBtn.dataset.logFailed = S.logFailed ? '1' : '0';
    failedBtn.textContent = S.logFailed ? '显示全部' : '只看失败';
    return loadLogs();
  }
  var devBtn = t.closest('[data-devmode]');
  if (devBtn) {
    return api('/wb/device/mode', { mode: devBtn.dataset.devmode }).then(function (d) {
      alert(d.ok ? ('已切到' + (devBtn.dataset.devmode === 'real' ? '真实' : '虚拟') + '档，重启代理后生效。') : (d.reason || '切换失败'));
      loadDevice();
    });
  }
});

$('remove-account').addEventListener('click', function () {
  if (!S.current) { alert('没有选中的账号'); return; }
  if (!confirm('删除这个账号？只清本地保存的凭据，桌面端登录不受影响。')) return;
  api('/wb/accounts/remove', { id: S.current }).then(function (d) {
    if (!d.ok) alert(d.reason || '删除失败');
    loadAll();
  });
});
$('refresh-models').addEventListener('click', function () {
  var b = this; b.disabled = true; b.textContent = '刷新中…';
  api('/wb/models/refresh', {}).then(loadAll).then(function () { b.disabled = false; b.textContent = '从 WorkBuddy 刷新'; })
    .catch(function () { b.disabled = false; b.textContent = '从 WorkBuddy 刷新'; });
});
$('sweep-enabled').addEventListener('click', function () { sweep('enabled'); });
$('sweep-all').addEventListener('click', function () { sweep('all'); });
$('sweep-tps').addEventListener('click', function () { sweep('tps'); });
$('reload-media').addEventListener('click', loadMedia);
$('reload-benefits').addEventListener('click', loadBenefits);
$('reload-all').addEventListener('click', function () { loadAll(); loadDevice(); });
$('stop-proxy').addEventListener('click', function () {
  if (!confirm('关闭 WorkBuddy 代理？\\n\\n会结束本程序的全部进程（代理服务、设备 SDK 等辅助进程）。'
    + 'Codex 与 Codex++ 不受影响，但它们之后调用 WorkBuddy 模型会失败，直到重新启动代理。')) return;
  var btn = this;
  btn.disabled = true;
  btn.textContent = '正在关闭…';
  fetch('/wb/shutdown', { method: 'POST' }).then(function () {
    // 服务已经没了，但这张页面还在浏览器里，换一段能看懂的收尾说明。
    document.body.innerHTML = '<div style="padding:48px 40px;font:15px/1.9 system-ui,sans-serif;color:#e5e7eb">'
      + '<div style="font-size:17px;font-weight:600;margin-bottom:10px">已全部关闭</div>'
      + '<div>代理与它派生的辅助进程都已结束，Codex 和 Codex++ 保持原样。</div>'
      + '<div style="margin-top:8px;opacity:.75">下次要用时，双击桌面上的「WorkBuddy 面板」重新启动。</div>'
      + '</div>';
  }).catch(function () {
    btn.disabled = false;
    btn.textContent = '关闭';
    alert('关闭指令没有送达。请直接关掉标题为 WorkBuddy Proxy 的那个窗口。');
  });
});

$('copy-setup-all').addEventListener('click', function () {
  copyWith(this, setupAllText());
});
$('reload-setup').addEventListener('click', loadSetup);
$('reload-logs').addEventListener('click', loadLogs);
$('clear-logs').addEventListener('click', function () {
  if (!confirm('清空全部请求日志？磁盘上的 requests.jsonl 也会一并清空。')) return;
  api('/wb/logs/clear', {}).then(loadLogs);
});

var initial = (location.hash || '').replace('#', '');
if (['accounts', 'models', 'setup', 'capabilities', 'logs', 'diag'].indexOf(initial) >= 0) S.panel = initial;
renderRegions();
renderPanels();
checkPortShift();
loadAll().then(function () {
  loadDevice();
  if (S.panel === 'capabilities') { loadMedia(); loadBenefits(); }
  if (S.panel === 'logs') loadLogs();
  if (S.panel === 'setup') loadSetup();
});
setInterval(function () { if (!document.hidden && S.panel !== 'models') loadAll(); }, 15000);
</script>
</body>
</html>`
}
