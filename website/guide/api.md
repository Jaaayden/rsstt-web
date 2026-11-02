# API 与 Agent

在“设置 → API 访问”创建令牌，选择**只读**或**读写订阅**、允许访问的会话（全部或指定）和有效期。完整令牌只显示一次，可以随时撤销。令牌只能操作订阅，不能修改设置、角色、备份或查看会话操作记录。

```sh
curl -H "Authorization: Bearer <token>" https://rss.example.com/api/subscriptions?size=20

curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"target":"-1001234567890","urls":["https://example.com/feed.xml"]}' \
  https://rss.example.com/api/subscriptions
```

完整的接口定义在 `/api/openapi.json`（需要令牌）。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/session` | 当前令牌的权限与范围 |
| GET | `/api/targets` | 会话列表 |
| GET / POST | `/api/subscriptions` | 查询 / 添加订阅（每次最多 100 个地址） |
| GET / PATCH / DELETE | `/api/subscriptions/{id}` | 查看 / 修改 / 取消订阅 |
| POST | `/api/subscriptions/batch` | 批量暂停、恢复、取消、设置检查间隔（`action: interval`） |
| GET | `/api/subscriptions/opml` | 导出 OPML |
| GET / PUT | `/api/feeds/{id}/recipients` | 查看 / 追加或替换一个源的接收会话 |
| GET / POST | `/api/targets/{id}/opml` | 导出 / 导入某个会话的 OPML |

Telegram 会话 ID 在 JSON 中是字符串，请保持完整精度。

## 命令行工具

仓库自带一个 CLI，写操作默认只预览，加 `--apply` 才执行：

```sh
python -m src.management.agent_cli --url https://rss.example.com --token-file ~/.rsstt-token /api/session
```
