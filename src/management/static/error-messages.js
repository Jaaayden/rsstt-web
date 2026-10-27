// Only controlled business messages are translated here. Never render an
// arbitrary server error, submitted value, filesystem path, or traceback.
const messages = new Map([
    [
        "归档范围无效，请选择未归档、已归档或全部。",
        [
            "归档范围无效，请选择未归档、已归档或全部。",
            "Choose a valid archive view: Not archived, Archived, or All (including archived).",
        ],
    ],
    [
        "请选择 1–100 个会话，并指定归档或恢复操作。",
        [
            "请选择 1–100 个会话，并指定归档或恢复操作。",
            "Choose 1–100 chats and specify whether to archive them or restore them to the Not archived view.",
        ],
    ],
    [
        "不能归档机器人管理者的会话。请取消选择管理者后重试。",
        [
            "不能归档机器人管理者的会话。请取消选择管理者后重试。",
            "Bot manager chats cannot be archived. Deselect the manager and try again.",
        ],
    ],
    [
        "已归档会话不能作为新的接收会话。请先从已归档列表恢复，再重试。",
        [
            "已归档会话不能作为新的接收会话。请先从已归档列表恢复，再重试。",
            "An archived chat cannot be a new receiving chat. Unarchive it from the Archived view, then try again.",
        ],
    ],

    [
        "会话显示范围无效，请选择未封禁、活跃、不活跃、已封禁或全部。",
        [
            "会话显示范围无效，请选择未封禁、活跃、不活跃、已封禁或全部。",
            "Choose a valid chat visibility: Not blocked, Active, Inactive, Blocked, or All.",
        ],
    ],
    [
        "该会话已被封禁，无法恢复订阅。请先在会话设置中解除封禁，再手动恢复订阅。",
        [
            "该会话已被封禁，无法恢复订阅。请先在会话设置中解除封禁，再手动恢复订阅。",
            "This chat is blocked, so its subscriptions cannot be resumed. Unblock it in the chat’s settings, then resume the subscriptions manually.",
        ],
    ],
    [
        "该会话已被封禁，无法添加订阅。请先在会话设置中解除封禁，再重试。",
        [
            "该会话已被封禁，无法添加订阅。请先在会话设置中解除封禁，再重试。",
            "This chat is blocked, so subscriptions cannot be added. Unblock it in the chat’s settings, then try again.",
        ],
    ],
    [
        "这个用户已被封禁。",
        [
            "该会话已被封禁。请先在会话设置中解除封禁，再添加或恢复订阅。",
            "This chat is blocked. Unblock it in the chat’s settings before adding or resuming subscriptions.",
        ],
    ],
    [
        "不能向已封禁的会话添加订阅。",
        [
            "该会话已被封禁，无法添加订阅。请先在会话设置中解除封禁，再重试。",
            "This chat is blocked. Unblock it in the chat’s settings before adding subscriptions.",
        ],
    ],
    [
        "接收会话已被封禁。",
        [
            "接收会话已被封禁，接收关系未修改。请先解除封禁，再重试。",
            "The receiving chat is banned. No recipients were changed. Unblock it before trying again.",
        ],
    ],
    [
        "接收会话已退出或禁用。",
        [
            "接收会话已退出或禁用，无法添加订阅。请先检查机器人的加入状态与发送权限。",
            "The receiving chat has been left or disabled. Check that the bot has joined it and can send messages before adding subscriptions.",
        ],
    ],
    [
        "接收会话已达到订阅上限；没有修改任何接收关系。",
        [
            "接收会话已达到订阅上限，接收关系未修改。请在会话设置中提高上限，或先移除不需要的订阅。",
            "A receiving chat has reached its subscription limit. No recipients were changed. Increase its limit in the chat’s settings or remove unneeded subscriptions first.",
        ],
    ],
    [
        "已达到此会话的订阅数量上限。",
        [
            "该会话已达到订阅上限。请在会话设置中提高上限，或先移除不需要的订阅。",
            "This chat has reached its subscription limit. Increase its limit in the chat’s settings or remove unneeded subscriptions first.",
        ],
    ],
    [
        "找不到来源，或授权不包含该来源。",
        [
            "找不到该订阅来源，或当前连接授权无权访问它。请检查来源是否仍存在及授权范围。",
            "The feed was not found or is outside this connection's scope. Check that it still exists and that the connection is allowed to access it.",
        ],
    ],
    [
        "找不到这个会话。",
        [
            "找不到该会话。请返回会话与频道列表，确认记录是否仍存在。",
            "This chat was not found. Return to Chats and check whether the record still exists.",
        ],
    ],
    [
        "找不到订阅，或连接授权不包含该订阅。",
        [
            "找不到该订阅，或当前连接授权无权访问它。请检查订阅是否仍存在及授权范围。",
            "The subscription was not found or is outside this connection's scope. Check that it still exists and that the connection is allowed to access it.",
        ],
    ],
    [
        "连接授权不包含这个会话。",
        [
            "当前连接授权不包含该会话。请使用获准访问该会话的授权。",
            "This connection is not allowed to access the chat. Use a connection authorized for it.",
        ],
    ],
    [
        "连接授权不允许访问此操作。",
        [
            "当前连接授权不允许执行此操作。请检查授权权限；管理功能需要网页登录管理员。",
            "This connection cannot perform this action. Check its permissions. Administrative actions require an administrator signed in to the console.",
        ],
    ],
    [
        "这个连接授权只有读取权限。",
        [
            "当前连接授权只有读取权限，无法保存修改。请使用具有订阅读写权限的授权。",
            "This connection is read-only and cannot save changes. Use one with subscription write permission.",
        ],
    ],
    [
        "此操作需要管理台管理员权限。",
        [
            "此操作需要管理台管理员权限。请通过网页登录后再操作。",
            "This action requires a console administrator. Sign in through the console before continuing.",
        ],
    ],
    [
        "请先登录管理台。",
        ["登录已失效，请重新登录后再操作。", "Your session has expired. Sign in again before continuing."],
    ],
    [
        "尝试次数过多，请在 5 分钟后重试。",
        ["密码尝试次数过多。请等待 5 分钟后再试。", "Too many password attempts. Wait 5 minutes before trying again."],
    ],
    [
        "请求来源不匹配，请通过配置的管理台地址访问。",
        [
            "访问地址与管理台配置不一致。请使用部署时配置的管理台地址重新打开页面。",
            "The current address does not match the console configuration. Reopen the console using its configured address.",
        ],
    ],
    [
        "登录来源与 WEB_ORIGIN 不匹配。",
        [
            "当前登录地址与 WEB_ORIGIN 配置不一致。请使用配置中的管理台地址登录。",
            "The sign-in address does not match WEB_ORIGIN. Sign in using the configured console address.",
        ],
    ],
    [
        "机器人已经离开这个会话。",
        [
            "机器人已离开该会话。请先在 Telegram 中重新加入机器人，再同步会话状态。",
            "The bot has left this chat. Add it again in Telegram, then refresh its chat status.",
        ],
    ],
    [
        "机器人没有在这个频道发布消息的权限。",
        [
            "机器人没有频道发布权限。请在 Telegram 中授予发布消息权限，再重试。",
            "The bot cannot post to this channel. Grant it permission to post messages in Telegram, then try again.",
        ],
    ],
    [
        "群组当前禁止机器人发送消息。",
        [
            "群组禁止机器人发送消息。请在 Telegram 中调整机器人的发送权限，再重试。",
            "The group does not allow the bot to send messages. Update its permissions in Telegram, then try again.",
        ],
    ],
    [
        "无法访问这个会话。请确认机器人已加入，并具有相应权限。",
        [
            "无法访问该会话。请确认机器人已在 Telegram 中加入该会话，并具有所需权限。",
            "The chat could not be accessed. Check that the bot has joined it in Telegram and has the required permissions.",
        ],
    ],
    [
        "Telegram 未确认退出，请刷新会话状态后重试。",
        [
            "Telegram 尚未确认机器人退出。请先同步会话状态，确认后再决定是否重试。",
            "Telegram has not confirmed that the bot left. Refresh the chat status and check it before retrying.",
        ],
    ],
    [
        "这个会话不在快照中；离线预览无法向 Telegram 登记新会话。",
        [
            "该会话不在当前快照中。离线预览不能向 Telegram 登记新会话，请选择快照中已有的会话。",
            "This chat is not in the snapshot. Offline preview cannot register chats through Telegram. Select one already in the snapshot.",
        ],
    ],
    [
        "离线预览无法退出 Telegram 会话；可在本地副本中暂停或取消订阅。",
        [
            "离线预览不能让机器人退出真实 Telegram 会话。你可以在当前本地副本中暂停或取消订阅。",
            "Offline preview cannot make the bot leave a real Telegram chat. You can pause or remove subscriptions in the local copy.",
        ],
    ],
    [
        "离线预览使用快照中的会话名称，无法实时同步 Telegram 名称与权限。",
        [
            "离线预览使用快照中的名称与权限记录，不能实时同步 Telegram。请继续使用当前快照数据测试。",
            "Offline preview uses names and permission records from the snapshot and cannot refresh them from Telegram. Continue testing with the snapshot data.",
        ],
    ],
    [
        "用户角色无效。",
        [
            "用户角色无效。请从页面提供的角色中重新选择。",
            "The user role is invalid. Select one of the roles offered in the form.",
        ],
    ],
    [
        "角色必须是 banned、guest、user 或 admin。",
        ["请选择已封禁、访客、用户或管理员中的一种角色。", "Choose Banned, Guest, User, or Administrator as the role."],
    ],
    [
        "不能修改 MANAGER 或当前管理者的角色。",
        [
            "该账号是受保护的管理者，不能在网页中降级或封禁。",
            "This account is a protected manager and cannot be demoted or banned through the console.",
        ],
    ],
    [
        "频道和群组不能设为用户管理员。",
        [
            "频道和群组不能设为用户管理员。管理员角色仅适用于普通私聊用户。",
            "Channels and groups cannot be user administrators. That role is only available for private-chat users.",
        ],
    ],
    [
        "请填写完整的 RSS 网址。",
        [
            "RSS 地址不完整。请填写包含 http:// 或 https:// 的完整地址。",
            "Enter a complete RSS URL starting with http:// or https://.",
        ],
    ],
    [
        "订阅地址只支持不含用户名、密码的 HTTP / HTTPS 网址。",
        [
            "RSS 地址必须是 HTTP 或 HTTPS 网址，且不能包含用户名或密码。请检查地址后重试。",
            "Use an HTTP or HTTPS feed URL without an embedded username or password. Check the URL and try again.",
        ],
    ],
    [
        "每次可添加 1–100 个订阅地址。",
        [
            "每次可添加 1–100 个 RSS 地址。请检查是否为空，或将较多地址分批添加。",
            "Add 1–100 RSS URLs at a time. Enter at least one URL or split a larger list into batches.",
        ],
    ],
    [
        "mode 必须为 append 或 replace；targets 最多 100 个会话。",
        [
            "接收者操作必须选择追加或替换，每次最多处理 100 个会话。请检查操作和会话数量。",
            "Choose Append or Replace for recipients and select no more than 100 chats per operation.",
        ],
    ],
    [
        "最多导出 100 条选中订阅。",
        [
            "一次最多导出 100 条选中订阅。请减少选择数量，或分批导出。",
            "Export no more than 100 selected subscriptions at a time. Select fewer items or export them in batches.",
        ],
    ],
    [
        "User-Agent 应为最多 512 个可打印 ASCII 字符，不允许换行。",
        [
            "User-Agent 最多 512 个字符，仅支持可打印 ASCII 字符，不能包含换行。请修改后保存。",
            "User-Agent must contain no more than 512 printable ASCII characters and no line breaks. Edit it before saving.",
        ],
    ],
    [
        "没有可保存的设置。",
        [
            "没有收到可保存的设置。请填写需要修改的选项后重试。",
            "No settings were provided to save. Enter the options you want to change and try again.",
        ],
    ],
    [
        "包含不支持的设置项。",
        [
            "提交的设置包含不支持的字段，未保存。请刷新页面并使用当前表单重试。",
            "The submitted settings contain unsupported fields and were not saved. Refresh the page and use the current form.",
        ],
    ],
    [
        "语言代码无效。",
        [
            "Bot 语言代码无效。请使用 en、zh-Hans 等支持的代码，自动语言填写 null。",
            "The Bot language code is invalid. Use a supported code such as en or zh-Hans, or null for automatic language selection.",
        ],
    ],
    [
        "标题或标签过长。",
        [
            "自定义标题最多 1024 个字符，标签最多 255 个字符。请缩短超出限制的内容。",
            "Custom titles support up to 1,024 characters and tags up to 255. Shorten the content that exceeds the limit.",
        ],
    ],
    [
        "订阅状态无效。",
        ["订阅状态无效。请选择暂停或恢复订阅。", "The subscription state is invalid. Choose Pause or Resume."],
    ],
    [
        "订阅上限应为 -1（不限）或非负整数。",
        [
            "订阅上限请填写 -1（不限）、0（不允许添加）或正整数；留空可继承实例设置。",
            "Use -1 for unlimited subscriptions, 0 to prevent additions, or a positive integer. Leave it blank to inherit the instance setting.",
        ],
    ],
    [
        "长度阈值应为 0–4096。",
        [
            "长度阈值必须在 0–4096 之间。请修改后保存。",
            "The length threshold must be between 0 and 4,096. Correct it before saving.",
        ],
    ],
    [
        "取消订阅失败，请刷新后重试。",
        [
            "取消订阅未完成。请刷新订阅列表确认记录是否仍存在，再重试。",
            "The subscription could not be removed. Refresh the subscription list to check whether it still exists, then try again.",
        ],
    ],
    [
        "机器人不能退出私聊，可暂停或取消该用户的订阅。",
        [
            "机器人不能像退出群组一样退出私聊。请暂停或取消该用户的订阅。",
            "The bot cannot leave a private chat as it would leave a group. Pause or remove the user's subscriptions instead.",
        ],
    ],
    [
        "请输入会话 ID 确认退出。",
        [
            "请在确认框中填写该会话的完整 ID，确认机器人退出。",
            "Enter the chat's full ID in the confirmation field to confirm that the bot should leave.",
        ],
    ],
    [
        "每次可处理 1–100 条订阅，操作可选 pause、resume、delete。",
        [
            "请先选择 1–100 条订阅，再执行暂停、恢复或取消订阅操作。",
            "Select 1–100 subscriptions before choosing Pause, Resume, or Remove.",
        ],
    ],
    [
        "OPML 文件不能超过 512 KB。",
        [
            "OPML 文件超过 512 KB。请拆分文件后分批导入。",
            "The OPML file exceeds 512 KB. Split it into smaller files before importing.",
        ],
    ],
    [
        "不是有效的 OPML 文件，或文件包含不允许的 DTD。",
        [
            "文件不是有效的 OPML，或包含不支持的 DTD 声明。请重新导出标准 OPML 文件后导入。",
            "The file is not valid OPML or contains an unsupported DTD declaration. Export a standard OPML file and import it again.",
        ],
    ],
    [
        "一次导入最多 100 个订阅，请拆分较大的文件。",
        [
            "一次最多导入 100 个订阅。请将文件拆分后分批导入。",
            "Import no more than 100 subscriptions at a time. Split the file into smaller batches.",
        ],
    ],
    [
        "订阅上限提示最多 2000 个字符。",
        [
            "订阅上限提示超过 2000 个字符，未保存。请缩短提示内容。",
            "The subscription-limit message exceeds 2,000 characters and was not saved. Shorten it before saving.",
        ],
    ],
    [
        "默认更新间隔不能小于最短更新间隔。",
        [
            "默认更新间隔不能小于最短更新间隔，设置未保存。请提高默认间隔，或调低允许的最短间隔。",
            "The default update interval cannot be shorter than the minimum interval. The settings were not saved. Increase the default or lower the minimum interval.",
        ],
    ],
    [
        "包含不支持的运行配置。",
        [
            "提交的运行配置包含不支持的字段，未保存。请使用运行配置页面提供的配置项。",
            "The runtime configuration contains unsupported fields and was not saved. Use the options offered on the Runtime configuration page.",
        ],
    ],
    [
        "没有可保存的运行配置。",
        [
            "没有收到可保存的运行配置。请填写配置值，或选择恢复部署默认值。",
            "No runtime configuration was provided. Enter a value or select Restore deployment default.",
        ],
    ],
    [
        "运行配置文件无效。",
        [
            "本地运行配置文件无效。请检查文件格式与权限，修正后再操作。",
            "The local runtime configuration file is invalid. Check its format and permissions before continuing.",
        ],
    ],
    [
        "运行配置文件版本无效。",
        [
            "本地运行配置文件版本不受支持。请使用当前版本生成的配置文件。",
            "The local runtime configuration file uses an unsupported version. Use a configuration file generated by this version.",
        ],
    ],
    [
        "无法读取有效的运行配置文件；请检查本地配置。",
        [
            "无法读取本地运行配置文件。请检查文件格式、版本与权限后再保存。",
            "The local runtime configuration file could not be read. Check its format, version, and permissions before saving.",
        ],
    ],
    [
        "请填写名称并选择 read 或 write 权限。",
        [
            "请填写授权名称，并选择只读或订阅读写权限。",
            "Enter a connection name and choose Read-only or Subscription read/write permission.",
        ],
    ],
    [
        "请选择至少一个会话，或明确允许全部会话。",
        [
            "尚未选择授权会话。请选择至少一个会话，或勾选允许全部会话。",
            "No authorized chats were selected. Select at least one chat or explicitly allow all chats.",
        ],
    ],
    [
        "最多保留 100 个有效连接授权。",
        [
            "有效连接授权已达 100 个上限。请先撤销不再使用的授权，再创建新授权。",
            "The limit of 100 active connections has been reached. Revoke an unused connection before creating another.",
        ],
    ],
    [
        "通知配置字段无效。",
        [
            "通知配置包含无效字段，未保存。请刷新页面并使用当前通知表单。",
            "The notification configuration contains invalid fields and was not saved. Refresh the page and use the current notification form.",
        ],
    ],
    [
        "通知策略字段无效。",
        [
            "通知策略包含无效字段。请检查失败阈值、冷却时间及通知开关。",
            "The notification policy contains invalid fields. Check the failure threshold, cooldown, and notification switches.",
        ],
    ],
    [
        "通知开关必须为布尔值。",
        [
            "通知开关值无效。请使用页面上的启用或关闭开关。",
            "The notification switch value is invalid. Use the On or Off control in the form.",
        ],
    ],
    [
        "阈值为 1–100，冷却为 1–604800 秒。",
        [
            "失败阈值须为 1–100 次，通知冷却须为 1–604800 秒。请修改超出范围的值。",
            "The failure threshold must be 1–100 and the notification cooldown 1–604,800 seconds. Correct any value outside these ranges.",
        ],
    ],
    [
        "通知渠道无效。",
        [
            "通知渠道不存在或不受支持。请选择页面提供的渠道后重试。",
            "The notification channel does not exist or is unsupported. Select a channel offered in the form and try again.",
        ],
    ],
    [
        "渠道配置必须为对象。",
        [
            "通知渠道配置格式无效。请通过渠道设置表单重新保存。",
            "The notification channel configuration has an invalid format. Save it again through the channel settings form.",
        ],
    ],
    [
        "渠道字段无效。",
        [
            "通知渠道包含不支持的字段。请使用当前渠道的设置表单。",
            "The notification channel contains unsupported fields. Use the settings form for the selected channel.",
        ],
    ],
    [
        "渠道文本字段无效。",
        [
            "通知渠道的文本配置无效。请检查字段长度，并移除不允许的控制字符。",
            "A notification channel text field is invalid. Check its length and remove unsupported control characters.",
        ],
    ],
    [
        "Telegram Token 或接收者格式无效。",
        [
            "Telegram 通知的 Bot Token 或接收者格式无效。请检查 Token，并填写有效的接收者 ID。",
            "The Telegram notification Bot Token or recipient has an invalid format. Check the token and enter a valid recipient ID.",
        ],
    ],
    [
        "请填写有效的 HTTP(S) 通知地址。",
        [
            "通知地址无效。请填写完整的 HTTP 或 HTTPS 地址。",
            "The notification URL is invalid. Enter a complete HTTP or HTTPS URL.",
        ],
    ],
    [
        "最多设置 10 个自定义请求头。",
        [
            "自定义请求头超过 10 个。请移除不需要的请求头后保存。",
            "More than 10 custom request headers were provided. Remove unneeded headers before saving.",
        ],
    ],
    [
        "自定义请求头无效。",
        [
            "自定义请求头无效。请检查请求头名称和值，并移除换行等控制字符。",
            "A custom request header is invalid. Check its name and value and remove line breaks or other control characters.",
        ],
    ],
    [
        "ntfy topic 或 Token 无效。",
        [
            "ntfy 的 topic 或 Token 格式无效。请检查对应字段后保存。",
            "The ntfy topic or token has an invalid format. Check the corresponding fields before saving.",
        ],
    ],
    [
        "请先保存并启用此渠道。",
        [
            "该通知渠道尚未保存或启用。请先保存并启用渠道，再执行测试。",
            "This notification channel has not been saved or enabled. Save and enable it before running a test.",
        ],
    ],
    [
        "请求必须使用 application/json。",
        [
            "请求格式不正确，必须提交 JSON。请刷新页面后重试；通过 API 调用时设置 application/json。",
            "The request must contain JSON. Refresh the page and try again, or set application/json when calling the API.",
        ],
    ],
    [
        "JSON 格式错误。",
        [
            "提交内容不是有效 JSON。请检查 JSON 格式后重试。",
            "The submitted content is not valid JSON. Check its syntax and try again.",
        ],
    ],
    [
        "请求内容必须是 JSON 对象。",
        [
            "提交内容必须是 JSON 对象，不能是数组、文本或空值。",
            "The request body must be a JSON object, not an array, text, or null.",
        ],
    ],
    [
        "备份包含全实例数据，仅允许网页登录管理员操作。",
        [
            "备份包含整个实例的数据。请使用网页登录管理员身份执行备份操作。",
            "Backups contain data for the entire instance. Sign in to the console as an administrator to manage backups.",
        ],
    ],
    [
        "请上传 JSON 备份文件。",
        ["请选择并上传由管理台导出的 JSON 备份文件。", "Select and upload a JSON backup file exported by the console."],
    ],
    [
        "备份超过 32 MiB 限制。",
        [
            "备份文件超过 32 MiB，网页无法处理。请使用维护文档中的停机数据库备份与恢复工具。",
            "The backup exceeds the console's 32 MiB limit. Use the stopped-instance database backup and restore tools described in the maintenance documentation.",
        ],
    ],
    [
        "备份操作失败：请检查文件完整性、版本、选项、数据库结构或是否已有待恢复文件。",
        [
            "备份操作未完成。请确认文件完整且来自相同版本，覆盖选项与备份内容匹配，并检查是否已有待恢复任务。",
            "The backup operation could not be completed. Check that the file is intact and from the same version, the overwrite options match its contents, and no restore is already pending.",
        ],
    ],
    [
        "请先预检同一文件，再用返回的 SHA256 确认暂存。",
        [
            "当前文件尚未通过匹配的恢复预检。请重新预检同一文件，再确认暂存恢复任务。",
            "The file does not have a matching restore preflight. Run preflight on the same file again before staging the restore.",
        ],
    ],
    [
        "已有待恢复文件，请先应用或取消。",
        [
            "已有待恢复任务，不能重复暂存。请先应用现有任务，或取消后重新预检。",
            "A restore is already pending. Apply the existing task, or cancel it and run preflight again before staging another.",
        ],
    ],
    [
        "未知覆盖选项。",
        [
            "恢复选项包含不支持的字段。请使用页面提供的覆盖选项重新预检。",
            "The restore options contain unsupported fields. Use the overwrite options provided in the form and run preflight again.",
        ],
    ],
    [
        "覆盖选项应为 true 或 false。",
        [
            "恢复覆盖选项必须为 true 或 false。请通过页面开关重新选择。",
            "Restore overwrite options must be true or false. Select them again using the form controls.",
        ],
    ],
    [
        "包含未知备份选项。",
        [
            "备份选项包含不支持的字段。请使用页面提供的备份选项。",
            "The backup options contain unsupported fields. Use the backup options provided in the form.",
        ],
    ],
    [
        "备份选项必须为布尔值。",
        [
            "备份选项值无效。请使用页面上的启用或关闭开关。",
            "A backup option value is invalid. Use the On or Off controls in the form.",
        ],
    ],
    [
        "备份路径不能包含符号链接。",
        [
            "备份或数据库路径包含符号链接，无法安全操作。请检查部署目录后重试。",
            "A backup or database path contains a symbolic link and cannot be used safely. Check the deployment directories before retrying.",
        ],
    ],
    [
        "数据库或备份文件不存在。",
        [
            "所需数据库或备份文件不存在。请检查文件是否已移动或删除。",
            "A required database or backup file is missing. Check whether it was moved or deleted.",
        ],
    ],
    [
        "实例正在运行；请先停止机器人及预览进程。",
        [
            "该操作需要实例停止。请先停止使用同一数据目录的机器人和预览进程。",
            "This operation requires a stopped instance. Stop the bot and any preview using the same data directory first.",
        ],
    ],
    [
        "网页备份仅支持文件 SQLite；PostgreSQL 请按维护文档使用 pg_dump/pg_restore。",
        [
            "网页备份仅支持文件 SQLite。PostgreSQL 请按维护文档使用 pg_dump 和 pg_restore。",
            "Console backups support file-based SQLite only. For PostgreSQL, use pg_dump and pg_restore as described in the maintenance documentation.",
        ],
    ],
    [
        "未知扩展数据。",
        [
            "备份包含当前版本不支持的扩展数据。请使用匹配版本的备份和程序。",
            "The backup contains extension data unsupported by this version. Use matching backup and application versions.",
        ],
    ],
    [
        "无效表名称。",
        [
            "备份数据表名称无效。请使用管理台导出的原始备份文件。",
            "A backup table name is invalid. Use an unmodified backup exported by the console.",
        ],
    ],
    [
        "主数据库与管理数据库必须不同。",
        [
            "主数据库与管理数据库指向同一文件。请检查部署配置，使用各自独立的数据库文件。",
            "The main and management databases refer to the same file. Check the deployment configuration and use separate database files.",
        ],
    ],
    [
        "目标缺少备份组件所需的表。",
        [
            "目标实例缺少所选备份组件的数据表。请检查程序版本和数据库迁移状态。",
            "The target instance is missing tables required by a selected backup component. Check its application version and database migrations.",
        ],
    ],
    [
        "备份超出大小或单表 100000 行限制。",
        [
            "备份超过网页大小限制，或某个数据表超过 100000 行。请使用停机数据库工具。",
            "The backup exceeds the console size limit or a table exceeds 100,000 rows. Use the stopped-instance database tools.",
        ],
    ],
    [
        "备份超过 32 MiB 限制，请使用停机数据库工具。",
        [
            "备份超过 32 MiB。请使用维护文档中的停机数据库备份与恢复工具。",
            "The backup exceeds 32 MiB. Use the stopped-instance database backup and restore tools in the maintenance documentation.",
        ],
    ],
    [
        "备份含重复 JSON 字段。",
        [
            "备份含有重复 JSON 字段，不能安全恢复。请使用未修改的原始备份文件。",
            "The backup contains duplicate JSON fields and cannot be restored safely. Use the unmodified original backup.",
        ],
    ],
    [
        "备份格式、版本、组件或完整性校验失败。",
        [
            "备份格式、版本、组件或完整性校验未通过。请使用完整且版本匹配的原始备份文件。",
            "The backup failed format, version, component, or integrity validation. Use an intact original backup from a matching version.",
        ],
    ],
    [
        "备份不含选定的覆盖组件。",
        [
            "备份不包含你选择覆盖的组件。请取消对应覆盖选项，或选择包含该组件的备份。",
            "The backup does not contain a component selected for overwrite. Clear that overwrite option or choose a backup containing the component.",
        ],
    ],
    [
        "备份与目标数据库结构不一致，请先使用相同版本。",
        [
            "备份与目标实例的数据库结构不一致。请先确保导出和恢复使用相同程序版本。",
            "The backup and target database schemas do not match. Export and restore using the same application version.",
        ],
    ],
    [
        "管理员备份必须包含且仅包含一个账户。",
        [
            "管理员凭据备份必须包含一个账户。请重新导出有效的管理员凭据备份。",
            "An administrator-credential backup must contain exactly one account. Export a valid administrator-credential backup again.",
        ],
    ],
    [
        "必填数据库字段为空。",
        [
            "备份中存在空的必填字段，无法恢复。请使用完整的原始备份文件。",
            "A required field in the backup is empty. Use a complete original backup before restoring.",
        ],
    ],
    [
        "数据库字段类型无效。",
        [
            "备份中的数据类型不符合当前数据库结构。请使用版本匹配的原始备份。",
            "A backup field has a type incompatible with the database schema. Use an original backup from a matching version.",
        ],
    ],
    [
        "备份仅允许普通 read/write 连接令牌，不能导入管理员令牌或网页登录会话。",
        [
            "备份只能恢复普通只读或读写连接授权，不能导入管理员令牌或网页登录会话。请重新导出有效备份。",
            "A backup can restore ordinary read-only or read/write connections, but not administrator tokens or browser sessions. Export a valid backup again.",
        ],
    ],
    [
        "连接令牌会话范围无效。",
        [
            "备份中的连接授权会话范围无效。请检查备份来源并重新导出。",
            "A connection in the backup has an invalid chat scope. Check the backup source and export it again.",
        ],
    ],
    [
        "管理员记录无效。",
        [
            "备份中的管理员记录无效。请重新导出管理员凭据，或取消覆盖网页登录凭据。",
            "The administrator record in the backup is invalid. Export the credentials again or disable overwriting browser-login credentials.",
        ],
    ],
    [
        "管理员密码哈希格式无效。",
        [
            "备份中的管理员密码记录格式无效。请重新导出凭据，或取消覆盖网页登录凭据。",
            "The administrator password record in the backup has an invalid format. Export the credentials again or disable overwriting browser-login credentials.",
        ],
    ],
    [
        "备份包含未注册的管理配置。",
        [
            "备份包含当前版本不支持的管理配置。请使用匹配版本的备份。",
            "The backup contains management settings unsupported by this version. Use a backup from a matching version.",
        ],
    ],
    [
        "备份包含未注册的运行配置。",
        [
            "备份包含当前版本不支持的运行配置。请使用匹配版本的备份，或取消覆盖运行配置。",
            "The backup contains runtime settings unsupported by this version. Use a matching-version backup or disable overwriting runtime configuration.",
        ],
    ],
    [
        "全局配置值超出范围。",
        [
            "备份中的全局配置值超出允许范围。请在来源实例修正设置后重新导出。",
            "A global setting in the backup is outside the allowed range. Correct the source instance's settings and export it again.",
        ],
    ],
    [
        "提醒阈值超出范围。",
        [
            "备份中的提醒阈值超出允许范围。请修正来源实例的提醒设置后重新导出。",
            "The reminder threshold in the backup is outside the allowed range. Correct it in the source instance and export it again.",
        ],
    ],
    [
        "统计计数不能为负数。",
        [
            "备份中的统计计数为负数，无法恢复。请使用有效的原始备份。",
            "The backup contains negative statistics counts and cannot be restored. Use a valid original backup.",
        ],
    ],
    [
        "备份存在无效关联。",
        [
            "备份中的会话、来源或订阅关联无效。请使用完整的一致性备份。",
            "The backup contains invalid chat, feed, or subscription relationships. Use a complete, consistent backup.",
        ],
    ],
    [
        "恢复后的数据库完整性检查失败。",
        [
            "恢复验证中的数据库完整性检查未通过。请保留当前数据库，并检查备份文件。",
            "The restored database failed the integrity check during validation. Keep the current database and check the backup file.",
        ],
    ],
    [
        "Windows 支持正常 Bot 启动和备份导出；自动恢复须在 POSIX 主机执行。",
        [
            "当前 Windows 环境支持备份导出，自动恢复需要在 POSIX 主机上执行。",
            "This Windows environment supports backup export. Automatic restore must run on a POSIX host.",
        ],
    ],
    [
        "无法启用原子恢复所需的 DELETE 日志模式。",
        [
            "数据库无法切换到原子恢复所需的 DELETE 日志模式。请确认其他进程已停止，并按维护文档检查数据库。",
            "The database could not enter the DELETE journal mode required for atomic restore. Stop other processes and check the database using the maintenance documentation.",
        ],
    ],
    [
        "恢复日志路径不匹配；请人工检查。",
        [
            "恢复日志与当前数据目录不匹配。请停止恢复，并按维护文档人工检查数据目录。",
            "The restore journal does not match the current data directory. Stop the restore and inspect the directory using the maintenance documentation.",
        ],
    ],
    [
        "待恢复文件超过限制。",
        [
            "待恢复文件超过允许大小。请取消该任务，并使用较小备份或停机数据库工具。",
            "The staged restore file exceeds the size limit. Cancel the task and use a smaller backup or the stopped-instance database tools.",
        ],
    ],
    [
        "待恢复任务校验失败。",
        [
            "待恢复任务未通过完整性校验。请取消任务，重新上传并预检原始备份文件。",
            "The staged restore failed integrity validation. Cancel it, upload the original backup again, and run preflight.",
        ],
    ],
    [
        "待恢复任务失败，已保留失败包。再次启动使用原数据库。",
        [
            "恢复任务失败，失败包已保留；再次启动将使用原数据库。请保留失败包并检查恢复日志。",
            "The restore failed and its package was retained. The next start uses the original database. Keep the failed package and inspect the restore log.",
        ],
    ],
    [
        "时间必须包含时区。",
        [
            "统计时间缺少时区。请提供包含时区的时间，或使用页面提供的时间范围。",
            "The statistics timestamp has no time zone. Provide a timestamp with a time zone or use a range offered in the form.",
        ],
    ],
    [
        "统计增量必须为非负整数。",
        [
            "统计增量必须是非负整数。请检查提交的数据。",
            "A statistics increment must be a nonnegative integer. Check the submitted data.",
        ],
    ],
    [
        "day 和 at 不能同时指定。",
        [
            "不能同时指定日期和时间戳。请选择一种统计时间参数。",
            "A date and timestamp cannot be provided together. Use one statistics time parameter.",
        ],
    ],
    [
        "不能记录未来时间。",
        [
            "不能记录未来的统计时间。请检查提交的时间及其时区。",
            "A future statistics timestamp cannot be recorded. Check the submitted time and time zone.",
        ],
    ],
    [
        "不能记录未来日期。",
        [
            "不能记录未来的统计日期。请检查提交的日期。",
            "A future statistics date cannot be recorded. Check the submitted date.",
        ],
    ],
    [
        "granularity 必须为 hour 或 day。",
        [
            "统计粒度必须为小时或天。请重新选择时间范围。",
            "Statistics granularity must be Hour or Day. Select the time range again.",
        ],
    ],
    [
        "时间窗口必须按 UTC 小时或日期边界对齐。",
        [
            "统计时间范围必须按 UTC 整点或日期边界对齐。请重新选择页面提供的时间范围。",
            "The statistics range must align with UTC hour or date boundaries. Select a time range offered in the form.",
        ],
    ],
    [
        "时间窗口必须包含 1 至 744 个桶。",
        [
            "统计时间范围必须包含 1–744 个小时或日期区间。请缩小或扩大所选范围。",
            "The statistics range must contain 1–744 hourly or daily intervals. Adjust the selected range.",
        ],
    ],
]);

const fields = new Map([
    ["会话 ID", ["会话 ID", "Chat ID"]],
    ["订阅 ID", ["订阅 ID", "Subscription ID"]],
    ["来源 ID", ["来源 ID", "Feed ID"]],
    ["页码", ["页码", "Page number"]],
    ["每页数量", ["每页数量", "Page size"]],
    ["有效天数", ["有效天数", "Validity in days"]],
    ["notify", ["推送通知", "Notification mode"]],
    ["send_mode", ["发送模式", "Send mode"]],
    ["link_preview", ["链接预览", "Link preview"]],
    ["display_media", ["媒体显示", "Media display"]],
    ["display_author", ["作者显示", "Author display"]],
    ["display_via", ["来源显示", "Source display"]],
    ["display_title", ["标题显示", "Title display"]],
    ["display_entry_tags", ["文章标签显示", "Entry tag display"]],
    ["style", ["排版风格", "Formatting style"]],
    ["interval", ["更新间隔", "Update interval"]],
    ["length_limit", ["长度阈值", "Length threshold"]],
    ["sub_limit", ["会话订阅上限", "Chat subscription limit"]],
    ["state", ["订阅状态", "Subscription state"]],
    ["default_interval", ["默认更新间隔", "Default update interval"]],
    ["minimal_interval", ["最短更新间隔", "Minimum update interval"]],
    ["user_sub_limit", ["私聊订阅上限", "Private-chat subscription limit"]],
    ["channel_or_group_sub_limit", ["频道／群组订阅上限", "Channel/group subscription limit"]],
    ["attention_threshold", ["提醒失败次数", "Failure reminder threshold"]],
]);
const configHints = new Map([
    ["API_ID", ["API_ID 必须是 1–2147483647 之间的整数。", "API_ID must be an integer from 1 to 2,147,483,647."]],
    ["CRON_SECOND", ["CRON_SECOND 必须是 0–59 之间的整数。", "CRON_SECOND must be an integer from 0 to 59."]],
    [
        "HTTP_TIMEOUT",
        ["HTTP_TIMEOUT 必须是 1–300 秒之间的整数。", "HTTP_TIMEOUT must be an integer from 1 to 300 seconds."],
    ],
    [
        "HTTP_CONCURRENCY",
        [
            "HTTP_CONCURRENCY 必须是 0–4096 之间的整数；0 表示不限。",
            "HTTP_CONCURRENCY must be an integer from 0 to 4,096; 0 means unlimited.",
        ],
    ],
    [
        "HTTP_CONCURRENCY_PER_HOST",
        [
            "HTTP_CONCURRENCY_PER_HOST 必须是 0–1024 之间的整数；0 表示不限。",
            "HTTP_CONCURRENCY_PER_HOST must be an integer from 0 to 1,024; 0 means unlimited.",
        ],
    ],
    [
        "HTTP_MAX_LINE_SIZE",
        [
            "HTTP_MAX_LINE_SIZE 必须是 1024–1048576 之间的整数。",
            "HTTP_MAX_LINE_SIZE must be an integer from 1,024 to 1,048,576.",
        ],
    ],
    [
        "HTTP_MAX_FIELD_SIZE",
        [
            "HTTP_MAX_FIELD_SIZE 必须是 1024–1048576 之间的整数。",
            "HTTP_MAX_FIELD_SIZE must be an integer from 1,024 to 1,048,576.",
        ],
    ],
    [
        "TOKEN",
        [
            "Bot Token 格式无效。请检查机器人 ID、冒号及其后的完整密钥，不能包含空格或换行。",
            "The Bot Token format is invalid. Check the bot ID, colon, and complete token, with no spaces or line breaks.",
        ],
    ],
    [
        "API_HASH",
        [
            "API_HASH 应为 32 位十六进制字符，或留空使用原版空值行为。",
            "API_HASH must contain 32 hexadecimal characters, or be empty to use the original empty-value behavior.",
        ],
    ],
    [
        "ERROR_LOGGING_CHAT",
        ["ERROR_LOGGING_CHAT 必须是有效的数字会话 ID。", "ERROR_LOGGING_CHAT must be a valid numeric chat ID."],
    ],
]);
for (const key of [
    "MULTIUSER",
    "PROXY_BYPASS_PRIVATE",
    "IPV6_PRIOR",
    "VERIFY_TLS",
    "TABLE_TO_IMAGE",
    "TRAFFIC_SAVING",
    "LAZY_MEDIA_VALIDATION",
]) {
    configHints.set(key, [`${key} 必须使用启用或关闭开关。`, `${key} must use the On or Off control.`]);
}
for (const key of ["SOCKS_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "T_PROXY", "R_PROXY"]) {
    configHints.set(key, [
        `${key} 代理地址格式无效。支持 http、socks4、socks5 或 socks5h 地址，不能包含路径、查询参数或换行。`,
        `${key} has an invalid proxy URL. Use http, socks4, socks5, or socks5h without a path, query, or line break.`,
    ]);
}
for (const key of ["IMG_RELAY_SERVER", "IMAGES_WESERV_NL"]) {
    configHints.set(key, [
        `${key} 必须是完整的 HTTP(S) 地址，不能包含用户名、密码或 URL 片段。`,
        `${key} must be a complete HTTP(S) URL without an embedded username, password, or URL fragment.`,
    ]);
}
for (const key of ["TELEGRAPH_TOKEN", "PROXY_BYPASS_DOMAINS", "USER_AGENT"]) {
    configHints.set(key, [
        `${key} 最多 4096 个字符，不能包含换行等控制字符。`,
        `${key} supports up to 4,096 characters and cannot contain line breaks or other control characters.`,
    ]);
}
const components = new Map([
    ["agent_tokens", ["Agent 连接授权", "Agent connections"]],
    ["admin_credentials", ["网页登录凭据", "Browser-login credentials"]],
    ["runtime_config", ["运行配置", "Runtime configuration"]],
    ["notification_secrets", ["通知渠道凭据", "Notification channel credentials"]],
]);

export function businessError(data, locale) {
    if (!data || typeof data.error !== "string") return null;
    const message = data.error;
    const index = locale === "en" ? 1 : 0;
    const known = messages.get(message);
    if (known) return known[index];
    // Interpolate only trusted field identifiers and bounded numeric strings.
    // Unknown identifiers and arbitrary detail deliberately fall back to null.
    let match = /^(.{1,64})必须是整数。$/.exec(message);
    if (match && fields.has(match[1])) {
        const field = fields.get(match[1])[index];
        return index ? `${field} must be an integer. Correct it before saving.` : `${field}必须是整数，请修改后保存。`;
    }
    match = /^(.{1,64})应在 (-?\d{1,16})–(-?\d{1,16}) 之间。$/.exec(message);
    if (match && fields.has(match[1])) {
        const field = fields.get(match[1])[index];
        return index
            ? `${field} must be between ${match[2]} and ${match[3]}. Correct it before saving.`
            : `${field}应在 ${match[2]}–${match[3]} 之间，请修改后保存。`;
    }
    match = /^(.{1,64}) 的选项无效。$/.exec(message);
    if (match && fields.has(match[1])) {
        const field = fields.get(match[1])[index];
        return index
            ? `${field} has an invalid option. Select an option offered in the form.`
            : `${field}的选项无效，请重新选择页面提供的选项。`;
    }
    match = /^更新间隔不能小于 (\d{1,5}) 分钟。$/.exec(message);
    if (match)
        return index
            ? `The update interval must be at least ${match[1]} minutes. Increase it before saving.`
            : `更新间隔不能小于 ${match[1]} 分钟，请提高间隔后保存。`;
    match = /^([A-Z_]{1,64}) 的配置值无效。$/.exec(message);
    if (match && configHints.has(match[1])) return configHints.get(match[1])[index];
    match = /^([a-z_]{1,64}) 尚未注册可备份组件；部署环境中的凭据永不导出。$/.exec(message);
    if (match && components.has(match[1])) {
        const component = components.get(match[1])[index];
        return index
            ? `${component} is unavailable for backup in this installation. Disable this option. Deployment credentials are never exported.`
            : `${component}在当前实例中尚不可备份。请取消该选项；部署环境中的凭据不会导出。`;
    }
    return null;
}
