# ICPH — HCS Production Control (Phase 1)

一个可直接上传到 GitHub Pages 的 HCS（Hollow-core Slab）生产管理网站。

- **5 条 Bed**：Bed 1–5 实时状态 + 颜色 + HCS 模拟剖面图。
- **完整工序**：Available → Preparation → Ready to Cast → Casting → Curing → Cut & Demoulding → Available。
- **工序时间**：每一步开始/完成都写入时间戳，自动计算 preparation、casting、curing、cut/demoulding 时长；默认为执行按钮时的实际时间，可选择新加坡时间手动补录。
- **自动切换**：Casting 结束自动开始 Curing（同一个时间戳）。
- **Cube Strength**：Curing 期间可手动记录/更新强度 MPa，开始 Cut 前必须填写。**本系统只核对是否填写，不判断强度是否足以安全切割，请继续遵守企业工程和 QA/QC 放行程序。**
- **Projects**：3 个初始项目；支持下拉选择和直接输入 `10200 - New Project`；也可点击右下角 `Add Project` 独立添加。
- **Today's Casting Summary**：当天进入 Casting 的全部生产批次（包括尚未拆模、已拆模）；每天按 SGT 日期统计。
- **Daily Production Summary**：完成 Cut & Demoulding 才归档，最近 30 天，可按 Casting 日期筛选、日期升降排序、搜索、导出 CSV。
- **实时共享**：Supabase Realtime + Postgres；所有访问网站的人都能看，只有使用 Supabase Auth 账户登录的管工可以操作。并发操作在数据库事务中保护。
- **LPS**：此版本只做 HCS，LPS 在第二阶段追加。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `index.html` | 网站入口 |
| `config.js` | 配置 Supabase 项目 URL + Publishable / Anon Key |
| `src/main.mjs` | 管工界面、Bed 动态图、统计表、归档、导出 |
| `src/domain.mjs` | 时间、工序逻辑、Demo 模式规则 |
| `src/repository.mjs` | Supabase / 本地 Demo 数据接口 |
| `src/styles.css` | 响应式 UI 样式 |
| `supabase/schema.sql` | 数据表、安全策略、自动流程函数、实时订阅配置 |
| `supabase/optional_30_day_retention.sql` | 可选：数据库真正自动删除 30 天以前的已归档记录 |
| `tests/domain.test.mjs` | 自动测试生产流程和时间规则 |
| `.github/workflows/test.yml` | GitHub Actions 检查代码 |

## A. 第一步：先在本机或 GitHub Pages 查看 Demo（无数据库）

1. 解压 ZIP，上传**整个文件夹的内容**至 GitHub 仓库根目录（不是只上传 `index.html`）。
2. `config.js` 留空，网站自动进入 `LOCAL DEMO`。操作是有效的，但是**仅保存在当前浏览器 localStorage**，不实现跨设备实时共享。
3. 本机打开请使用 HTTP server（ES modules 不建议直接双击 `file://`）：

   ```bash
   cd ICPH-HCS-Production
   python -m http.server 8080
   ```

   浏览 `http://localhost:8080`。无需 `npm install`。

4. GitHub 仓库 → **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main → Folder: /(root) → Save**。
5. 几分钟后 GitHub Pages 将提供 `https://YOUR_USERNAME.github.io/YOUR_REPO/` 网站地址。静态项目不需要 React build、npm 或 Cloudflare，支持直接 GitHub Pages。

## B. 第二步：启用所有人可见的实时云端数据（正式部署需要）

1. 访问 [Supabase](https://supabase.com/dashboard)，创建一个项目，记录其 **Project URL** 和 **Publishable Key (`sb_publishable_...`)**，或者旧版 **anon key**。这两者是用于浏览器的公共配置。
2. Supabase → **SQL Editor** → New query → 复制 `supabase/schema.sql` 的**全部**内容 → Run。它会创建 5 个初始 Beds、3 个初始 Projects、4 张表、两条写入 RPC、安全策略，以及 Realtime publication。
3. Supabase → Authentication → Providers / Sign In → Email：启用邮箱密码登录，并**禁用公开注册（Allow new users to sign up）**。在 Authentication → Users 创建/邀请实际管工或管理员邮箱账户，并设置可使用的登录凭据。
4. 修改 `config.js`：

   ```js
   window.ICPH_CONFIG = {
     supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
     supabaseAnonKey: 'sb_publishable_xxxxxxxxxxxxxxxxx'
   };
   ```

5. Commit / Push `config.js` 到 GitHub。刷新 GitHub Pages，顶部由 `LOCAL DEMO` 切换到 `LIVE SYNC`（网络连接正常后）。未登录者可观看，管工点击 `Supervisor login` 登录后更新。
6. 在电脑 A 登录并操作 Bed 1，同时电脑 B/手机 B 打开同一网页。电脑 B 的 Bed 状态会在 Realtime 事件送达后自动更新。页面也每 30 秒兜底轮询。

**安全注意**：`config.js` 是公开可见文件，因此**绝不能填写** `service_role`、`secret`、Postgres 密码、任何个人密码或 JWT Secret。项目启用 RLS，仅允许公开读取；所有写入必须经过已认证用户调用的数据库事务函数。请只创建授权管工账户，不开放自助注册。如工厂资料不适合全网公开，请改成“登录后才能查看”的 RLS 模式，当前版本按“所有人都可以实时看”实现公开只读。

## C. 管工操作示例

1. 选择 **Bed 1** → Project 下拉选 `10108 - Bedok N8C14` → Height 填 `200`（单位 mm）→ Strand Pattern 填 `6T-9.53`。
2. 默认时间为当前 SGT，点击 **Start Preparation**。状态变蓝。
3. 准备完成，点击 **Finish Preparation** → 自动记录 Preparation 用时，状态变为 Ready to Cast。
4. 点击 **Start Casting** → 状态变橙。页面今日 Casting Summary 出现该记录。
5. 点击 **Finish Casting & Start Curing** → 自动保存 Casting 时长；同时起算 Curing，状态变紫。
6. 点击 Bed 1，Cube Strength 输入 `38.5` MPa → **Save Strength**。该字段可在 Curing 阶段更新数值。
7. 工程 / QAQC 放行后，点击 **Start Cut & Demoulding**；完成后点击 **Finish & Archive Production**（有确认提示）。系统记录拆模时长，清空 Bed 1，并在归档 Tab 出现记录。
8. 可以将所有 Bed 并行管理，各个工序的时间互不影响。

## D. 30 天归档与数据保存政策

**默认**：网站只显示“最近 30 天内完成的生产记录”，数据库会继续保存旧记录，不自动删除。这样可以避免误删工厂 QA/QC 证据，而 UI 满足一个月可查的要求。

若您的正式政策要求**超过 30 天自动永久删除**，在 Supabase 支持 `pg_cron` 的条件下，另外运行 `supabase/optional_30_day_retention.sql`。请先确认企业与项目合同的记录保存要求再开启；执行后会连带删除相应工序日志且不可恢复。建议先只隐藏、定期备份。

## E. 已知边界与下一阶段

- 当前只有 HCS；LPS 导航标注 `Coming next`，并没有混入 HCS 数据表。
- Cube Strength 属于过程记录，**不是自动发放 cut/demould safety approval**。
- 时间戳可补录，数据库校验先后顺序、阻止未来时间；当前不支持修改已记录的工序时间，需要在后续加入审计式修正功能。
- 项目一旦参与生产，会将项目代码/名称快照写入当次 batch；之后添加新项目不影响历史批次。
- 默认所有人都可以看到生产数据（不需登录）。如果客户项目和每日产量属于敏感数据，请联系管理员调整 RLS 策略与登录要求。
- 本系统使用第三方 CDN 加载 Supabase JS SDK；实时模式需要网络连接。
- 当前演示可使用 localStorage 清空浏览器存储来重置，不会影响真正的 Supabase 数据。

## F. 开发自检

无需任何外部 npm 包（Node.js 20+）：

```bash
npm run check
npm test
```

后续如果需要增加单位数、HCS 长度/总 m²、QA QC approval、主管复核、用户权限等级、日报 PDF、LPS 的专用流程，都可以在这个模块上迭代，而不需要重写整个网站。
