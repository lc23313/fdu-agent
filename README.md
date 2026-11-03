# FDU Agent PWA

网站：https://lc23313.github.io/fdu-agent/

Windows 项目的独立手机前端发布快照。GitHub Pages 托管 docs/ 内的构建产物；应用数据、同步、eLearning 和手机 AI 继续使用本人配置的 Supabase。网页设置中填写公开 Project URL、公开 key 和同步码。服务端密钥、同步码和个人数据不在仓库内。

## 从源码构建

Node 24.22.1、pnpm 12.3.4；安装依赖后设置 FDU_PWA_BASE=/fdu-agent/ 并运行 pnpm pwa:build，生成 apps/pwa/dist。发布时将产物完整替换到 docs/ 后提交 main。Pages 发布目录为 main 分支 /docs。源码变更需要先重新构建，不能只修改 docs 中的压缩文件。

完整项目的桌面端未上传；此仓库提供与发布网页对应的前端源码。保留 GPL-3.0-or-later 许可，Dela 上游：https://github.com/Chang-Yo/Dela 。Supabase SQL 是公开结构说明，不会在部署网页时自动执行。
