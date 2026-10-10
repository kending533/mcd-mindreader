# MCP_INTEGRATION.md —— 麦门读心术的麦当劳 MCP 集成说明

## 使用的 MCP Server

| 项目 | 值 |
|------|-----|
| Server | 麦当劳中国官方 MCP（`mcd-mcp`） |
| 接入地址 | `https://mcp.mcd.cn/mcp-servers/mcd-mcp` |
| 协议 | Streamable HTTP（MCP 2025-06-18） |
| 认证 | `Authorization: Bearer <MCP Token>`（Token 从 open.mcd.cn/mcp 申请，环境变量 `MCD_MCP_TOKEN` 注入，不落盘） |
| 限流 | 600 次/分钟 |

## 工具使用清单与调用流程

本 Skill 的数据分两层：**本地数据层**（`data/` 目录，零依赖可玩）与 **MCP 实时增强层**（绑定门店后替换为实时数据）。

### 流程一：本地基础模式（默认，零 MCP 依赖）

```
用户选择模式（馋点定位 / 性格定位 / 手气套餐）
  → 读 data/quiz-bank.json 出题（每题从选项池随机抽 3 个）
  → 收集答案，汇总 w 权重 → 馋点画像（7 维：meat/fresh/light/sweet/salty/cool/hearty）
  → 读 data/combo-pool.json，匹配分 = Σ score[维度] × v[维度]
  → 内置模拟券规则配券（满减/半价/折扣）
  → 输出 🎯 最匹配 + 🔄 换换口味 两套方案
```

### 流程二：MCP 实时增强模式

| 步骤 | 工具 | 用途 | 备注 |
|------|------|------|------|
| 1. 刷新营养库 | `list-nutrition-foods` | 拉取 160+ 单品官方营养数据（能量/蛋白/脂肪/碳水/钠/钙），校准 combo-pool 的 kcal 与营养标签 | 无需入参；返回 toon 紧凑格式：`productName,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium` |
| 2. 绑定门店 | `query-nearby-stores` | 用户提供城市+地标后搜索门店（searchType=2），取 storeCode | 只读 |
| 3. 拉在售菜单 | `query-meals` | 按门店拉在售商品池，校验推荐商品当日有售，剔除下架项 | orderType=1, beType=1 |
| 4. 套餐构成 | `query-meal-detail` | 查推荐套餐的组成与可替换项，让"为什么是它"更具体 | 输入 productCode |
| 5. 真实优惠券 | `query-store-coupons` | 用门店真实可用券替换本地模拟券规则，逐券适配推荐组合 | 需 storeCode + orderType |
| 6. 核价 | `calculate-price` | 对最终 2 套方案核价（含券），**价格单位为分，展示除以 100** | 预算过滤依据 |
| 7. 下单（可选） | `create-order` | 用户明确说"就它了"后创建订单，返回支付链接 | **写操作，必须逐项确认** |
| 8. 活动情报 | `campaign-calendar` | 在"为什么是它"里补充活动语境（如"新品正好在活动期"） | 只读 |

### 模式差异对 MCP 的依赖

- **手气套餐 + 预算**：实时模式下用 `calculate-price` 对候选逐一核价后再随机，保证"券后价 ≤ 预算"是真实承诺而非估算。
- **性格定位**：分析报告纯本地生成；配餐环节同流程二。

## 业务价值

1. **对用户**：不需要知道自己想吃什么也能得到确定答案；券后价透明；2 套方案定位错开、不会推荐疲劳。
2. **对麦当劳**：读心题把用户停留变成了互动游戏，"性格报告"天然适合社交分享（传播入口）；每个馋点维度都对应真实商品簇，推荐即转化。
3. **工程贡献**：发现了 WorkBuddy 等桌面客户端直连官方 MCP 的 Windows schannel 证书吊销检查失败问题（`CRYPT_E_REVOCATION_OFFLINE`），并提供 `scripts/mcd-bridge.js` stdio 桥接方案（Token 走环境变量），其他参赛者可直接复用。

## 工程发现：桌面客户端直连失败的本地方案

**现象**：在 WorkBuddy 桌面版中按官方文档配置 `streamablehttp` 后，`mcd-mcp` 无法加载；同机 curl 直连报 `curl: (35) schannel: CRYPT_E_REVOCATION_OFFLINE`——Windows 网络栈做 TLS 证书吊销检查时，`mcp.mcd.cn` 证书的 CRL/OCSP 端点不可达，导致连接检查失败。加 `--ssl-no-revoke` 后同一请求立即返回 HTTP 200。

**方案**：`scripts/mcd-bridge.js` —— 一个零依赖 Node 脚本，以 **stdio MCP Server** 形式被客户端拉起，把收到的 JSON-RPC 消息转发到官方 HTTP 端点（Node 的网络栈不做 Windows 吊销检查），并自动维护 `Mcp-Session-Id`、兼容 JSON 与 SSE 两种响应。配置示例（Token 走环境变量，勿写死）：

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/scripts/mcd-bridge.js"],
      "env": { "MCD_MCP_TOKEN": "YOUR_MCP_TOKEN" }
    }
  }
}
```

经真机验证：桥接后 `initialize` / `tools/list` / 全部业务工具调用均正常。

## 环境变量

| 变量 | 用途 |
|------|------|
| `MCD_MCP_TOKEN` | 麦当劳 MCP Token（桥接模式读取；直连模式写在客户端配置中） |
