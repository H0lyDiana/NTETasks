# 异环 · 都市手账（NTETasks）

《异环》（Neverness to Everness）的日常 / 周常任务清单，纯静态网页，无构建、无依赖：双击 `index.html` 就能用，进度默认保存在浏览器本地；填好云端配置后还可以用用户名登录、把进度同步到云数据库。

## 功能

- **五类视图**：每日 / 每周 / 特殊 / 每月 / 所有，各带一个到下次重置的倒计时
- **到点自动重置**：每日 05:00、每周一 05:00、每月 1 日 00:00（北京时间）自动清空勾选；「特殊」类按每条任务自己的开始时间 + 间隔天数算
- **可选机制**（在 `data.js` 里逐条配置才生效，默认都不开）：
  - 次要任务 `minor`：排在已完成任务之后，不计入总次数
  - 关联任务 `link`：主任务完成后，从属任务自动完成；主任务重置时从属一起重置
  - `clock`：完成后 N 小时自动重置
  - `earn`：填「每小时收益」，满整小时累加，达到阈值自动重置
  - `countStep`：每完成一次计数 +N，只累计展示
- **工具**：版本日历（当期活动长图，折叠 + 懒加载）、一咖舍（内嵌经营计算器）
- 白天 / 黑夜双主题，桌面与手机自适应

## 目录结构

```
nte-companion/            可双击运行的站点
├─ index.html             唯一入口
├─ assets/                app.js（交互）、data.js（任务数据）、style.css
├─ cloud/                 cloud.js（云存档通道）、cloud-config.js（云端地址）
└─ images/                版本日历长图（1.1~1.4.jpg，见下方说明）

cloudbase/                云存档后端（可选）
├─ functions/nte-api/     CloudBase 云函数：登录 / 读存档 / 写存档
├─ migrations/            PostgreSQL 建表与接口函数
├─ cloudbaserc.json       部署配置
└─ README.md              从零部署的完整步骤

data_editor.py            任务数据的图形 / 命令行编辑器
编辑任务数据.bat           双击启动编辑器
上传网站到云端.bat         CloudBase 静态托管一键上传（模板，需改环境 ID）
```

## 本地使用

直接双击 `nte-companion/index.html`。没有做任何跨域或构建要求，`file://` 打开就能跑。

## 改任务数据

```bash
python data_editor.py                     # 图形界面，双击「编辑任务数据.bat」也可以
python data_editor.py --list              # 命令行列出所有任务
python data_editor.py --add "任务名" --cat daily
python data_editor.py --minor 8 --link "15,16"
```

保存前会自动备份，写回保持原有的排版与换行。任务数据全部在 `nte-companion/assets/data.js`（`window.NTE_DATA`：`categories` + `tasks`）。

## 云存档（可选）

`cloudbase/` 里是完整后端，按 [`cloudbase/README.md`](cloudbase/README.md) 的步骤在 CloudBase 建环境、建表、部署云函数、开 HTTP 访问服务，然后把得到的地址填进 `nte-companion/cloud/cloud-config.js` 的 `endpoint`。

`endpoint` 留空时页面退化为纯本机模式：进度照旧保存，只是「登录」按钮不可用。

> ⚠️ 当前登录只校验用户名、没有密码，任何知道用户名的人都能读写该账号的存档，仅适合个人自用。要公开给他人使用，请先在 `users` 表加口令字段并在 `nte_login` 里校验。

## 关于版本日历图片

`nte-companion/images/` 里是 4 张官方版本长图 `1.1.jpg` ~ `1.4.jpg`（1920 宽，合计约 16MB），所以整个仓库克隆下来会偏大。页面里用 `data-src` 懒加载，不展开对应版本就不会请求图片。

## 许可

代码可自由使用；《异环》相关的名称、图片等素材版权归其权利人所有。
