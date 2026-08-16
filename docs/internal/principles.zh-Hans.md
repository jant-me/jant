# 原则

**1. 五分钟可运行（Zero-Config Start）**
Fork 到部署不应超过五分钟。必需配置项越少越好，一切都有合理的默认值。

**2. 单文件可读（File-Level Readability）**
打开任何一个文件，不需要跳转到别处就能理解它在做什么。300 行上限，单一职责。

**3. 边界严格，内部自由（Strict Boundaries, Free Internals）**
在系统边界（HTTP 入口、数据库）做严格校验和类型转换，内部代码可以信任数据是干净的。

**4. 数据向下流动（Data Flows Down）**
DB → Service → ViewModel → 组件。每一层只依赖上一层的输出，不反向穿透。

**5. 平台感知，边界抽象（Platform-Aware, Abstracted at Boundaries）**
业务逻辑保持平台无关。只在存储、运行时等基础设施接触点定义薄接口，具体实现按平台适配。不做大而全的抽象层，也不把平台细节泄漏到业务代码里。

**6. 渐进暴露复杂性（Progressive Disclosure）**
基础使用极简，高级功能按需出现。用户先能跑起来，再慢慢探索。

**7. 单一真相源（Single Source of Truth）**
每份数据只在一个地方定义。Schema 定义一处，类型从中推导，不手动同步多份。

**8. 快速且明确地失败（Fail Fast & Loud）**
缺配置？启动时就报错并告诉用户该怎么做，不要等到某个请求时才抛晦涩错误。

**9. 小且可逆（Small & Reversible）**
架构决策保持可替换性。今天的选择不应该成为明天的牢笼。

**10. 默认安全（Secure by Default）**
自部署用户不一定懂安全。认证、CSRF、输入过滤这些应该开箱即用，而不是靠用户自己配置。不安全的状态不应该是一个可达的状态。

**11. 平滑升级（Smooth Upgrades）**
自部署项目最怕「升级即毁灭」。数据库 migration 必须自动运行、向前兼容，配置项只增不改语义。用户 git pull + 重新部署就应该完成升级。

**12. 数据属于用户（User Owns Their Data）**
标准格式存储，可导出，不锁定。
